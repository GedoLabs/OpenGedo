/**
 * Reranker (P3-B)
 *
 * 对 RRF 合并后的候选集做 cross-encoder 精排。
 *
 * 优先级（按可用性自动降级）：
 *   1. Cohere Rerank API  (COHERE_API_KEY 存在时)
 *   2. LLM Rerank         (通过 chat 打分，≤20条时可用)
 *   3. TSS Tie-breaker    (tss.mjs 纯本地计算，无 API 依赖)
 *
 * BGE-Reranker-v2 本地推理：Phase 4 引入，当前占位注释。
 */

import { rankByTSS } from '../tss.mjs';

// ── Cohere Rerank ────────────────────────────────────────────────────────────

async function cohereRerank(query, candidates, topK) {
  const { default: fetch } = await import('node-fetch').catch(() => ({ default: globalThis.fetch }));
  const apiKey = process.env.COHERE_API_KEY;
  if (!apiKey) throw new Error('COHERE_API_KEY not set');

  const res = await fetch('https://api.cohere.ai/v1/rerank', {
    method:  'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      model:     process.env.COHERE_RERANK_MODEL || 'rerank-multilingual-v3.0',
      query,
      documents: candidates.map(c => c.content_raw || ''),
      top_n:     topK,
    }),
  });

  if (!res.ok) throw new Error(`Cohere rerank ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.results || []).map(r => ({
    ...candidates[r.index],
    rerank_score: r.relevance_score,
    _reranker:    'cohere',
  }));
}

// ── LLM Rerank (fallback for small sets) ────────────────────────────────────

async function llmRerank(query, candidates, topK, llm) {
  if (!llm?.chat || candidates.length > 20) {
    throw new Error('LLM rerank: unavailable or too many candidates');
  }

  const snippets = candidates.map((c, i) =>
    `[${i}] ${(c.content_raw || '').slice(0, 150)}`
  ).join('\n');

  const resp = await llm.chat([
    {
      role: 'system',
      content: '你是信息检索评估助手。只输出一个纯 JSON 数组，不要 markdown，不要解释。',
    },
    {
      role: 'user',
      content: `查询：「${query}」\n\n请对以下 ${candidates.length} 条记忆片段按与查询的相关度从高到低排序，` +
        `返回索引数组，最多 ${topK} 个：\n${snippets}\n\n输出格式示例：[2,0,5,1]`,
    },
  ]);

  const text = typeof resp === 'string' ? resp : (resp.content || '');
  const indices = JSON.parse(text.replace(/```json?\n?/g, '').replace(/```/g, '').trim());

  return indices.slice(0, topK).map((idx, rank) => ({
    ...candidates[idx],
    rerank_score: 1 - rank / topK,
    _reranker:    'llm',
  }));
}

// ── TSS tie-breaker (pure local, no API) ────────────────────────────────────

function tssRerank(candidates, topK, { similarities = [], intentType = 'default' } = {}) {
  return rankByTSS(candidates, { similarities, intentType, limit: topK }).map(c => ({
    ...c,
    rerank_score: c.tss,
    _reranker:    'tss',
  }));
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Rerank candidates using the best available method.
 *
 * @param {string}   query
 * @param {object[]} candidates  — RRF output
 * @param {object}   [opts]
 * @param {number}   [opts.topK=10]
 * @param {object}   [opts.llm]
 * @param {number[]} [opts.similarities]
 * @param {string}   [opts.intentType]
 * @returns {Promise<object[]>}
 */
export async function rerank(query, candidates, opts = {}) {
  const { topK = 10, llm, similarities = [], intentType = 'default' } = opts;
  if (!candidates?.length) return [];

  // 1. Cohere
  if (process.env.COHERE_API_KEY) {
    try {
      return await cohereRerank(query, candidates, topK);
    } catch (err) {
      console.warn('[rerank] Cohere failed, falling back:', err.message?.slice(0, 60));
    }
  }

  // 2. LLM rerank (small sets only)
  if (llm && candidates.length <= 20) {
    try {
      return await llmRerank(query, candidates, topK, llm);
    } catch (err) {
      console.warn('[rerank] LLM rerank failed, falling back to TSS:', err.message?.slice(0, 60));
    }
  }

  // 3. TSS tie-breaker (always works)
  return tssRerank(candidates, topK, { similarities, intentType });
}
