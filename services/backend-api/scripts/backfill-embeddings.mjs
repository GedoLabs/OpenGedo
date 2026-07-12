#!/usr/bin/env node
/**
 * Backfill episode embeddings (P1).
 *
 * Generates + stores vectors for every episode that lacks one, so semantic
 * recall has data for memories created before embed-on-write existed.
 *
 * Run from services/backend-api (so process.cwd()/data resolves):
 *   node scripts/backfill-embeddings.mjs --dry-run        # report only
 *   node scripts/backfill-embeddings.mjs                  # embed all users
 *   node scripts/backfill-embeddings.mjs --user=<uuid>    # one user
 *
 * Requires OPENAI_API_KEY in .env (loaded below). Best-effort: failures are
 * logged, not fatal — re-run to fill any gaps.
 */

import fs from 'node:fs';
import path from 'node:path';
import '../src/lib/load-env.mjs';
import { getMemoryStore } from '../src/memory/store/index.mjs';
import { embedEpisodesBatch, isEmbeddingAvailable, embeddingInfo } from '../src/memory/embedding.mjs';
import { dataPath } from '../src/lib/data-dir.mjs';

const DRY = process.argv.includes('--dry-run');
const userArg = (process.argv.find(a => a.startsWith('--user=')) || '').split('=')[1] || null;
const BATCH = 64;

function listUserIds() {
  const dir = dataPath('memories');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);
}

async function main() {
  const store = getMemoryStore();
  const users = userArg ? [userArg] : listUserIds();
  const emb = embeddingInfo();
  console.log(`[backfill] provider=${emb.id} dim=${emb.dim} users=${users.length} dryRun=${DRY} embedderAvailable=${emb.available}`);

  if (!DRY && !isEmbeddingAvailable()) {
    console.error('[backfill] no embedding provider — set OPENAI_API_KEY in services/backend-api/.env. Aborting.');
    process.exit(1);
  }

  let totalMissing = 0;
  let totalStored = 0;
  for (const uid of users) {
    const missing = store.getEpisodesMissingEmbedding(uid, { limit: 100000 });
    if (!missing.length) continue;
    totalMissing += missing.length;
    console.log(`[backfill] ${uid}: ${missing.length} episode(s) missing embedding`);
    if (DRY) continue;
    for (let i = 0; i < missing.length; i += BATCH) {
      const slice = missing.slice(i, i + BATCH);
      const n = await embedEpisodesBatch(uid, slice);
      totalStored += n;
      console.log(`  ${Math.min(i + BATCH, missing.length)}/${missing.length} processed (stored ${n})`);
    }
  }
  console.log(`[backfill] done. missing=${totalMissing} stored=${totalStored}`);
}

main().catch(err => { console.error('[backfill] fatal:', err); process.exit(1); });
