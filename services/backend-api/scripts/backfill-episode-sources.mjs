#!/usr/bin/env node
/**
 * Backfill episode source links (IA v2 批次0).
 *
 * 两件事，一次遍历：
 *  1. source_id 回链 —— 历史上 approveCaptureWithEdits 落库 episode 时丢弃了
 *     capture.source_id；用已决 captures（status=confirmed/saved 且同时带
 *     source_id 与 episode_id）把归属写回对应 episode，支撑记忆流「按来源过滤」。
 *  2. source 脏值修正 —— 旧前端手动记录弹窗可写入枚举外的 'chat_extract'
 *     （后端从不产生该值），统一改写为 'text'，保证 origin 过滤口径稳定。
 *
 * Run from services/backend-api (so data dir resolves):
 *   node scripts/backfill-episode-sources.mjs --dry-run     # report only
 *   node scripts/backfill-episode-sources.mjs               # all users
 *   node scripts/backfill-episode-sources.mjs --user=<uuid> # one user
 *
 * 幂等：已带 source_id / 已是白名单值的行跳过，重复执行无副作用。
 */

import fs from 'node:fs';
import '../src/lib/load-env.mjs';
import { getMemoryStore } from '../src/memory/store/index.mjs';
import { Store } from '../src/lib/store.mjs';
import { dataPath } from '../src/lib/data-dir.mjs';

const DRY = process.argv.includes('--dry-run');
const userArg = (process.argv.find(a => a.startsWith('--user=')) || '').split('=')[1] || null;

function listUserIds() {
  const dir = dataPath('memories');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);
}

function main() {
  const mem = getMemoryStore();
  const store = Store();
  const users = userArg ? [userArg] : listUserIds();
  console.log(`[backfill-sources] users=${users.length} dryRun=${DRY}`);

  let linked = 0;
  let dangling = 0;
  let dirtyFixed = 0;

  for (const uid of users) {
    const episodes = mem.listEpisodes(uid, { limit: 1000000, includeExcluded: true });
    const byId = new Map(episodes.map(e => [e.id, e]));

    // 1) source_id 回链：已决导入候选 → episode
    //    listCaptures 不筛 status 时返回该用户全部候选（含已决）；
    //    maxAgeDays 给大值避免这次读把长期未决候选顺手过期掉。
    const decided = store.listCaptures(uid, { limit: 1000000, maxAgeDays: 36500 })
      .filter(c => (c.status === 'confirmed' || c.status === 'saved')
        && c.source_id && c.episode_id);
    for (const c of decided) {
      const ep = byId.get(c.episode_id);
      if (!ep) { dangling += 1; continue; }        // episode 已被用户删除
      if (ep.source_id === c.source_id) continue;  // 已回链，幂等跳过
      linked += 1;
      console.log(`  [link] ${uid} episode=${c.episode_id} ← source=${c.source_id}${DRY ? ' (dry)' : ''}`);
      if (!DRY) mem.setEpisodeFlag(uid, c.episode_id, { source_id: c.source_id });
    }

    // 2) source 脏值修正：枚举外的 'chat_extract' → 'text'
    for (const ep of episodes) {
      if (ep.source !== 'chat_extract') continue;
      dirtyFixed += 1;
      console.log(`  [fix]  ${uid} episode=${ep.id} source chat_extract → text${DRY ? ' (dry)' : ''}`);
      if (!DRY) mem.setEpisodeFlag(uid, ep.id, { source: 'text' });
    }
  }

  console.log(`[backfill-sources] done. linked=${linked} dirtyFixed=${dirtyFixed} danglingEpisodeRefs=${dangling}`);
}

main();
