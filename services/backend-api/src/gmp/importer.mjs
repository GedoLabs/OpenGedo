/**
 * GEDO Memory Pack v0.1 importer.
 *
 * Reads a .gmp ZIP buffer, validates each layer against the v0.1
 * schemas, dedupes episodes by id (cosine-merge is deferred to Phase 1
 * conflict-resolver work), surfaces identity conflicts via
 * memory-file.service.addConflict(), and persists the result through
 * the existing PCP write path so downstream code keeps working.
 *
 * Returns a summary object the frontend can show in a confirmation
 * modal:
 *   {
 *     ok, imported_at, episodes_added, episodes_skipped, episodes_invalid,
 *     identity_changed, semantic_changed, procedural_changed,
 *     conflicts_detected, manifest, warnings
 *   }
 */

import JSZip from 'jszip';
import fs from 'node:fs';
import path from 'node:path';

import { GMP_SCHEMA_ID, validate, assertValid } from './schemas.mjs';
import { gmpToPcpProfile } from './pcp-mapping.mjs';
import { replaceProcedural } from './procedural-store.mjs';
import { getMemoryStore } from '../memory/store/index.mjs';
import { Store } from '../lib/store.mjs';
const {
  getProfile,
  replaceProfile,
  addEpisode,
  listEpisodes,
  addConflict,
} = getMemoryStore();
const libStore = Store();
import { detectConflicts } from '../memory/conflict-resolver.mjs';

/**
 * Import a .gmp pack into a user's PCP store.
 *
 * @param {string} userId
 * @param {Buffer} buffer  raw .gmp bytes (ZIP)
 * @param {{ allowOverwriteProfile?: boolean, dryRun?: boolean }} [opts]
 */
export async function importPack(userId, buffer, opts = {}) {
  if (!Buffer.isBuffer(buffer) && !(buffer instanceof Uint8Array)) {
    throw makeError('GMP_BAD_INPUT', 'Expected a Buffer or Uint8Array');
  }
  if (!buffer.length) {
    throw makeError('GMP_EMPTY', 'Empty upload');
  }

  let zip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch (e) {
    throw makeError('GMP_NOT_ZIP', `Not a valid ZIP: ${e?.message || 'unknown'}`);
  }

  // ── Manifest ────────────────────────────────────────────────────
  const manifestText = await readEntry(zip, 'manifest.json', { required: true });
  const manifest = parseJson(manifestText, 'manifest.json');
  assertValid('manifest', manifest);
  if (!String(manifest.schema || '').startsWith('gedo-memory-pack/v')) {
    throw makeError('GMP_BAD_SCHEMA', `Unknown schema: ${manifest.schema}`);
  }
  const major = parseInt(String(manifest.schema).replace('gedo-memory-pack/v', '').split('.')[0], 10);
  if (Number.isNaN(major) || major > 0) {
    throw makeError('GMP_VERSION_TOO_NEW', `Unsupported major version in ${manifest.schema} (importer only knows ${GMP_SCHEMA_ID})`);
  }
  if (manifest.encryption && manifest.encryption !== 'none') {
    throw makeError('GMP_ENCRYPTED', `Encrypted packs not yet supported (${manifest.encryption})`);
  }

  // ── Identity / Semantic / Procedural ────────────────────────────
  const identity = parseJson(await readEntry(zip, 'identity.json', { required: false }) || '{}', 'identity.json');
  if (Object.keys(identity).length) assertValid('identity', identity);

  const semantic = parseJson(await readEntry(zip, 'semantic.json', { required: false }) || '{"version":"0.1.0","dimensions":{}}', 'semantic.json');
  assertValid('semantic', semantic);

  const procedural = parseJson(await readEntry(zip, 'procedural.json', { required: false }) || '{"version":"0.1.0","rules":[]}', 'procedural.json');
  assertValid('procedural', procedural);

  // ── Episodes (NDJSON) ───────────────────────────────────────────
  const episodesText = await readEntry(zip, 'episodes.jsonl', { required: false });
  const incomingEpisodes = [];
  const invalidEpisodes = [];
  if (episodesText) {
    const lines = episodesText.split(/\r?\n/).filter(l => l.trim());
    for (let i = 0; i < lines.length; i++) {
      let doc;
      try {
        doc = JSON.parse(lines[i]);
      } catch (e) {
        invalidEpisodes.push({ line: i + 1, reason: `parse error: ${e.message}` });
        continue;
      }
      const r = validate('episode', doc);
      if (!r.valid) {
        invalidEpisodes.push({ line: i + 1, reason: r.errors.map(e => `${e.path} ${e.message}`).join(', ') });
        continue;
      }
      incomingEpisodes.push(doc);
    }
  }

  // ── Detect identity conflicts BEFORE writing ────────────────────
  const existingProfile = getProfile(userId);
  const newProfile = gmpToPcpProfile(identity, semantic);

  const conflicts = detectConflicts(existingProfile, newProfile);

  // ── Dedup episodes by id ────────────────────────────────────────
  const existingIds = new Set(listEpisodes(userId, { limit: 50000 }).map(e => e.id));
  const toAdd = [];
  let skipped = 0;
  for (const ep of incomingEpisodes) {
    if (existingIds.has(ep.id)) {
      skipped++;
      continue;
    }
    toAdd.push(ep);
    existingIds.add(ep.id);
  }

  // ── Entity cards (图鉴, optional sidecar) ───────────────────────
  const entitiesText = await readEntry(zip, 'entities.json', { required: false });
  let entityItems = [];
  let entitiesWarning = null;
  if (entitiesText) {
    try {
      const parsed = JSON.parse(entitiesText);
      entityItems = Array.isArray(parsed?.items) ? parsed.items.slice(0, 500) : [];
    } catch (e) {
      entitiesWarning = `entities.json parse error — skipped (${e.message})`;
    }
  }

  const summary = {
    ok: true,
    imported_at: new Date().toISOString(),
    manifest,
    episodes_added: 0,
    episodes_skipped_duplicate: skipped,
    episodes_invalid: invalidEpisodes,
    entities_added: 0,
    identity_changed: false,
    semantic_changed: false,
    procedural_changed: false,
    conflicts_detected: conflicts,
    warnings: [],
  };
  if (entitiesWarning) summary.warnings.push(entitiesWarning);

  if (opts.dryRun) {
    summary.episodes_added = toAdd.length;
    summary.entities_added = entityItems.length;
    summary.identity_changed = Boolean(identity && Object.keys(identity).length);
    summary.semantic_changed = Boolean(semantic && Object.keys(semantic.dimensions || {}).length);
    summary.procedural_changed = Boolean(procedural?.rules?.length);
    return summary;
  }

  // ── Write profile ───────────────────────────────────────────────
  if (Object.keys(identity).length || Object.keys(semantic.dimensions || {}).length) {
    // Preserve existing conflict_log + last_consolidated when overwriting.
    newProfile.conflict_log = existingProfile.conflict_log || [];
    newProfile.last_consolidated = existingProfile.last_consolidated || null;
    newProfile.created_at = existingProfile.created_at || newProfile.created_at;
    replaceProfile(userId, newProfile);
    summary.identity_changed = true;
    summary.semantic_changed = true;
  }

  // Surface conflicts via the existing log so the UI can prompt the user.
  for (const c of conflicts) {
    addConflict(userId, {
      field: c.field,
      old_value: c.old_value,
      new_value: c.new_value,
      old_evidence: { source: 'existing-pcp' },
      new_evidence: {
        source: 'gmp-import',
        manifest: { exporter: manifest.exporter, created_at: manifest.created_at },
      },
    });
  }

  // ── Write procedural ────────────────────────────────────────────
  if (procedural?.rules?.length || procedural?.preferences) {
    replaceProcedural(userId, procedural);
    summary.procedural_changed = true;
  }

  // ── Write episodes ──────────────────────────────────────────────
  // Use addEpisode() to keep the existing JSONL path; it will assign a
  // fresh id, so we preserve the source id under content_struct so a
  // re-export keeps stable identity.
  for (const ep of toAdd) {
    addEpisode(userId, {
      type: ep.type,
      contentRaw: ep.content_raw,
      tags: ep.tags || [],
      source: ep.source || 'consolidation',
      contentStruct: { ...(ep.content_struct || {}), gmp_source_id: ep.id },
      reminderDate: ep.reminder_date || null,
      confidence: ep.confidence ?? 1,
      impactScore: ep.impact_score ?? 0.5,
    });
    summary.episodes_added++;
  }

  // ── Write entity cards ──────────────────────────────────────────
  // Dedup by id-or-name; avatar_visible is forced OFF on import so a pack
  // can never silently re-publish card facts to the public persona.
  for (const ent of entityItems) {
    if (!ent || !String(ent.name || '').trim()) continue;
    try {
      const dup = (ent.id && libStore.getEntity(userId, ent.id))
        || libStore.matchEntityByName(userId, ent.name, { type: ent.entity_type });
      if (dup) continue;
      libStore.upsertEntity(userId, {
        entity_type: ent.entity_type,
        name: ent.name,
        aliases: Array.isArray(ent.aliases) ? ent.aliases : [],
        emoji: ent.emoji || '',
        image_url: ent.image_url || null,
        relation: ent.relation || '',
        facts: Array.isArray(ent.facts) ? ent.facts : [],
        note: ent.note || '',
        dimensions: Array.isArray(ent.dimensions) ? ent.dimensions : [],
        tags: Array.isArray(ent.tags) ? ent.tags : [],
        ai_excluded: ent.ai_excluded === true,
        avatar_visible: false,
        source: ent.source || 'manual',
        role: ent.role || '',
        trust: ent.trust || 'med',
      });
      summary.entities_added++;
    } catch (e) {
      summary.warnings.push(`entity "${ent.name}" skipped: ${e.message}`);
    }
  }

  return summary;
}

// ════════════════════════════════════════════════════════════════════
//  helpers
// ════════════════════════════════════════════════════════════════════

async function readEntry(zip, name, { required = false } = {}) {
  const entry = zip.file(name);
  if (!entry) {
    if (required) throw makeError('GMP_MISSING_ENTRY', `${name} missing from pack`);
    return null;
  }
  return entry.async('string');
}

function parseJson(text, where) {
  try {
    return JSON.parse(text);
  } catch (e) {
    throw makeError('GMP_BAD_JSON', `${where}: ${e.message}`);
  }
}

function makeError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * Convenience: read a buffer back from a .gmp file path. Used by tests.
 */
export async function importPackFromFile(userId, filePath, opts) {
  const buf = fs.readFileSync(path.resolve(filePath));
  return importPack(userId, buf, opts);
}

export default { importPack, importPackFromFile };
