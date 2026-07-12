/**
 * Lightweight on-disk store for L5 procedural rules.
 *
 * memory-file.service.mjs already owns L1/L2/L4 files; we sit beside
 * it as `procedural.json` per user. When the `procedural_rules` table
 * lands in Phase 2, swap this for a DB-backed implementation without
 * changing callers.
 */

import fs from 'node:fs';
import path from 'node:path';
import { writeJsonAtomic } from '../lib/fs-atomic.mjs';
import { GMP_SCHEMA_VERSION } from './schemas.mjs';
import { dataPath } from '../lib/data-dir.mjs';

const DATA_DIR = dataPath('memories');

function file(userId) {
  return path.join(DATA_DIR, userId, 'procedural.json');
}

function ensureDir(userId) {
  const dir = path.dirname(file(userId));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function getProcedural(userId) {
  const p = file(userId);
  if (!fs.existsSync(p)) {
    return { version: `${GMP_SCHEMA_VERSION}.0`, rules: [], preferences: {} };
  }
  try {
    const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!doc.version) doc.version = `${GMP_SCHEMA_VERSION}.0`;
    if (!Array.isArray(doc.rules)) doc.rules = [];
    return doc;
  } catch {
    return { version: `${GMP_SCHEMA_VERSION}.0`, rules: [], preferences: {} };
  }
}

export function replaceProcedural(userId, doc) {
  ensureDir(userId);
  const out = {
    version: doc?.version || `${GMP_SCHEMA_VERSION}.0`,
    rules: Array.isArray(doc?.rules) ? doc.rules : [],
    preferences: doc?.preferences || {},
  };
  writeJsonAtomic(file(userId), out);
  return out;
}

export default { getProcedural, replaceProcedural };
