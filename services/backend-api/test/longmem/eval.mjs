#!/usr/bin/env node
/**
 * LongMemEval-style Evaluation Harness (P3-B)
 *
 * Runs overnight against real data and writes scores to leaderboard.md.
 * Designed to run as a CI/CD gate: exit code 1 if KPI regression detected.
 *
 * Usage:
 *   GEDO_DB_URL=postgres://... node test/longmem/eval.mjs
 *   node test/longmem/eval.mjs --dry-run    # use fixture data, no DB needed
 *
 * KPIs (P3-B acceptance):
 *   - Recall@10  ≥ 0.75
 *   - P95 latency ≤ 1500ms
 *
 * Output: appends a row to test/longmem/leaderboard.md
 */

import { writeFileSync, appendFileSync, existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LEADERBOARD_PATH = path.join(__dirname, 'leaderboard.md');

const RECALL_THRESHOLD  = 0.75;  // P3-B KPI
const LATENCY_P95_MS    = 1500;  // P3-B KPI

// ── Eval cases ────────────────────────────────────────────────────────────────
// Each case: { query, expected_ids[], notes }
// In production these come from golden.jsonl; here we include a minimal fixture.

const FIXTURE_CASES = [
  { query: '我上周在做什么项目', expected_ids: ['mem_001', 'mem_002'], notes: '时间窗口 + BM25' },
  { query: '我跑步的个人最佳成绩', expected_ids: ['mem_003'], notes: '纯向量语义' },
  { query: '今年的读书计划', expected_ids: ['mem_006', 'mem_007', 'mem_008'], notes: 'BM25 + 向量' },
  { query: '最近的睡眠情况', expected_ids: ['mem_009'], notes: '时间窗口近期' },
  { query: '工作压力的感受', expected_ids: ['mem_010', 'mem_011'], notes: '情感语义' },
  { query: '副业的想法', expected_ids: ['mem_012'], notes: '时间 + BM25' },
  { query: '学习Python的进展', expected_ids: ['mem_017', 'mem_018', 'mem_019'], notes: '技能图谱' },
];

// ── Mock retrieval for dry-run ────────────────────────────────────────────────

function mockRetrieval(query, topK = 10) {
  // Deterministic scoring: substring match simulation
  const memories = _FIXTURE_MEMORIES;
  return memories
    .map(m => {
      const score = [...query].filter(ch => m.content_raw.includes(ch)).length / query.length;
      return { ...m, _score: score };
    })
    .sort((a, b) => b._score - a._score)
    .slice(0, topK);
}

// ── Metrics ───────────────────────────────────────────────────────────────────

function recallAtK(resultIds, expectedIds) {
  if (!expectedIds.length) return 1;
  return expectedIds.filter(id => resultIds.includes(id)).length / expectedIds.length;
}

function percentile(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx    = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

// ── Main eval loop ────────────────────────────────────────────────────────────

async function runEval(opts = {}) {
  const { dryRun = false, topK = 10 } = opts;

  let retriever;
  if (dryRun) {
    retriever = async (query) => mockRetrieval(query, topK);
  } else {
    // Real DB retrieval — lazy import so dry-run never needs DB deps
    const { run } = await import('../../src/memory/retrieval/index.mjs');
    const { createDb } = await import('../../src/lib/db.mjs').catch(() => ({ createDb: null }));
    const { getLLMRouter } = await import('../../src/llm/router.mjs');

    const db  = createDb ? await createDb(process.env.GEDO_DB_URL) : null;
    const llm = getLLMRouter();

    if (!db) {
      console.error('[longmem] DB not available. Use --dry-run or set GEDO_DB_URL.');
      process.exit(1);
    }

    const TEST_USER = process.env.EVAL_USER_ID || 'test_user';
    retriever = async (query) => run(db, llm, TEST_USER, query, { topK });
  }

  // Load golden cases
  let cases = FIXTURE_CASES;
  const goldenPath = path.join(__dirname, '../retrieval/golden.jsonl');
  if (!dryRun && existsSync(goldenPath)) {
    const lines = readFileSync(goldenPath, 'utf8').trim().split('\n').filter(Boolean);
    cases = lines.map(l => JSON.parse(l));
  }

  const results = [];
  const latencies = [];

  for (const { query, expected_ids, notes = '' } of cases) {
    const t0 = Date.now();
    let retrieved = [];
    try {
      retrieved = await retriever(query);
    } catch (err) {
      console.warn(`[longmem] retrieval failed for "${query}": ${err.message}`);
    }
    const latencyMs = Date.now() - t0;
    latencies.push(latencyMs);

    const resultIds = retrieved.map(r => r.id).filter(Boolean);
    const recall    = recallAtK(resultIds, expected_ids);

    results.push({ query, recall, latencyMs, expected: expected_ids.length, found: resultIds.length, notes });
    console.log(`  [${recall >= RECALL_THRESHOLD ? '✅' : '❌'}] ${query.slice(0, 30).padEnd(32)} recall=${recall.toFixed(2)} latency=${latencyMs}ms`);
  }

  // ── Aggregate metrics ───────────────────────────────────────────────────────
  const avgRecall  = results.reduce((s, r) => s + r.recall, 0) / results.length;
  const p95Latency = percentile(latencies, 95);
  const passed     = avgRecall >= RECALL_THRESHOLD && p95Latency <= LATENCY_P95_MS;

  console.log('\n── Summary ──────────────────────────────');
  console.log(`  Avg Recall@${topK}: ${(avgRecall * 100).toFixed(1)}%  (target ≥ ${RECALL_THRESHOLD * 100}%)`);
  console.log(`  P95 Latency:  ${p95Latency}ms  (target ≤ ${LATENCY_P95_MS}ms)`);
  console.log(`  Status:       ${passed ? '✅ PASS' : '❌ FAIL'}`);
  console.log('─────────────────────────────────────────\n');

  // ── Write to leaderboard.md ─────────────────────────────────────────────────
  const date     = new Date().toISOString().slice(0, 10);
  const mode     = dryRun ? 'dry-run' : 'real';
  const newRow   = `| ${date} | ${(avgRecall * 100).toFixed(1)}% | ${p95Latency}ms | ${mode} | ${passed ? '✅' : '❌'} |\n`;

  if (!existsSync(LEADERBOARD_PATH)) {
    writeFileSync(LEADERBOARD_PATH,
      '# P3-B Retrieval Leaderboard\n\n' +
      '| Date | Recall@10 | P95 Latency | Mode | Status |\n' +
      '|------|-----------|-------------|------|--------|\n'
    );
  }
  appendFileSync(LEADERBOARD_PATH, newRow);
  console.log(`  Leaderboard updated: ${LEADERBOARD_PATH}`);

  return { avgRecall, p95Latency, passed };
}

// ── CLI entry ─────────────────────────────────────────────────────────────────

const isDryRun = process.argv.includes('--dry-run');
console.log(`\n🔍 LongMemEval Harness — ${isDryRun ? 'dry-run (fixture data)' : 'live DB'}\n`);

runEval({ dryRun: isDryRun }).then(({ passed }) => {
  process.exit(passed ? 0 : 1);
}).catch(err => {
  console.error('[longmem] eval crashed:', err);
  process.exit(1);
});

// ── Fixture memories (mirrors retrieval.test.mjs) ────────────────────────────

const _FIXTURE_MEMORIES = (() => {
  const now = Date.now();
  const d = n => new Date(now - n * 86400000).toISOString();
  return [
    { id: 'mem_001', content_raw: '上周开始做 GEDO 项目的前端重构', created_at: d(8) },
    { id: 'mem_002', content_raw: '上周三参加了产品评审会议', created_at: d(9) },
    { id: 'mem_003', content_raw: '跑步个人最佳成绩 5km 22分30秒', created_at: d(30) },
    { id: 'mem_004', content_raw: '和张三一起完成了Q1项目交付', created_at: d(45) },
    { id: 'mem_005', content_raw: '张三负责后端，我负责产品设计', created_at: d(60) },
    { id: 'mem_006', content_raw: '每天早上读书30分钟，目前在读《原则》', created_at: d(20) },
    { id: 'mem_007', content_raw: '今年计划读完12本书', created_at: d(90) },
    { id: 'mem_008', content_raw: '上个月读完了《穷查理宝典》', created_at: d(35) },
    { id: 'mem_009', content_raw: '最近几天因为项目压力睡眠质量很差', created_at: d(3) },
    { id: 'mem_010', content_raw: '感觉工作压力很大，不知道如何平衡', created_at: d(5) },
    { id: 'mem_011', content_raw: '对高压环境容易焦虑，需要通过运动减压', created_at: d(120) },
    { id: 'mem_012', content_raw: '三个月前想过做摄影相关的副业', created_at: d(85) },
    { id: 'mem_013', content_raw: '父母在北京，妹妹在上海工作', created_at: d(200) },
    { id: 'mem_014', content_raw: '家里养了一只猫叫豆豆', created_at: d(180) },
    { id: 'mem_015', content_raw: '上个月完成了产品方案评审目标', created_at: d(32) },
    { id: 'mem_016', content_raw: '上月坚持健身30天打卡完成', created_at: d(28) },
    { id: 'mem_017', content_raw: '开始学Python，完成了前三章练习', created_at: d(14) },
    { id: 'mem_018', content_raw: 'Python爬虫项目已经跑通，下一步做数据可视化', created_at: d(7) },
    { id: 'mem_019', content_raw: '编程学习遇到困难会先看文档再问ChatGPT', created_at: d(10) },
  ];
})();
