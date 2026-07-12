/**
 * GEDO Memory Pack v0.1 exporter.
 *
 * Reads the user's PCP profile + episodes + procedural store, translates
 * to .gmp shapes, validates each layer against the v0.1 schemas, renders
 * platform adapter views, and assembles a single ZIP buffer suitable for
 * streaming as an HTTP attachment.
 *
 * Output layout (matches specs/gmp/v0.1/README.md):
 *   manifest.json
 *   identity.json
 *   semantic.json
 *   procedural.json
 *   episodes.jsonl
 *   adapters/
 *     system_prompt.md
 *     chatgpt_memory.txt
 *     claude_project.md
 *     gemini_gem.md
 */

import crypto from 'node:crypto';
import JSZip from 'jszip';

import { GMP_SCHEMA_ID, GMP_SCHEMA_VERSION, validate } from './schemas.mjs';
import {
  pcpProfileToGmpIdentity,
  pcpProfileToGmpSemantic,
  pcpEpisodeToGmpEpisode,
} from './pcp-mapping.mjs';
import { getProcedural } from './procedural-store.mjs';
import * as systemPrompt   from './adapters/system_prompt.mjs';
import * as chatgptMemory  from './adapters/chatgpt_memory.mjs';
import * as claudeProject  from './adapters/claude_project.mjs';
import * as geminiGem      from './adapters/gemini_gem.mjs';
import { getMemoryStore } from '../memory/store/index.mjs';
import { Store } from '../lib/store.mjs';
const { getProfile, listEpisodes } = getMemoryStore();
const libStore = Store();

const EPISODE_LIMIT = 10000;

/**
 * Build a complete .gmp pack for a user.
 *
 * @param {string} userId
 * @param {{ exporter?: string, displayName?: string, includeAdapters?: boolean }} [opts]
 * @returns {Promise<{ buffer: Buffer, filename: string, manifest: object, warnings: string[] }>}
 */
export async function buildPack(userId, opts = {}) {
  const exporter = opts.exporter || 'gedo.ai/0.1.0';
  const includeAdapters = opts.includeAdapters !== false;

  // Read PCP state.
  const profile = getProfile(userId);
  const episodes = listEpisodes(userId, { limit: EPISODE_LIMIT });
  const procedural = getProcedural(userId);

  // Translate to .gmp shapes.
  const identity = pcpProfileToGmpIdentity(profile);
  const semantic = pcpProfileToGmpSemantic(profile);
  const proceduralOut = ensureProcedural(procedural);
  const episodeDocs = episodes.map(pcpEpisodeToGmpEpisode);

  // Validate against v0.1 schemas — fail fast so we never ship a broken pack.
  const warnings = [];
  assertOrWarn('identity', identity, warnings);
  assertOrWarn('semantic', semantic, warnings);
  assertOrWarn('procedural', proceduralOut, warnings);

  const validEpisodes = [];
  for (let i = 0; i < episodeDocs.length; i++) {
    const r = validate('episode', episodeDocs[i]);
    if (r.valid) {
      validEpisodes.push(episodeDocs[i]);
    } else {
      warnings.push(`episode[${i}] dropped: ${r.errors.map(e => `${e.path} ${e.message}`).join(', ')}`);
    }
  }

  const filledDimensions = Object.values(semantic.dimensions || {})
    .filter(d => d && (d.summary || (Array.isArray(d.skills) && d.skills.length))).length;

  const manifest = {
    schema: GMP_SCHEMA_ID,
    exporter,
    owner: {
      uid_hash: hashUid(userId),
      uid_salt: '0'.repeat(32),
      ...(opts.displayName ? { display_name: String(opts.displayName).slice(0, 128) } : {}),
    },
    created_at: new Date().toISOString(),
    stats: {
      episodes: validEpisodes.length,
      skills: countSkills(semantic),
      goals_active: 0, // not modelled in PCP yet
      rules: (proceduralOut.rules || []).length,
      dimensions_filled: filledDimensions,
    },
    encryption: 'none',
  };
  assertOrWarn('manifest', manifest, warnings);

  // Assemble the ZIP.
  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  zip.file('identity.json', JSON.stringify(identity, null, 2));
  zip.file('semantic.json', JSON.stringify(semantic, null, 2));
  zip.file('procedural.json', JSON.stringify(proceduralOut, null, 2));
  zip.file('episodes.jsonl', validEpisodes.map(e => JSON.stringify(e)).join('\n') + (validEpisodes.length ? '\n' : ''));

  // Entity cards (图鉴) — optional sidecar since v0.1; importers that don't
  // know it simply ignore the entry (readEntry required:false convention).
  try {
    const entities = libStore.listEntities(userId);
    zip.file('entities.json', JSON.stringify({ version: '0.1.0', items: entities }, null, 2));
  } catch (e) {
    warnings.push(`entities.json skipped: ${e.message}`);
  }

  if (includeAdapters) {
    const adapterCtx = { identity, semantic, procedural: proceduralOut };
    zip.file('adapters/system_prompt.md', systemPrompt.render(adapterCtx));
    zip.file('adapters/chatgpt_memory.txt', chatgptMemory.render(adapterCtx));
    zip.file('adapters/claude_project.md', claudeProject.render(adapterCtx));
    zip.file('adapters/gemini_gem.md', geminiGem.render(adapterCtx));
  }

  const buffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  const safeName = (identity.name || 'gedo')
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .slice(0, 32) || 'gedo';
  const dateTag = new Date().toISOString().slice(0, 10);
  const filename = `${safeName}-${dateTag}.gmp`;

  return { buffer, filename, manifest, warnings };
}

function ensureProcedural(doc) {
  return {
    version: doc?.version || `${GMP_SCHEMA_VERSION}.0`,
    rules: Array.isArray(doc?.rules) ? doc.rules : [],
    ...(doc?.preferences ? { preferences: doc.preferences } : {}),
  };
}

function assertOrWarn(kind, doc, warnings) {
  const r = validate(kind, doc);
  if (!r.valid) {
    const err = new Error(`Cannot export — ${kind} fails v0.1 schema: ${r.errors.map(e => `${e.path} ${e.message}`).join('; ')}`);
    err.code = 'GMP_EXPORT_INVALID';
    err.details = r.errors;
    throw err;
  }
  return warnings;
}

function countSkills(semantic) {
  const set = new Set();
  for (const dim of Object.values(semantic.dimensions || {})) {
    for (const s of dim.skills || []) set.add(s);
  }
  return set.size;
}

function hashUid(userId) {
  return crypto.createHash('sha256').update(String(userId)).digest('hex');
}

export default { buildPack };
