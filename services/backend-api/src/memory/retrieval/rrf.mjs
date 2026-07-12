/**
 * Reciprocal Rank Fusion (P3-B)
 *
 * 将多个检索器的有序结果列表合并成统一排名：
 *   RRF(d) = Σ  1 / (k + rank_i(d))
 * 其中 k=60（标准值，抑制高排名的极端放大）。
 *
 * 各检索器权重可调：
 *   vector: 1.0  — 语义核心
 *   bm25:   0.8  — 关键词精确
 *   time:   1.2  — 时间相关查询优先
 *   graph:  0.6  — 图遍历弱信号
 */

const K = 60; // RRF 标准常数

/**
 * @typedef {{ id: string, [key: string]: any }} Candidate
 */

/**
 * @param {Array<{ results: Candidate[], weight?: number, source?: string }>} lists
 * @param {object} [opts]
 * @param {number} [opts.topK]   — 最终返回条数
 * @returns {Candidate[]}        — 按 rrf_score 降序
 */
export function reciprocalRankFusion(lists, opts = {}) {
  const { topK } = opts;

  // score map: id → { score, candidate, sources[] }
  const scoreMap = new Map();

  for (const { results, weight = 1.0, source = 'unknown' } of lists) {
    if (!results?.length) continue;
    results.forEach((candidate, rankIdx) => {
      const id    = candidate.id;
      if (!id) return;
      const rrfContrib = weight * (1 / (K + rankIdx + 1));
      if (!scoreMap.has(id)) {
        scoreMap.set(id, { score: 0, candidate, sources: [] });
      }
      const entry = scoreMap.get(id);
      entry.score += rrfContrib;
      entry.sources.push({ source, rank: rankIdx + 1, contrib: rrfContrib });
    });
  }

  const merged = Array.from(scoreMap.values())
    .map(({ score, candidate, sources }) => ({
      ...candidate,
      rrf_score: Math.round(score * 100000) / 100000,
      _rrf_sources: sources,
    }))
    .sort((a, b) => b.rrf_score - a.rrf_score);

  return topK ? merged.slice(0, topK) : merged;
}

/**
 * Convenience: given raw candidates with _source, split into per-source lists
 * and run RRF in one call.
 *
 * @param {Candidate[]} bm25Results
 * @param {Candidate[]} vectorResults
 * @param {Candidate[]} timeResults
 * @param {Candidate[]} graphResults
 * @param {object}      [opts]
 * @returns {Candidate[]}
 */
export function mergeRetrievalResults(
  bm25Results,
  vectorResults,
  timeResults,
  graphResults,
  opts = {}
) {
  return reciprocalRankFusion([
    { results: vectorResults, weight: 1.0,  source: 'vector' },
    { results: bm25Results,   weight: 0.8,  source: 'bm25'   },
    { results: timeResults,   weight: 1.2,  source: 'time'   },
    { results: graphResults,  weight: 0.6,  source: 'graph'  },
  ], opts);
}
