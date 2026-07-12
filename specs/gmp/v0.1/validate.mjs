#!/usr/bin/env node
/**
 * GEDO Memory Pack v0.1 — sample validator
 *
 * Validates the included sample.gmp/ fixture against all v0.1 schemas
 * (manifest / identity / semantic / procedural / episodes).
 *
 * Usage:
 *   cd specs/gmp/v0.1
 *   node validate.mjs                          # validate the bundled sample
 *   node validate.mjs path/to/extracted.gmp/   # validate any extracted .gmp directory
 */

import { readFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const __dirname = dirname(fileURLToPath(import.meta.url));
const target = resolve(process.argv[2] || join(__dirname, 'examples', 'sample.gmp'));

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

const schemas = {
  manifest: JSON.parse(readFileSync(join(__dirname, 'manifest.schema.json'), 'utf8')),
  identity: JSON.parse(readFileSync(join(__dirname, 'identity.schema.json'), 'utf8')),
  semantic: JSON.parse(readFileSync(join(__dirname, 'semantic.schema.json'), 'utf8')),
  procedural: JSON.parse(readFileSync(join(__dirname, 'procedural.schema.json'), 'utf8')),
  episode: JSON.parse(readFileSync(join(__dirname, 'episodes.schema.json'), 'utf8')),
};

const validators = Object.fromEntries(
  Object.entries(schemas).map(([k, s]) => [k, ajv.compile(s)])
);

let errors = 0;

function check(name, validator, doc, where) {
  if (validator(doc)) {
    console.log(`✓  ${name.padEnd(11)} ${where}`);
  } else {
    errors++;
    console.error(`✗  ${name.padEnd(11)} ${where}`);
    for (const e of validator.errors || []) {
      console.error(`     ${e.instancePath || '/'} ${e.message}`);
    }
  }
}

// JSON files
for (const name of ['manifest', 'identity', 'semantic', 'procedural']) {
  const path = join(target, `${name}.json`);
  let doc;
  try {
    doc = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    errors++;
    console.error(`✗  ${name.padEnd(11)} ${path} — ${e.message}`);
    continue;
  }
  check(name, validators[name], doc, path);
}

// JSONL: one validation per line
{
  const path = join(target, 'episodes.jsonl');
  const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
  let lineNum = 0;
  let lineErrors = 0;
  for (const line of lines) {
    lineNum++;
    let doc;
    try {
      doc = JSON.parse(line);
    } catch (e) {
      lineErrors++;
      console.error(`✗  episode     ${path}:${lineNum} — invalid JSON: ${e.message}`);
      continue;
    }
    if (!validators.episode(doc)) {
      lineErrors++;
      console.error(`✗  episode     ${path}:${lineNum}`);
      for (const e of validators.episode.errors || []) {
        console.error(`     ${e.instancePath || '/'} ${e.message}`);
      }
    }
  }
  if (lineErrors === 0) {
    console.log(`✓  episode     ${path} (${lines.length} lines)`);
  } else {
    errors += lineErrors;
  }
}

if (errors > 0) {
  console.error(`\n${errors} error(s)`);
  process.exit(1);
}
console.log('\nAll files valid against gedo-memory-pack/v0.1.');
