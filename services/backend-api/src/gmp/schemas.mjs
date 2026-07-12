/**
 * GEDO Memory Pack v0.1 — schema loader + compiled validators.
 *
 * Loads the canonical JSON Schemas from /specs/gmp/v0.1/, compiles them
 * once with ajv (Draft 2020-12 + ajv-formats), and exports both the raw
 * schemas (for downstream tooling) and per-layer validate() functions.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// services/backend-api/src/gmp/ → repo-root/specs/gmp/v0.1
const SCHEMA_DIR = path.resolve(__dirname, '../../../../specs/gmp/v0.1');

export const GMP_SCHEMA_VERSION = '0.1';
export const GMP_SCHEMA_ID = `gedo-memory-pack/v${GMP_SCHEMA_VERSION}`;

function load(name) {
  const p = path.join(SCHEMA_DIR, `${name}.schema.json`);
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export const SCHEMAS = {
  manifest:   load('manifest'),
  identity:   load('identity'),
  semantic:   load('semantic'),
  procedural: load('procedural'),
  episode:    load('episodes'),
};

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

const validators = {};
for (const [name, schema] of Object.entries(SCHEMAS)) {
  validators[name] = ajv.compile(schema);
}

/**
 * Validate a parsed JSON document against one of the v0.1 schemas.
 * @param {'manifest'|'identity'|'semantic'|'procedural'|'episode'} kind
 * @param {object} doc
 * @returns {{ valid: boolean, errors?: Array<{path: string, message: string}> }}
 */
export function validate(kind, doc) {
  const fn = validators[kind];
  if (!fn) throw new Error(`Unknown schema: ${kind}`);
  if (fn(doc)) return { valid: true };
  return {
    valid: false,
    errors: (fn.errors || []).map(e => ({
      path: e.instancePath || '/',
      message: e.message || 'invalid',
    })),
  };
}

/** Throw if invalid. Useful inside the importer. */
export function assertValid(kind, doc) {
  const r = validate(kind, doc);
  if (!r.valid) {
    const err = new Error(`Invalid ${kind}: ${r.errors.map(e => `${e.path} ${e.message}`).join('; ')}`);
    err.code = 'GMP_SCHEMA_INVALID';
    err.details = r.errors;
    throw err;
  }
}

export default { SCHEMAS, validate, assertValid, GMP_SCHEMA_VERSION, GMP_SCHEMA_ID };
