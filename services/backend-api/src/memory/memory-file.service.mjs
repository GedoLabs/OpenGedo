/**
 * PCP File Service  —  INTERNAL (file adapter implementation, P0.5)
 *
 * ⚠ Do NOT import this module from business code. It is the low-level
 * file-system backend for FileMemoryStore (./store/FileMemoryStore.mjs).
 * Business code (server, services, engines, agent cron) must access memory
 * exclusively through the MemoryStore interface via `getMemoryStore()`
 * (./store/index.mjs) so the backing store can be swapped for Postgres+pgvector
 * with zero churn. Allowed direct importers: FileMemoryStore, the gmp pack
 * tooling, and the file-layer unit tests.
 *
 * Manages per-user PCP files on disk:
 *   data/memories/{user_id}/profile.json   – L1 Core Identity + L3 Semantic Long-Term
 *   data/memories/{user_id}/working.json   – L2 Working Memory
 *   data/memories/{user_id}/episodes/      – L4 raw episodes (JSONL, one file per month)
 *   data/memories/{user_id}/conflicts.json – conflict resolution log
 *
 * Supports auto-migration from v1.0 to v2.0 PCP schema.
 */

import fs from 'node:fs';
import path from 'node:path';
import { writeFileAtomic, writeJsonAtomic } from '../lib/fs-atomic.mjs';
import { randomId, nowIso } from '../lib/crypto.mjs';
import {
  PCP_VERSION,
  WORKING_MEMORY_TTL_DAYS,
  LIFE_DIMENSIONS,
  EPISODE_SOURCES,
  createDefaultProfile,
  createDefaultWorkingMemory,
  createEpisode,
  validateProfile,
  validateWorkingMemory,
  migrateProfileV1ToV2,
  migrateWorkingMemoryV1ToV2,
} from './types.mjs';
import { getSlotFillStatus } from './core-slots.mjs';
import { dataPath } from '../lib/data-dir.mjs';

const DATA_DIR = dataPath('memories');

// ── Path helpers ───────────────────────────────────────────────────

function userDir(userId) {
  return path.join(DATA_DIR, userId);
}

function profilePath(userId) {
  return path.join(userDir(userId), 'profile.json');
}

function workingPath(userId) {
  return path.join(userDir(userId), 'working.json');
}

function episodesDir(userId) {
  return path.join(userDir(userId), 'episodes');
}

function currentEpisodeFile(userId) {
  const month = new Date().toISOString().slice(0, 7);
  return path.join(episodesDir(userId), `${month}.jsonl`);
}

function consolidationLogPath(userId) {
  return path.join(userDir(userId), 'consolidation.log');
}

function conflictsPath(userId) {
  return path.join(userDir(userId), 'conflicts.json');
}

function embeddingsPath(userId) {
  // L4 vector index sidecar. Kept OUT of episodes/*.jsonl so the hot
  // listEpisodes() read path never parses 1536-float vectors.
  return path.join(userDir(userId), 'embeddings.json');
}

// ── Directory & JSON helpers ──────────────────────────────────────

function ensureUserDir(userId) {
  const dir = userDir(userId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const epDir = episodesDir(userId);
  if (!fs.existsSync(epDir)) fs.mkdirSync(epDir, { recursive: true });
}

function readJson(filePath, defaultValue) {
  if (!fs.existsSync(filePath)) return defaultValue;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return defaultValue;
  }
}

function writeJson(filePath, data) {
  writeJsonAtomic(filePath, data);
}

// ── Auto-migration ────────────────────────────────────────────────

function needsMigration(data) {
  if (!data || !data.version) return true;
  return data.version.startsWith('1.');
}

function autoMigrateProfile(raw) {
  if (!needsMigration(raw)) return raw;
  console.log('[PCP] Auto-migrating profile from v1 to v2');
  return migrateProfileV1ToV2(raw);
}

function autoMigrateWorking(raw) {
  if (!needsMigration(raw)) return raw;
  console.log('[PCP] Auto-migrating working memory from v1 to v2');
  return migrateWorkingMemoryV1ToV2(raw);
}

// ══════════════════════════════════════════════════════════════════
//  Profile (L1 Core Identity + L3 Semantic Long-Term)
// ══════════════════════════════════════════════════════════════════

export function getProfile(userId) {
  ensureUserDir(userId);
  const raw = readJson(profilePath(userId), null);
  if (raw) {
    const migrated = autoMigrateProfile(raw);
    if (migrated !== raw) writeJson(profilePath(userId), migrated);
    return migrated;
  }
  const profile = createDefaultProfile();
  writeJson(profilePath(userId), profile);
  return profile;
}

export function updateProfile(userId, patch) {
  const profile = getProfile(userId);

  if (patch.core_identity) {
    const v = validateProfile({ core_identity: patch.core_identity, semantic_memory: profile.semantic_memory });
    if (!v.valid) throw new Error(v.error);
    deepMerge(profile.core_identity, patch.core_identity);
  }

  if (patch.semantic_memory) {
    const v = validateProfile({ core_identity: profile.core_identity, semantic_memory: patch.semantic_memory });
    if (!v.valid) throw new Error(v.error);
    if (patch.semantic_memory.dimensions) {
      for (const [dim, data] of Object.entries(patch.semantic_memory.dimensions)) {
        profile.semantic_memory.dimensions[dim] = {
          ...profile.semantic_memory.dimensions[dim],
          ...data,
        };
      }
    }
    if (patch.semantic_memory.cross_dimension_patterns) {
      profile.semantic_memory.cross_dimension_patterns = patch.semantic_memory.cross_dimension_patterns;
    }
    if (patch.semantic_memory.milestone_events) {
      profile.semantic_memory.milestone_events = patch.semantic_memory.milestone_events;
    }
    if (patch.semantic_memory.failure_learnings) {
      profile.semantic_memory.failure_learnings = patch.semantic_memory.failure_learnings;
    }
    if (patch.semantic_memory.relationship_map) {
      profile.semantic_memory.relationship_map = patch.semantic_memory.relationship_map;
    }
    if (patch.semantic_memory.long_term_summaries) {
      profile.semantic_memory.long_term_summaries = patch.semantic_memory.long_term_summaries;
    }
    if (patch.semantic_memory.growth_trajectory) {
      profile.semantic_memory.growth_trajectory = patch.semantic_memory.growth_trajectory;
    }
  }

  if (patch.last_consolidated !== undefined) {
    profile.last_consolidated = patch.last_consolidated;
  }

  if (patch.conflict_log) {
    profile.conflict_log = patch.conflict_log;
  }

  profile.updated_at = nowIso();
  writeJson(profilePath(userId), profile);
  return profile;
}

export function replaceProfile(userId, newProfile) {
  const v = validateProfile(newProfile);
  if (!v.valid) throw new Error(v.error);
  newProfile.version = PCP_VERSION;
  newProfile.updated_at = nowIso();
  ensureUserDir(userId);
  writeJson(profilePath(userId), newProfile);
  return newProfile;
}

// ══════════════════════════════════════════════════════════════════
//  Working Memory (L2)
// ══════════════════════════════════════════════════════════════════

export function getWorkingMemory(userId) {
  ensureUserDir(userId);
  const raw = readJson(workingPath(userId), null);
  if (raw) {
    const migrated = autoMigrateWorking(raw);
    if (migrated !== raw) writeJson(workingPath(userId), migrated);
    pruneExpiredItems(migrated);
    return migrated;
  }
  const wm = createDefaultWorkingMemory();
  writeJson(workingPath(userId), wm);
  return wm;
}

export function updateWorkingMemory(userId, patch) {
  const wm = getWorkingMemory(userId);

  // Goal management
  if (patch.active_goals) {
    wm.active_goals = patch.active_goals;
  }
  if (patch.add_goal) {
    const goal = {
      id: patch.add_goal.id || `goal_${randomId()}`,
      title: patch.add_goal.title,
      phase: patch.add_goal.phase || 'planning',
      progress: patch.add_goal.progress || 0,
      created_at: nowIso(),
    };
    wm.active_goals.push(goal);
  }
  if (patch.update_goal) {
    const idx = wm.active_goals.findIndex(g => g.id === patch.update_goal.id);
    if (idx >= 0) {
      Object.assign(wm.active_goals[idx], patch.update_goal);
    }
  }
  if (patch.remove_goal) {
    wm.active_goals = wm.active_goals.filter(g => g.id !== patch.remove_goal);
  }

  // Current context
  if (patch.current_context) {
    wm.current_context = { ...wm.current_context, ...patch.current_context };
  }

  // Legacy compatibility
  if (patch.active_focus !== undefined) {
    wm.current_context.focus_domain = patch.active_focus;
  }
  if (patch.emotional_trend !== undefined) {
    wm.current_context.emotional_state = patch.emotional_trend;
  }

  // Decisions
  if (patch.recent_decisions) {
    const newDecisions = Array.isArray(patch.recent_decisions) ? patch.recent_decisions : [patch.recent_decisions];
    for (const d of newDecisions) {
      wm.recent_decisions.push({
        decision: d.decision,
        rationale: d.rationale || '',
        ts: d.ts || d.date || nowIso(),
      });
    }
    wm.recent_decisions = wm.recent_decisions.slice(-15);
  }

  // Habits
  if (patch.habits) {
    wm.habits = { ...wm.habits, ...patch.habits };
  }

  // Pending items
  if (patch.pending_items) {
    if (Array.isArray(patch.pending_items)) wm.pending_items = patch.pending_items;
  }
  if (patch.add_pending_item) {
    wm.pending_items.push(patch.add_pending_item);
  }
  if (patch.remove_pending_item) {
    wm.pending_items = wm.pending_items.filter(item => item !== patch.remove_pending_item);
  }

  // Conversation continuity
  if (patch.conversation_continuity) {
    wm.conversation_continuity = { ...wm.conversation_continuity, ...patch.conversation_continuity };
  }

  wm.updated_at = nowIso();
  writeJson(workingPath(userId), wm);
  return wm;
}

function pruneExpiredItems(wm) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - WORKING_MEMORY_TTL_DAYS);
  const cutoffStr = cutoff.toISOString();

  wm.recent_decisions = (wm.recent_decisions || []).filter(d => {
    const ts = d.ts || d.date || '';
    return ts >= cutoffStr;
  });
}

// ══════════════════════════════════════════════════════════════════
//  Episodic Memory (L4 raw episodes)
// ══════════════════════════════════════════════════════════════════

export function addEpisode(userId, {
  type, contentRaw, tags, source, sourceId,
  contentStruct, reminderDate, confidence, impactScore, aiExcluded,
  entityIds, dimensions,
}) {
  ensureUserDir(userId);
  const id = randomId();
  const episode = createEpisode({
    id,
    userId,
    type,
    contentRaw,
    tags,
    source,
    sourceId,
    contentStruct,
    reminderDate,
    confidence,
    impactScore,
    aiExcluded,
    entityIds,
    dimensions,
  });

  const filePath = currentEpisodeFile(userId);
  fs.appendFileSync(filePath, JSON.stringify(episode) + '\n', 'utf8');
  return episode;
}

/**
 * 来源归属口径（IA v2 定案，web/mobile 固定项与此保持一致）：
 *   chat   = 与智伴的对话（chat / auto_extract 且无 source_id）
 *   manual = 手动记录（text / voice / image）
 *   import = 来源库导入（source_id 非空，或 source === 'import'）
 */
function matchesOrigin(ep, origin) {
  const src = ep.source || 'text';
  if (origin === 'import') return !!ep.source_id || src === 'import';
  if (origin === 'chat') return !ep.source_id && (src === 'chat' || src === 'auto_extract');
  if (origin === 'manual') return !ep.source_id && (src === 'text' || src === 'voice' || src === 'image');
  return true;
}

/**
 * @param {object} [opts]
 * @param {boolean} [opts.includeExcluded=false] – when false (the default used
 *   by every AI-retrieval path) episodes flagged `ai_excluded` are omitted, so
 *   user-muted memories never reach the model. The owner's own memory browser
 *   passes `includeExcluded: true` to still see (and manage) them.
 * @param {string} [opts.sourceId] – only episodes produced by this import source.
 * @param {'chat'|'manual'|'import'} [opts.origin] – fixed-item filter (来源库固定项).
 */
export function listEpisodes(userId, { type, since, limit = 100, includeExcluded = false, dimension, sourceId, origin } = {}) {
  const epDir = episodesDir(userId);
  if (!fs.existsSync(epDir)) return [];

  const files = fs.readdirSync(epDir)
    .filter(f => f.endsWith('.jsonl'))
    .sort()
    .reverse();

  const results = [];

  for (const file of files) {
    const lines = fs.readFileSync(path.join(epDir, file), 'utf8')
      .split('\n')
      .filter(l => l.trim());

    for (const line of lines) {
      try {
        const ep = JSON.parse(line);
        if (type && ep.type !== type) continue;
        if (since && ep.created_at < since) continue;
        if (!includeExcluded && ep.ai_excluded) continue;
        if (dimension && !(Array.isArray(ep.dimensions) && ep.dimensions.includes(dimension))) continue;
        if (sourceId && ep.source_id !== sourceId) continue;
        if (origin && !matchesOrigin(ep, origin)) continue;
        results.push(ep);
      } catch { /* skip malformed lines */ }
    }

    if (results.length >= limit) break;
  }

  results.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  return results.slice(0, limit);
}

export function searchEpisodes(userId, query, { limit = 50, includeExcluded = false } = {}) {
  if (!query || !query.trim()) {
    return listEpisodes(userId, { limit, includeExcluded });
  }

  const q = query.toLowerCase().trim();
  const all = listEpisodes(userId, { limit: 500, includeExcluded });

  return all
    .filter(ep =>
      (ep.content_raw || '').toLowerCase().includes(q) ||
      (ep.tags || []).some(t => t.toLowerCase().includes(q))
    )
    .slice(0, limit);
}

export function getUnconsolidatedEpisodes(userId, { limit = 100 } = {}) {
  const all = listEpisodes(userId, { limit: 500 });
  return all.filter(ep => !ep.consolidated).slice(0, limit);
}

export function markEpisodesConsolidated(userId, episodeIds) {
  const epDir = episodesDir(userId);
  if (!fs.existsSync(epDir)) return;
  const idSet = new Set(episodeIds);

  const files = fs.readdirSync(epDir).filter(f => f.endsWith('.jsonl'));

  for (const file of files) {
    const filePath = path.join(epDir, file);
    const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(l => l.trim());
    let modified = false;
    const updated = lines.map(line => {
      try {
        const ep = JSON.parse(line);
        if (idSet.has(ep.id) && !ep.consolidated) {
          ep.consolidated = true;
          modified = true;
          return JSON.stringify(ep);
        }
        return line;
      } catch {
        return line;
      }
    });
    if (modified) {
      writeFileAtomic(filePath, updated.join('\n') + '\n');
    }
  }
}

/**
 * Increment usage_count for an episode (for TSS access_freq).
 */
export function incrementEpisodeUsage(userId, episodeId) {
  const epDir = episodesDir(userId);
  if (!fs.existsSync(epDir)) return;

  const files = fs.readdirSync(epDir).filter(f => f.endsWith('.jsonl'));

  for (const file of files) {
    const filePath = path.join(epDir, file);
    const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(l => l.trim());
    let modified = false;
    const updated = lines.map(line => {
      try {
        const ep = JSON.parse(line);
        if (ep.id === episodeId) {
          ep.usage_count = (ep.usage_count || 0) + 1;
          modified = true;
          return JSON.stringify(ep);
        }
        return line;
      } catch {
        return line;
      }
    });
    if (modified) {
      writeFileAtomic(filePath, updated.join('\n') + '\n');
      return;
    }
  }
}

/**
 * Patch whitelisted privacy fields on a single episode (currently `ai_excluded`).
 * Rewrites the containing monthly file in place. Returns the updated episode, or
 * null if not found.
 */
export function setEpisodeFlag(userId, episodeId, patch = {}) {
  const epDir = episodesDir(userId);
  if (!fs.existsSync(epDir)) return null;

  const files = fs.readdirSync(epDir).filter(f => f.endsWith('.jsonl'));
  for (const file of files) {
    const filePath = path.join(epDir, file);
    const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(l => l.trim());
    let found = null;
    const updated = lines.map(line => {
      try {
        const ep = JSON.parse(line);
        if (ep.id === episodeId) {
          if ('ai_excluded' in patch) ep.ai_excluded = !!patch.ai_excluded;
          if ('impact_score' in patch && typeof patch.impact_score === 'number' && !Number.isNaN(patch.impact_score)) {
            ep.impact_score = Math.max(0, Math.min(1, patch.impact_score)); // 降权/恢复
          }
          if ('confirmed' in patch) ep.confirmed = !!patch.confirmed;
          if ('entity_ids' in patch && Array.isArray(patch.entity_ids)) {
            ep.entity_ids = patch.entity_ids.map(String); // 图鉴卡关联（手动改链）
          }
          if ('add_entity_ids' in patch && Array.isArray(patch.add_entity_ids)) {
            const cur = new Set(Array.isArray(ep.entity_ids) ? ep.entity_ids : []);
            for (const eid of patch.add_entity_ids) cur.add(String(eid));
            ep.entity_ids = [...cur]; // 建卡回链（合并，不清空既有关联）
          }
          if ('dimensions' in patch && Array.isArray(patch.dimensions)) {
            ep.dimensions = patch.dimensions.filter((d) => LIFE_DIMENSIONS.includes(d)); // 维度改归属
          }
          if ('source_id' in patch) {
            ep.source_id = patch.source_id ? String(patch.source_id) : null; // 来源回链（导入确认/存量回填）
          }
          if ('source' in patch && EPISODE_SOURCES.includes(patch.source)) {
            ep.source = patch.source; // 存量脏值修正（回填脚本用），仅接受白名单值
          }
          found = ep;
          return JSON.stringify(ep);
        }
        return line;
      } catch {
        return line;
      }
    });
    if (found) {
      writeFileAtomic(filePath, updated.join('\n') + '\n');
      return found;
    }
  }
  return null;
}

/**
 * 实体合并的碎片回链重写：episodes.entity_ids 里的 fromId 全部改写为 toId
 * （去重）。逐月度文件重写，返回改写的行数。
 */
export function replaceEntityIdInEpisodes(userId, fromId, toId) {
  const epDir = episodesDir(userId);
  if (!fs.existsSync(epDir) || !fromId || !toId || fromId === toId) return 0;

  let changed = 0;
  const files = fs.readdirSync(epDir).filter(f => f.endsWith('.jsonl'));
  for (const file of files) {
    const filePath = path.join(epDir, file);
    const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(l => l.trim());
    let modified = false;
    const updated = lines.map(line => {
      try {
        const ep = JSON.parse(line);
        if (Array.isArray(ep.entity_ids) && ep.entity_ids.includes(fromId)) {
          ep.entity_ids = [...new Set(ep.entity_ids.map(id => (id === fromId ? toId : id)))];
          modified = true;
          changed += 1;
          return JSON.stringify(ep);
        }
        return line;
      } catch {
        return line;
      }
    });
    if (modified) writeFileAtomic(filePath, updated.join('\n') + '\n');
  }
  return changed;
}

/**
 * Hard-delete a single episode by id. Rewrites the containing file without the
 * line. Returns true if a row was removed.
 */
export function deleteEpisode(userId, episodeId) {
  const epDir = episodesDir(userId);
  if (!fs.existsSync(epDir)) return false;

  const files = fs.readdirSync(epDir).filter(f => f.endsWith('.jsonl'));
  for (const file of files) {
    const filePath = path.join(epDir, file);
    const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(l => l.trim());
    const kept = [];
    let removed = false;
    for (const line of lines) {
      try {
        if (JSON.parse(line).id === episodeId) { removed = true; continue; }
      } catch { /* keep malformed lines */ }
      kept.push(line);
    }
    if (removed) {
      writeFileAtomic(filePath, kept.length ? kept.join('\n') + '\n' : '');
      removeEpisodeEmbedding(userId, episodeId);
      return true;
    }
  }
  return false;
}

/**
 * Hard-delete a user's entire on-disk memory footprint (profile.json,
 * working.json, episodes/, conflicts.json, consolidation.log). Idempotent —
 * a no-op if the directory is already gone.
 */
export function wipeUserMemory(userId) {
  const dir = userDir(userId);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
    return true;
  }
  return false;
}

// ══════════════════════════════════════════════════════════════════
//  Episode Embeddings (L4 vector index — file sidecar)  [P1]
//
//  Stored in embeddings.json as { model, dim, vectors: { [episodeId]: [] } }.
//  Vector generation (LLM call) lives in ../embedding.mjs; this layer only
//  persists and brute-force cosine-scans them — the file analog of pgvector.
//  For a single internal user this is a few hundred vectors → trivially fast.
// ══════════════════════════════════════════════════════════════════

function cosineSimilarity(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Persist one episode's embedding vector + metadata.
 * Record: { v, provider, model, dim, created_at, source_hash }.
 * @returns {boolean}
 */
export function saveEpisodeEmbedding(userId, episodeId, vector, meta = {}) {
  if (!episodeId || !Array.isArray(vector) || vector.length === 0) return false;
  ensureUserDir(userId);
  const p = embeddingsPath(userId);
  const dim = meta.dim || vector.length;
  const data = readJson(p, { provider: meta.provider || null, model: meta.model || null, dim, vectors: {} });
  if (!data.vectors) data.vectors = {};
  data.vectors[episodeId] = {
    v: vector,
    provider: meta.provider || null,
    model: meta.model || null,
    dim,
    created_at: meta.created_at || nowIso(),
    source_hash: meta.source_hash || null,
  };
  if (meta.provider) data.provider = meta.provider;
  if (meta.model) data.model = meta.model;
  data.dim = dim;
  data.updated_at = nowIso();
  writeJson(p, data);
  return true;
}

/** Remove an episode's embedding (called on hard delete). */
export function removeEpisodeEmbedding(userId, episodeId) {
  const p = embeddingsPath(userId);
  const data = readJson(p, null);
  if (!data?.vectors || !(episodeId in data.vectors)) return false;
  delete data.vectors[episodeId];
  writeJson(p, data);
  return true;
}

/**
 * Cosine-rank episodes by similarity to a query vector. Returns full episode
 * objects (joined from the JSONL) with an added `vector_score` (0–1), highest
 * first. Orphan vectors (episode deleted) are skipped at the join.
 *
 * @param {string} userId
 * @param {number[]} queryVector
 * @param {object} [opts] {topK=20, includeExcluded=false}
 * @returns {Array<object & {vector_score:number}>}
 */
export function searchEpisodesByVector(userId, queryVector, { topK = 20, includeExcluded = false } = {}) {
  if (!Array.isArray(queryVector) || queryVector.length === 0) return [];
  const data = readJson(embeddingsPath(userId), null);
  if (!data?.vectors) return [];
  const ids = Object.keys(data.vectors);
  if (!ids.length) return [];

  const scored = [];
  for (const id of ids) {
    const rec = data.vectors[id];
    const v = Array.isArray(rec) ? rec : rec?.v;            // back-compat: legacy raw-array records
    if (!Array.isArray(v) || v.length === 0) continue;
    const dim = Array.isArray(rec) ? v.length : (rec?.dim ?? v.length);
    // Dim guard — never mix embedding dimensions. Only score vectors whose dim
    // matches the query (i.e. the active embedding model, e.g. bge-m3 → 1024);
    // foreign-dim vectors are skipped until a full backfill re-computes them.
    if (dim !== queryVector.length) continue;
    scored.push({ id, vector_score: cosineSimilarity(queryVector, v) });
  }
  scored.sort((a, b) => b.vector_score - a.vector_score);

  const epMap = new Map(
    listEpisodes(userId, { limit: 100000, includeExcluded }).map(e => [e.id, e]),
  );
  const out = [];
  for (const { id, vector_score } of scored) {
    const ep = epMap.get(id);
    if (ep) out.push({ ...ep, vector_score });
    if (out.length >= topK) break;
  }
  return out;
}

/** Episodes that have no stored embedding yet (for backfill). */
export function getEpisodesMissingEmbedding(userId, { limit = 1000 } = {}) {
  const data = readJson(embeddingsPath(userId), null);
  const have = new Set(data?.vectors ? Object.keys(data.vectors) : []);
  return listEpisodes(userId, { limit: 100000, includeExcluded: true })
    .filter(e => !have.has(e.id))
    .slice(0, limit);
}

// ══════════════════════════════════════════════════════════════════
//  Conflict Log
// ══════════════════════════════════════════════════════════════════

export function getConflicts(userId) {
  return readJson(conflictsPath(userId), []);
}

export function addConflict(userId, conflict) {
  ensureUserDir(userId);
  const conflicts = getConflicts(userId);
  conflicts.push({
    id: randomId(),
    field: conflict.field,
    old_value: conflict.old_value,
    new_value: conflict.new_value,
    old_evidence: conflict.old_evidence || null,
    new_evidence: conflict.new_evidence || null,
    detected_at: nowIso(),
    resolved: false,
    resolution: null,
    resolved_at: null,
  });
  writeJson(conflictsPath(userId), conflicts);
  return conflicts;
}

export function resolveConflict(userId, conflictId, resolution) {
  const conflicts = getConflicts(userId);
  const idx = conflicts.findIndex(c => c.id === conflictId);
  if (idx >= 0) {
    conflicts[idx].resolved = true;
    conflicts[idx].resolution = resolution;
    conflicts[idx].resolved_at = nowIso();
    writeJson(conflictsPath(userId), conflicts);
  }
  return conflicts;
}

/**
 * 把用户确认采用的值写入画像对应字段（dot-path，如 `core_identity.name`、
 * `semantic_memory.dimensions.health.summary`）。仅支持 core_identity /
 * semantic_memory 两个顶层分支；交由 updateProfile 做深合并 + 校验。
 */
export function applyConflictResolution(userId, field, value) {
  if (!field || typeof field !== 'string') return null;
  const parts = field.split('.').filter(Boolean);
  if (parts.length < 2) return null;
  if (parts[0] !== 'core_identity' && parts[0] !== 'semantic_memory') return null;

  const patch = {};
  let cur = patch;
  for (let i = 0; i < parts.length - 1; i++) {
    cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
  return updateProfile(userId, patch);
}

// ══════════════════════════════════════════════════════════════════
//  Consolidation Log
// ══════════════════════════════════════════════════════════════════

export function appendConsolidationLog(userId, entry) {
  ensureUserDir(userId);
  const logEntry = {
    timestamp: nowIso(),
    level: entry.level || 'session',
    episodes_processed: entry.episodesProcessed || 0,
    profile_updated: entry.profileUpdated || false,
    working_pruned: entry.workingPruned || false,
    conflicts_detected: entry.conflictsDetected || 0,
    summary: entry.summary || '',
  };
  fs.appendFileSync(
    consolidationLogPath(userId),
    JSON.stringify(logEntry) + '\n',
    'utf8',
  );
}

export function getConsolidationLogs(userId, { limit = 20 } = {}) {
  const logFile = consolidationLogPath(userId);
  if (!fs.existsSync(logFile)) return [];
  const lines = fs.readFileSync(logFile, 'utf8').split('\n').filter(l => l.trim());
  return lines
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean)
    .reverse()
    .slice(0, limit);
}

// ══════════════════════════════════════════════════════════════════
//  Identity Versions (L4 dynamic identity model — append-only) [P3]
//
//  Each computed identity snapshot is appended as one JSONL line; the current
//  identity is the latest version. History is kept so the UI can show how the
//  model evolved and *why* (each version carries a `changes` list).
// ══════════════════════════════════════════════════════════════════

function identityDir(userId) { return path.join(userDir(userId), 'identity'); }
function identityVersionsPath(userId) { return path.join(identityDir(userId), 'versions.jsonl'); }

export function appendIdentityVersion(userId, version) {
  const dir = identityDir(userId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(identityVersionsPath(userId), JSON.stringify(version) + '\n', 'utf8');
  return version;
}

export function getIdentityVersions(userId, { limit = 50 } = {}) {
  const p = identityVersionsPath(userId);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n').filter(l => l.trim())
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean)
    .reverse()
    .slice(0, limit);
}

export function getLatestIdentity(userId) {
  return getIdentityVersions(userId, { limit: 1 })[0] || null;
}

// ══════════════════════════════════════════════════════════════════
//  Narrative Reports (L5 trajectory — latest per window) [P4]
//
//  One file per window (7 / 30 / 90 days), overwritten with the latest report.
// ══════════════════════════════════════════════════════════════════

function narrativeDir(userId) { return path.join(userDir(userId), 'narrative'); }
function narrativePath(userId, windowDays) { return path.join(narrativeDir(userId), `${windowDays}.json`); }

export function saveNarrative(userId, windowDays, report) {
  const dir = narrativeDir(userId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  writeJson(narrativePath(userId, windowDays), report);
  return report;
}

export function getNarrative(userId, windowDays) {
  return readJson(narrativePath(userId, windowDays), null);
}

// ══════════════════════════════════════════════════════════════════
//  Dimension Assessment (生命之花八维 AI 评估 — latest 覆写)
//
//  One latest.json per user (narrative-style overwrite); cross-run change
//  narration lives inside the artifact's changes[].
// ══════════════════════════════════════════════════════════════════

function dimensionAssessmentDir(userId) { return path.join(userDir(userId), 'dimension-assessment'); }
function dimensionAssessmentPath(userId) { return path.join(dimensionAssessmentDir(userId), 'latest.json'); }

export function saveDimensionAssessment(userId, assessment) {
  const dir = dimensionAssessmentDir(userId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  writeJson(dimensionAssessmentPath(userId), assessment);
  return assessment;
}

export function getDimensionAssessment(userId) {
  return readJson(dimensionAssessmentPath(userId), null);
}

// ══════════════════════════════════════════════════════════════════
//  Self-Insight Assessments (自我认知报告 — append-only versions + draft)
//
//  Final reports are appended to assessment/versions.jsonl (same shape of
//  history as identity versions). A pending clarify-draft lives in a single
//  overwritable draft.json (narrative-style) and is deleted on finalize.
// ══════════════════════════════════════════════════════════════════

function assessmentDir(userId) { return path.join(userDir(userId), 'assessment'); }
function assessmentVersionsPath(userId) { return path.join(assessmentDir(userId), 'versions.jsonl'); }
function assessmentDraftPath(userId) { return path.join(assessmentDir(userId), 'draft.json'); }

export function appendAssessmentVersion(userId, version) {
  const dir = assessmentDir(userId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(assessmentVersionsPath(userId), JSON.stringify(version) + '\n', 'utf8');
  return version;
}

export function getAssessmentVersions(userId, { limit = 50 } = {}) {
  const p = assessmentVersionsPath(userId);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n').filter(l => l.trim())
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean)
    .reverse()
    .slice(0, limit);
}

export function getLatestAssessment(userId) {
  return getAssessmentVersions(userId, { limit: 1 })[0] || null;
}

export function getAssessmentDraft(userId) {
  return readJson(assessmentDraftPath(userId), null);
}

export function saveAssessmentDraft(userId, draft) {
  const dir = assessmentDir(userId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  writeJson(assessmentDraftPath(userId), draft);
  return draft;
}

export function clearAssessmentDraft(userId) {
  fs.rmSync(assessmentDraftPath(userId), { force: true });
}

// ══════════════════════════════════════════════════════════════════
//  Stats
// ══════════════════════════════════════════════════════════════════

export function getMemoryStats(userId) {
  const profile = getProfile(userId);
  const working = getWorkingMemory(userId);
  const episodes = listEpisodes(userId, { limit: 10000 });

  const filledDimensions = Object.entries(profile.semantic_memory.dimensions)
    .filter(([, d]) => d.summary || d.skills?.length > 0)
    .map(([dim]) => dim);

  const byType = {};
  for (const ep of episodes) {
    byType[ep.type] = (byType[ep.type] || 0) + 1;
  }

  const unconsolidated = episodes.filter(ep => !ep.consolidated).length;
  const pcpSize = estimatePCPSize(profile, working);

  const bySource = {};
  for (const ep of episodes) {
    const src = ep.source || 'text';
    bySource[src] = (bySource[src] || 0) + 1;
  }

  // 生命之花：各维度碎片计数 + 近30天活跃（花瓣饱满度的活跃分量）。
  const byDimension = {};
  const recent30dByDimension = {};
  const cutoff30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  for (const ep of episodes) {
    for (const dim of (Array.isArray(ep.dimensions) ? ep.dimensions : [])) {
      byDimension[dim] = (byDimension[dim] || 0) + 1;
      if ((ep.created_at || '') >= cutoff30d) {
        recent30dByDimension[dim] = (recent30dByDimension[dim] || 0) + 1;
      }
    }
  }

  return {
    pcp_version: profile.version || '1.0',
    pcp_size_kb: pcpSize,
    total_episodes: episodes.length,
    unconsolidated_episodes: unconsolidated,
    episodes_by_type: byType,
    episodes_by_source: bySource,
    episodes_by_dimension: byDimension,
    recent30d_by_dimension: recent30dByDimension,
    // 通用核心记忆模板完成度（画像完成度）；episodes 提供 filled_via 溯源
    core_slots: getSlotFillStatus(profile, working, episodes),
    profile_filled: {
      has_name: !!profile.core_identity.name,
      has_profession: !!profile.core_identity.profession,
      has_big5: !!profile.core_identity.personality?.big5,
      has_cognition: !!profile.core_identity.cognition?.learning_style,
      traits_count: (profile.core_identity.traits || []).length,
      values_count: (profile.core_identity.values?.top_priorities || []).length,
      relationships_count: (profile.core_identity.key_relationships || []).length,
      expertise_domains: (profile.core_identity.expertise?.domains || []).length,
      filled_dimensions: filledDimensions,
      cross_patterns_count: (profile.semantic_memory.cross_dimension_patterns || []).length,
      milestones_count: (profile.semantic_memory.milestone_events || []).length,
      failure_learnings_count: (profile.semantic_memory.failure_learnings || []).length,
      relationship_map_count: (profile.semantic_memory.relationship_map || []).length,
    },
    working_memory: {
      active_goals_count: (working.active_goals || []).length,
      focus_domain: working.current_context?.focus_domain,
      pending_items_count: (working.pending_items || []).length,
      recent_decisions_count: (working.recent_decisions || []).length,
      emotional_state: working.current_context?.emotional_state,
    },
    conflicts: {
      total: (profile.conflict_log || []).length,
      unresolved: (profile.conflict_log || []).filter(c => !c.resolved).length,
    },
    last_consolidated: profile.last_consolidated,
  };
}

function estimatePCPSize(profile, working) {
  const profileStr = JSON.stringify(profile);
  const workingStr = JSON.stringify(working);
  return Math.round((profileStr.length + workingStr.length) / 1024 * 10) / 10;
}

// ══════════════════════════════════════════════════════════════════
//  Deep merge utility
// ══════════════════════════════════════════════════════════════════

function deepMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (source[key] === null || source[key] === undefined) continue;
    if (
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      typeof target[key] === 'object' &&
      !Array.isArray(target[key]) &&
      target[key] !== null
    ) {
      deepMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
}

export default {
  getProfile,
  updateProfile,
  replaceProfile,
  getWorkingMemory,
  updateWorkingMemory,
  addEpisode,
  listEpisodes,
  searchEpisodes,
  getUnconsolidatedEpisodes,
  markEpisodesConsolidated,
  incrementEpisodeUsage,
  setEpisodeFlag,
  deleteEpisode,
  saveEpisodeEmbedding,
  removeEpisodeEmbedding,
  searchEpisodesByVector,
  getEpisodesMissingEmbedding,
  wipeUserMemory,
  getConflicts,
  addConflict,
  resolveConflict,
  applyConflictResolution,
  appendConsolidationLog,
  getConsolidationLogs,
  appendIdentityVersion,
  getIdentityVersions,
  getLatestIdentity,
  saveNarrative,
  getNarrative,
  saveDimensionAssessment,
  getDimensionAssessment,
  appendAssessmentVersion,
  getAssessmentVersions,
  getLatestAssessment,
  getAssessmentDraft,
  saveAssessmentDraft,
  clearAssessmentDraft,
  getMemoryStats,
};
