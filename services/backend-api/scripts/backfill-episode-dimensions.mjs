#!/usr/bin/env node
/**
 * Backfill life-flower dimensions (+ entity_ids default) onto existing episodes.
 *
 * ⚠ STOP THE BACKEND FIRST — this script rewrites the monthly JSONL files in
 * place; a live server appending concurrently would lose rows.
 *
 * Run from services/backend-api (so process.cwd()/data resolves):
 *   node scripts/backfill-episode-dimensions.mjs --dry-run      # report only
 *   node scripts/backfill-episode-dimensions.mjs                # all users
 *   node scripts/backfill-episode-dimensions.mjs --user=<uuid>  # one user
 *   node scripts/backfill-episode-dimensions.mjs --no-llm       # keyword rule only
 *
 * Idempotent: a row is processed only when its `dimensions` key is ABSENT —
 * an empty [] is a valid classified answer and marks the row as done, so
 * re-running yields 0 changes. LLM classifies in batches of 20 when the
 * router is available (Anthropic needs the local proxy); the keyword
 * classifier covers failures and --no-llm.
 */

import fs from 'node:fs';
import path from 'node:path';
import '../src/lib/load-env.mjs';
import { LIFE_DIMENSIONS } from '../src/memory/types.mjs';
import { classifyDimensions } from '../src/memory/dimension-classifier.mjs';
import { getLLMRouter } from '../src/llm/router.mjs';
import { dataPath } from '../src/lib/data-dir.mjs';

const DRY = process.argv.includes('--dry-run');
const NO_LLM = process.argv.includes('--no-llm');
const userArg = (process.argv.find(a => a.startsWith('--user=')) || '').split('=')[1] || null;
// 12/批：更大的批次容易顶到输出 token 上限导致整批回落规则分类。
const BATCH = 12;

function listUserIds() {
  const dir = dataPath('memories');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);
}

const clampDims = (arr) => (Array.isArray(arr) ? arr.filter(d => LIFE_DIMENSIONS.includes(d)).slice(0, 2) : []);

/** One LLM pass over a batch; returns Map(index → dims) or null on any failure. */
async function classifyBatchLLM(router, rows) {
  try {
    const lines = rows.map((r, i) => `[${i}] ${(r.content_raw || '').slice(0, 150)}`).join('\n');
    const resp = await router.chat([
      {
        role: 'system',
        content: `给每条记忆碎片标注它触及的"生命之花"维度，枚举：${LIFE_DIMENSIONS.join('|')}。
每条 0-2 个维度，内容不沾任何维度就给空数组。
返回 JSON：{"items":[{"i":0,"dimensions":["health"]},...]}，i 为输入行号，必须覆盖所有行。`,
      },
      { role: 'user', content: lines },
    ], { temperature: 0, json: true, maxTokens: 1500 });
    const parsed = JSON.parse(resp.content);
    const map = new Map();
    for (const item of (parsed.items || [])) {
      if (Number.isInteger(item.i)) map.set(item.i, clampDims(item.dimensions));
    }
    // Every row must be covered, else fall back for the whole batch.
    for (let i = 0; i < rows.length; i++) if (!map.has(i)) return null;
    return map;
  } catch {
    return null;
  }
}

async function main() {
  const users = userArg ? [userArg] : listUserIds();
  const router = getLLMRouter();
  const llmOn = !NO_LLM && router.isAvailable();
  console.log(`[backfill-dims] users=${users.length} dryRun=${DRY} llm=${llmOn ? 'on' : 'off (keyword rule)'}`);

  let totalMissing = 0;
  let totalWritten = 0;
  let llmClassified = 0;
  let ruleClassified = 0;

  for (const uid of users) {
    const epDir = dataPath('memories', uid, 'episodes');
    if (!fs.existsSync(epDir)) continue;
    const files = fs.readdirSync(epDir).filter(f => f.endsWith('.jsonl')).sort();

    for (const file of files) {
      const filePath = path.join(epDir, file);
      const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(l => l.trim());
      const rows = lines.map((line) => {
        try { return { line, ep: JSON.parse(line) }; } catch { return { line, ep: null }; }
      });

      // Idempotency marker = key presence ([] counts as done).
      const pending = rows.filter(r => r.ep && !('dimensions' in r.ep));
      const entityFixOnly = rows.filter(r => r.ep && ('dimensions' in r.ep) && !Array.isArray(r.ep.entity_ids));
      if (pending.length === 0 && entityFixOnly.length === 0) continue;

      totalMissing += pending.length;
      console.log(`[backfill-dims] ${uid}/${file}: ${pending.length} missing dimensions, ${entityFixOnly.length} missing entity_ids`);
      if (DRY) continue;

      for (let i = 0; i < pending.length; i += BATCH) {
        const slice = pending.map(r => r.ep).slice(i, i + BATCH);
        let dimsMap = llmOn ? await classifyBatchLLM(router, slice) : null;
        if (dimsMap) llmClassified += slice.length; else ruleClassified += slice.length;
        slice.forEach((ep, j) => {
          ep.dimensions = dimsMap
            ? dimsMap.get(j)
            : classifyDimensions(ep.content_raw, ep.tags);
          if (!Array.isArray(ep.entity_ids)) ep.entity_ids = [];
        });
      }
      for (const r of entityFixOnly) r.ep.entity_ids = [];

      const updated = rows.map(r => (r.ep ? JSON.stringify(r.ep) : r.line));
      fs.writeFileSync(filePath, updated.join('\n') + '\n', 'utf8');
      totalWritten += pending.length + entityFixOnly.length;
    }
  }

  console.log(`[backfill-dims] done. missing=${totalMissing} written=${totalWritten} (llm=${llmClassified} rule=${ruleClassified})${DRY ? ' [dry-run: nothing written]' : ''}`);
}

main().catch(err => { console.error('[backfill-dims] fatal:', err); process.exit(1); });
