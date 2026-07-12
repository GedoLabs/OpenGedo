/**
 * PCP Consolidation Service
 *
 * Multi-level consolidation pipeline (from PCP Architecture §3.2):
 *
 *   Session End  → Append raw turns to L4. Extract deltas to L2 Working Memory.
 *   Nightly Job  → Summarize L4 entries from past 24h → L3. Prune stale L2.
 *   Weekly Job   → Detect significant L2 shifts → propagate to L1. Conflict detection.
 *   Quarterly    → Re-summarize all L3 entries for the period. Archive previous version.
 *
 * Also includes conflict detection: when extracted memories contradict
 * existing L1/L2 fields, the system creates conflict nodes for resolution.
 */

import { getLLMRouter } from '../llm/router.mjs';
import { getMemoryStore } from './store/index.mjs';
const {
  getProfile,
  updateProfile,
  getWorkingMemory,
  updateWorkingMemory,
  getUnconsolidatedEpisodes,
  listEpisodes,
  markEpisodesConsolidated,
  appendConsolidationLog,
  addConflict,
} = getMemoryStore();
import { LIFE_DIMENSIONS } from './types.mjs';
import { ENTITY_TYPES } from './entity-registry.mjs';
import { classifyDimensions } from './dimension-classifier.mjs';
import { Store } from '../lib/store.mjs';

const libStore = Store();

const CONSOLIDATION_BATCH_SIZE = 30;

// ── System Prompts ────────────────────────────────────────────────

const SEMANTIC_CONSOLIDATION_PROMPT = `你是一个 PCP（持续认知画像）分析师。分析用户近期记忆条目，更新画像。

当前画像（JSON）：
\`\`\`json
{CURRENT_PROFILE}
\`\`\`

近期记忆条目：
{EPISODES}

请输出完整的更新后画像 JSON，包含以下结构：

{
  "core_identity": {
    "name": "用户姓名",
    "profession": "职业",
    "personality": {
      "big5": { "O": 0.0-1.0, "C": 0.0-1.0, "E": 0.0-1.0, "A": 0.0-1.0, "N": 0.0-1.0 },
      "mbti_proxy": "XXXX"
    },
    "cognition": {
      "learning_style": "visual|verbal|kinesthetic",
      "reasoning_mode": "systematic|intuitive|mixed",
      "decision_speed": 0.0-1.0
    },
    "values": { "top_priorities": ["..."] },
    "communication": { "preferred_tone": "direct|nurturing|analytical", "verbosity": 0.0-1.0 },
    "expertise": {
      "domains": [{ "domain": "...", "level": 0.0-1.0 }],
      "skill_graph": [{ "from": "...", "to": "...", "strength": 0.0-1.0 }]
    },
    "traits": ["..."],
    "key_relationships": [{ "name": "...", "relation": "..." }],
    "preferences": { "communication_style": "...", "motivation_type": "..." }
  },
  "semantic_memory": {
    "dimensions": {
      "health": { "summary": "...", "skills": [], "patterns": [], "recent_insight": null },
      ...（8个维度）
    },
    "cross_dimension_patterns": ["..."],
    "milestone_events": [{ "event": "...", "impact": 0.0-1.0, "ts": "ISO", "tags": [] }],
    "failure_learnings": [{ "context": "...", "lesson": "...", "applied": false }],
    "relationship_map": [{ "name": "...", "role": "...", "trust": 0.0-1.0, "last_interaction": "ISO" }],
    "long_term_summaries": [{ "period": "YYYY-QN", "summary": "...", "tags": [] }],
    "growth_trajectory": { "skill_delta": [{ "skill": "...", "delta": -1.0-1.0, "period": "..." }] }
  },
  "conflicts": [
    { "field": "path.to.field", "old_value": "...", "new_value": "...", "evidence": "..." }
  ],
  "changes_summary": "本次更新说明",
  "core_identity_changed": true/false
}

规则：
1. 保留已有信息，除非新记忆明确否定旧信息
2. 发现矛盾时，不要覆写旧值，而是在 conflicts 数组中记录冲突
3. 仅当 impact > 0.7 的事件才加入 milestone_events
4. 新增从记忆中推断出的技能、特质、模式
5. 各维度 summary 简洁有力（一两句话）
6. 只输出 JSON`;

const WORKING_MEMORY_UPDATE_PROMPT = `分析以下近期记忆条目，更新用户工作记忆状态。

近期记忆条目：
{EPISODES}

当前工作记忆：
{CURRENT_WORKING}

输出 JSON（只含需要更新的字段）：
{
  "active_goals": [{ "id": "...", "title": "...", "phase": "planning|in_progress|review|completed|paused", "progress": 0.0-1.0 }],
  "current_context": {
    "focus_domain": "...",
    "emotional_state": "very_positive|positive|neutral|slightly_stressed|stressed|anxious"
  },
  "recent_decisions": [{ "decision": "...", "rationale": "...", "ts": "ISO" }],
  "pending_items": ["..."],
  "conversation_continuity": { "last_topic": "...", "unresolved": "..." }
}

规则：
1. 保留现有活跃目标，除非记忆明确表示完成或放弃
2. 更新目标进度（如有新信息）
3. 只输出 JSON`;

const QUARTERLY_SUMMARY_PROMPT = `将以下时间段的记忆摘要压缩为一段高信号段落（150-300字）。

时间段：{PERIOD}

各维度摘要：
{DIMENSION_SUMMARIES}

里程碑事件：
{MILESTONES}

请输出JSON：
{
  "summary": "综合摘要段落",
  "key_themes": ["主题1", "主题2"],
  "tags": ["标签"]
}

只输出 JSON。`;

// ══════════════════════════════════════════════════════════════════
//  Main Entry Points (multi-level)
// ══════════════════════════════════════════════════════════════════

/**
 * Session-end consolidation (Step 1)
 * Extract deltas from recent conversation and update L2.
 */
export async function consolidateSessionEnd(userId, options = {}) {
  const { batchSize = 10 } = options;
  const episodes = getUnconsolidatedEpisodes(userId, { limit: batchSize });

  if (episodes.length === 0) {
    return { success: true, level: 'session', episodesProcessed: 0, profileUpdated: false, summary: 'No new episodes' };
  }

  const router = getLLMRouter();
  let profileUpdated = false;

  // Update working memory from session
  if (router.isAvailable()) {
    try {
      await consolidateWorkingMemory(userId, episodes, router);
    } catch (error) {
      console.error('[Consolidation:session] Working memory update failed:', error.message);
    }
  }

  appendConsolidationLog(userId, {
    level: 'session',
    episodesProcessed: episodes.length,
    profileUpdated,
    summary: `Session end: ${episodes.length} episodes processed`,
  });

  return { success: true, level: 'session', episodesProcessed: episodes.length, profileUpdated, summary: `Session: ${episodes.length} episodes` };
}

/**
 * Nightly consolidation (Step 2)
 * Summarize L4 entries from past 24h into L3. Prune stale L2.
 */
export async function consolidateNightly(userId, options = {}) {
  const { batchSize = CONSOLIDATION_BATCH_SIZE } = options;
  const episodes = getUnconsolidatedEpisodes(userId, { limit: batchSize });

  if (episodes.length === 0) {
    return { success: true, level: 'nightly', episodesProcessed: 0, profileUpdated: false, summary: 'No episodes to consolidate' };
  }

  const router = getLLMRouter();
  let profileUpdated = false;
  let changesSummary = '';
  let conflictsDetected = 0;

  if (router.isAvailable()) {
    try {
      const result = await consolidateSemanticMemory(userId, episodes, router);
      profileUpdated = result.updated;
      changesSummary = result.summary;
      conflictsDetected = result.conflictsDetected || 0;
    } catch (error) {
      console.error('[Consolidation:nightly] Semantic consolidation failed:', error.message);
      changesSummary = `Error: ${error.message}`;
    }
  }

  // Mark episodes
  markEpisodesConsolidated(userId, episodes.map(ep => ep.id));

  if (profileUpdated) {
    updateProfile(userId, { last_consolidated: new Date().toISOString() });
  }

  // 图鉴自动建卡建议（确认制，永不抛错）。
  try { await suggestEntities(userId, episodes); } catch { /* best-effort */ }

  appendConsolidationLog(userId, {
    level: 'nightly',
    episodesProcessed: episodes.length,
    profileUpdated,
    conflictsDetected,
    summary: changesSummary || `Nightly: ${episodes.length} episodes`,
  });

  return {
    success: true,
    level: 'nightly',
    episodesProcessed: episodes.length,
    profileUpdated,
    conflictsDetected,
    summary: changesSummary,
  };
}

/**
 * Weekly consolidation (Step 3)
 * Detect significant shifts in L2 → propagate to L1.
 */
export async function consolidateWeekly(userId) {
  const router = getLLMRouter();
  if (!router.isAvailable()) {
    return { success: false, level: 'weekly', summary: 'LLM not available' };
  }

  // Get all episodes from past week for trend analysis
  const since = new Date();
  since.setDate(since.getDate() - 7);
  const weekEpisodes = listEpisodes(userId, { since: since.toISOString(), limit: 200 });

  if (weekEpisodes.length < 3) {
    return { success: true, level: 'weekly', summary: 'Insufficient data for weekly analysis' };
  }

  // Run nightly consolidation first to ensure L3 is up to date
  await consolidateNightly(userId, { batchSize: 100 });

  appendConsolidationLog(userId, {
    level: 'weekly',
    episodesProcessed: weekEpisodes.length,
    profileUpdated: true,
    summary: `Weekly consolidation: ${weekEpisodes.length} episodes analyzed`,
  });

  return { success: true, level: 'weekly', episodesProcessed: weekEpisodes.length };
}

/**
 * Quarterly consolidation (Step 4)
 * Re-summarize all L3 entries for the quarter into a high-signal paragraph.
 */
export async function consolidateQuarterly(userId) {
  const router = getLLMRouter();
  if (!router.isAvailable()) {
    return { success: false, level: 'quarterly', summary: 'LLM not available' };
  }

  const profile = getProfile(userId);
  const sm = profile.semantic_memory;

  // Build period string
  const now = new Date();
  const quarter = Math.ceil((now.getMonth() + 1) / 3);
  const period = `${now.getFullYear()}-Q${quarter}`;

  // Gather dimension summaries
  const dimSummaries = LIFE_DIMENSIONS
    .map(dim => {
      const d = sm.dimensions[dim];
      if (!d?.summary) return null;
      return `${dim}: ${d.summary}`;
    })
    .filter(Boolean)
    .join('\n');

  // Gather milestones
  const milestones = (sm.milestone_events || [])
    .slice(-10)
    .map(m => `- ${m.event} (impact: ${m.impact})`)
    .join('\n');

  if (!dimSummaries && !milestones) {
    return { success: true, level: 'quarterly', summary: 'Insufficient data for quarterly summary' };
  }

  const prompt = QUARTERLY_SUMMARY_PROMPT
    .replace('{PERIOD}', period)
    .replace('{DIMENSION_SUMMARIES}', dimSummaries || '(无)')
    .replace('{MILESTONES}', milestones || '(无)');

  try {
    const response = await router.runTask('memory.consolidate.quarterly', [
      { role: 'user', content: prompt },
    ]);
    const parsed = response.json;

    // Append to long_term_summaries
    const summaries = sm.long_term_summaries || [];
    const existingIdx = summaries.findIndex(s => s.period === period);
    const entry = { period, summary: parsed.summary, tags: parsed.tags || [] };

    if (existingIdx >= 0) {
      summaries[existingIdx] = entry;
    } else {
      summaries.push(entry);
    }

    updateProfile(userId, {
      semantic_memory: { long_term_summaries: summaries },
      last_consolidated: new Date().toISOString(),
    });

    appendConsolidationLog(userId, {
      level: 'quarterly',
      episodesProcessed: 0,
      profileUpdated: true,
      summary: `Quarterly summary for ${period}: ${parsed.summary.slice(0, 100)}...`,
    });

    return { success: true, level: 'quarterly', period, summary: parsed.summary };
  } catch (error) {
    console.error('[Consolidation:quarterly] Error:', error.message);
    return { success: false, level: 'quarterly', summary: error.message };
  }
}

/**
 * Full reorganize — 大模型全量整理历史记忆（智能分流）。
 *
 * 与 nightly 不同：处理「全部」episodes（不止过去 24h / 未整合的）。
 * 智能分流由 consolidateSemanticMemory 天然完成：
 *   - 非矛盾的高置信更新 → 直接写入画像（autoApplied）
 *   - 矛盾 / 需确认项 → 进 conflicts.json，等用户在「变更确认」里逐条处理
 * 无 LLM 时降级为规则整理。
 */
export async function consolidateFull(userId, options = {}) {
  const { limit = 120 } = options;
  const episodes = listEpisodes(userId, { limit });

  if (episodes.length === 0) {
    return { success: true, level: 'full', episodesProcessed: 0, autoApplied: false, conflictsDetected: 0, summary: '还没有记忆可整理' };
  }

  const router = getLLMRouter();
  if (!router.isAvailable()) {
    const r = consolidateRuleBased(userId);
    return {
      success: true, level: 'full', episodesProcessed: r.episodesProcessed,
      autoApplied: r.profileUpdated, conflictsDetected: 0, summary: r.summary, llm_unavailable: true,
    };
  }

  let result;
  try {
    result = await consolidateSemanticMemory(userId, episodes, router);
  } catch (error) {
    console.error('[Consolidation:full] Semantic consolidation failed:', error.message);
    return { success: false, level: 'full', summary: error.message };
  }

  // 顺带刷新工作记忆（近期 episodes）
  try { await consolidateWorkingMemory(userId, episodes.slice(0, 20), router); } catch { /* best-effort */ }

  markEpisodesConsolidated(userId, episodes.map(ep => ep.id));
  if (result.updated) updateProfile(userId, { last_consolidated: new Date().toISOString() });

  // 图鉴自动建卡建议（确认制，永不抛错）。
  try { await suggestEntities(userId, episodes); } catch { /* best-effort */ }

  appendConsolidationLog(userId, {
    level: 'full',
    episodesProcessed: episodes.length,
    profileUpdated: result.updated,
    conflictsDetected: result.conflictsDetected || 0,
    summary: result.summary || `Full reorganize: ${episodes.length} episodes`,
  });

  return {
    success: true,
    level: 'full',
    episodesProcessed: episodes.length,
    autoApplied: result.updated,
    conflictsDetected: result.conflictsDetected || 0,
    summary: result.summary,
  };
}

// ══════════════════════════════════════════════════════════════════
//  Entity card suggestions (图鉴自动建卡建议，确认制)
// ══════════════════════════════════════════════════════════════════

/**
 * Scan a consolidation batch for recurring entities that don't have a codex
 * card yet and emit `entity_suggest` pendingCaptures (user confirms → card is
 * created and evidence episodes get back-linked, see the captures decide
 * route). LLM path reads the batch; rule fallback (proxy-down safe) proposes
 * profile relationship names that were never carded. Never throws.
 *
 * @returns {number} suggestions created
 */
export async function suggestEntities(userId, episodes = []) {
  const suggestions = new Map(); // lowercased name → { name, entity_type, episode_ids, count }
  const addSuggestion = (name, entityType, episodeIds = [], count = 1) => {
    const clean = String(name || '').trim();
    if (clean.length < 2) return;
    const key = clean.toLowerCase();
    const cur = suggestions.get(key) || { name: clean, entity_type: 'person', episode_ids: [], count: 0 };
    if (ENTITY_TYPES.includes(entityType)) cur.entity_type = entityType;
    cur.episode_ids = [...new Set([...cur.episode_ids, ...episodeIds.map(String)])];
    cur.count += count;
    suggestions.set(key, cur);
  };

  const router = getLLMRouter();
  if (router.isAvailable() && episodes.length > 0) {
    try {
      const lines = episodes.slice(0, 30)
        .map(ep => `[${ep.id}] ${(ep.content_raw || '').slice(0, 120)}`)
        .join('\n');
      const resp = await router.runTask('memory.entities.suggest', [
        {
          role: 'system',
          content: `从用户的记忆碎片中识别反复出现、值得建立"图鉴卡片"的具体实体（人/宠物/物品/地点/事件/组织）。
只输出用户身边真实、具体、被多次提到或明显重要的实体；泛称（"朋友""公司"）、用户自己、一次性提到的路人不算。
返回 JSON：{"entities":[{"name":"...","entity_type":"person|pet|object|place|event|org|other","episode_ids":["提到它的碎片id"],"count":出现次数}]}
没有则返回 {"entities":[]}`,
        },
        { role: 'user', content: lines },
      ]);
      const parsed = resp.json;
      for (const s of (parsed.entities || [])) {
        addSuggestion(s.name, s.entity_type, Array.isArray(s.episode_ids) ? s.episode_ids : [], Number(s.count) || 1);
      }
    } catch (error) {
      console.error('[Consolidation:suggestEntities] LLM pass failed:', error.message);
    }
  }

  // Rule fallback / supplement: profile relationship names never carded.
  // (These normally arrive via seedRelationshipsFromPcp; the matchEntityByName
  // check below makes the two paths idempotent against each other.)
  try {
    const profile = getProfile(userId);
    const names = [
      ...(profile.semantic_memory?.relationship_map || []),
      ...(profile.core_identity?.key_relationships || []).map(k => (typeof k === 'string' ? { name: k } : k)),
    ];
    for (const n of names) addSuggestion(n?.name, 'person', [], 2);
  } catch { /* non-fatal */ }

  let created = 0;
  for (const sug of suggestions.values()) {
    if (sug.count < 2) continue;
    try {
      if (libStore.matchEntityByName(userId, sug.name)) continue; // already carded
      const payload = {
        name: sug.name,
        entity_type: sug.entity_type,
        evidence_count: sug.count,
        episode_ids: sug.episode_ids.slice(0, 20),
        content: `建议为「${sug.name}」建一张图鉴卡（近期提到 ${sug.count} 次）`,
      };
      if (libStore.findDuplicateCapture(userId, { kind: 'entity_suggest', payload })) continue;
      libStore.createCapture(userId, {
        kind: 'entity_suggest',
        status: 'pending',
        payload,
        confidence: 0.7,
        importance: 'normal',
        source: 'consolidation',
      });
      created += 1;
    } catch (error) {
      console.error('[Consolidation:suggestEntities] capture error:', error.message);
    }
  }
  return created;
}

// ══════════════════════════════════════════════════════════════════
//  Legacy-compatible consolidate() entry point
// ══════════════════════════════════════════════════════════════════

export async function consolidate(userId, options = {}) {
  const { force = false, batchSize = CONSOLIDATION_BATCH_SIZE, level = 'nightly' } = options;

  switch (level) {
    case 'session':
      return consolidateSessionEnd(userId, options);
    case 'weekly':
      return consolidateWeekly(userId);
    case 'quarterly':
      return consolidateQuarterly(userId);
    case 'nightly':
    default:
      if (!force) {
        const episodes = getUnconsolidatedEpisodes(userId, { limit: 1 });
        if (episodes.length === 0) {
          return { success: true, episodesProcessed: 0, profileUpdated: false, summary: 'No new episodes' };
        }
      }
      return consolidateNightly(userId, { batchSize });
  }
}

// ── Semantic memory consolidation (internal) ──────────────────────

async function consolidateSemanticMemory(userId, episodes, router) {
  const profile = getProfile(userId);

  const currentProfile = {
    core_identity: profile.core_identity,
    semantic_memory: profile.semantic_memory,
  };

  const episodeTexts = episodes.map((ep, i) => {
    const dateStr = ep.created_at?.split('T')[0] || '';
    const typeLabels = {
      important_info: '重要信息', personal_trait: '个人特质',
      key_event: '关键事件', date_reminder: '日期提醒',
      milestone: '里程碑', failure_learning: '教训',
      decision: '决策', relationship_event: '关系事件',
    };
    return `${i + 1}. [${typeLabels[ep.type] || ep.type}][${dateStr}] ${ep.content_raw}`;
  }).join('\n');

  const prompt = SEMANTIC_CONSOLIDATION_PROMPT
    .replace('{CURRENT_PROFILE}', JSON.stringify(currentProfile, null, 2))
    .replace('{EPISODES}', episodeTexts);

  let parsed;
  try {
    const response = await router.runTask('memory.consolidate.semantic', [
      { role: 'system', content: '你是一个 PCP 画像分析师。请严格按要求输出 JSON。' },
      { role: 'user', content: prompt },
    ]);
    parsed = response.json;
  } catch (error) {
    console.error('[Consolidation] semantic LLM failed:', error.message);
    return { updated: false, summary: 'LLM response parse error', conflictsDetected: 0 };
  }

  // Handle conflicts
  let conflictsDetected = 0;
  if (parsed.conflicts?.length > 0) {
    for (const conflict of parsed.conflicts) {
      addConflict(userId, {
        field: conflict.field,
        old_value: conflict.old_value,
        new_value: conflict.new_value,
        old_evidence: conflict.evidence || null,
        new_evidence: episodeTexts.slice(0, 200),
      });
      conflictsDetected++;
    }
  }

  // Apply updates (skip conflicting fields)
  const conflictFields = new Set((parsed.conflicts || []).map(c => c.field));
  const patch = {};
  let updated = false;

  if (parsed.core_identity) {
    const cleanCI = { ...parsed.core_identity };
    for (const field of conflictFields) {
      if (field.startsWith('core_identity.')) {
        const subField = field.replace('core_identity.', '');
        delete cleanCI[subField];
      }
    }
    patch.core_identity = cleanCI;
    updated = true;
  }

  if (parsed.semantic_memory) {
    patch.semantic_memory = parsed.semantic_memory;
    updated = true;
  }

  if (updated) {
    updateProfile(userId, patch);
  }

  return {
    updated,
    summary: parsed.changes_summary || 'Profile updated',
    coreChanged: parsed.core_identity_changed || false,
    conflictsDetected,
  };
}

// ── Working memory consolidation (internal) ───────────────────────

async function consolidateWorkingMemory(userId, episodes, router) {
  const recentEpisodes = episodes.slice(0, 15);
  const working = getWorkingMemory(userId);

  const episodeTexts = recentEpisodes.map((ep, i) => {
    const dateStr = ep.created_at?.split('T')[0] || '';
    return `${i + 1}. [${dateStr}] ${ep.content_raw?.slice(0, 200) || ''}`;
  }).join('\n');

  const prompt = WORKING_MEMORY_UPDATE_PROMPT
    .replace('{EPISODES}', episodeTexts)
    .replace('{CURRENT_WORKING}', JSON.stringify(working, null, 2));

  let parsed;
  try {
    const response = await router.runTask('memory.consolidate.working', [
      { role: 'user', content: prompt },
    ]);
    parsed = response.json;
  } catch {
    return;
  }

  const patch = {};
  if (parsed.active_goals) patch.active_goals = parsed.active_goals;
  if (parsed.current_context) patch.current_context = parsed.current_context;
  if (parsed.recent_decisions) patch.recent_decisions = parsed.recent_decisions;
  if (parsed.pending_items) patch.pending_items = parsed.pending_items;
  if (parsed.conversation_continuity) patch.conversation_continuity = parsed.conversation_continuity;

  // Legacy compatibility
  if (parsed.active_focus) patch.current_context = { ...patch.current_context, focus_domain: parsed.active_focus };
  if (parsed.emotional_trend) patch.current_context = { ...patch.current_context, emotional_state: parsed.emotional_trend };

  if (Object.keys(patch).length > 0) {
    updateWorkingMemory(userId, patch);
  }
}

// ── Rule-based fallback ───────────────────────────────────────────

export function consolidateRuleBased(userId) {
  const episodes = getUnconsolidatedEpisodes(userId, { limit: 100 });
  if (episodes.length === 0) {
    return { success: true, episodesProcessed: 0, profileUpdated: false, summary: 'Nothing to consolidate' };
  }

  const profile = getProfile(userId);
  let profileChanged = false;

  for (const ep of episodes) {
    // Extract skills from tags
    for (const tag of ep.tags || []) {
      if (tag.startsWith('skill:')) {
        const skillName = tag.replace(/^skill:/, '');
        // Skill slots need a single home dimension; 'growth' stays the
        // fallback HERE (a skill always lives somewhere), unlike fragment
        // tagging where empty is valid.
        const dim = classifyDimensions(ep.content_raw, ep.tags)[0] || 'growth';
        const dimData = profile.semantic_memory.dimensions[dim];
        if (dimData && !dimData.skills.includes(skillName)) {
          dimData.skills.push(skillName);
          profileChanged = true;
        }
      }
    }

    // Map episode type to trait extraction
    if (ep.type === 'personal_trait' && ep.content_raw) {
      const content = ep.content_raw.slice(0, 100);
      if (!profile.core_identity.traits.some(t => content.includes(t))) {
        profile.core_identity.traits.push(content);
        if (profile.core_identity.traits.length > 10) {
          profile.core_identity.traits = profile.core_identity.traits.slice(-10);
        }
        profileChanged = true;
      }
    }

    // Auto-detect milestones (high impact)
    if (ep.type === 'milestone' || (ep.impact_score && ep.impact_score > 0.7)) {
      const milestones = profile.semantic_memory.milestone_events || [];
      if (!milestones.some(m => m.event === ep.content_raw)) {
        milestones.push({
          event: ep.content_raw?.slice(0, 200),
          impact: ep.impact_score || 0.8,
          ts: ep.created_at,
          tags: ep.tags || [],
        });
        profile.semantic_memory.milestone_events = milestones.slice(-20);
        profileChanged = true;
      }
    }

    // Auto-detect failure learnings
    if (ep.type === 'failure_learning') {
      const learnings = profile.semantic_memory.failure_learnings || [];
      learnings.push({
        context: (ep.content_struct?.context || ep.tags?.join(', ') || ''),
        lesson: ep.content_raw?.slice(0, 200),
        applied: false,
      });
      profile.semantic_memory.failure_learnings = learnings.slice(-10);
      profileChanged = true;
    }
  }

  if (profileChanged) {
    updateProfile(userId, {
      core_identity: profile.core_identity,
      semantic_memory: profile.semantic_memory,
      last_consolidated: new Date().toISOString(),
    });
  }

  markEpisodesConsolidated(userId, episodes.map(ep => ep.id));

  appendConsolidationLog(userId, {
    level: 'rule_based',
    episodesProcessed: episodes.length,
    profileUpdated: profileChanged,
    workingPruned: false,
    summary: `Rule-based: ${episodes.length} episodes`,
  });

  return {
    success: true,
    episodesProcessed: episodes.length,
    profileUpdated: profileChanged,
    summary: `Rule-based: ${episodes.length} episodes`,
  };
}

export default {
  consolidate,
  consolidateSessionEnd,
  consolidateNightly,
  consolidateWeekly,
  consolidateQuarterly,
  consolidateFull,
  consolidateRuleBased,
};
