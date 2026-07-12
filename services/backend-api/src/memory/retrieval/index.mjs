/**
 * Hybrid Retrieval Orchestrator (P3-B)
 *
 * 4-way parallel retrieval → RRF merge → Rerank → optional Compress
 *
 * Pipeline:
 *   1. extractTimeWindow(query)
 *   2. parallel: bm25Search + vectorSearch + timeSearch
 *   3. graphSearch(seed = top-5 from step 2)
 *   4. mergeRetrievalResults (RRF, weights: vector:1.0, bm25:0.8, time:1.2, graph:0.6)
 *   5. rerank(topK * 2 candidates → topK)
 *   6. compress (optional, controlled by opts.compress)
 *   7. side-effect: UPDATE memories SET last_recalled_at = NOW() for returned IDs
 *
 * Entry point: run(db, llm, userId, query, opts)
 */

import { bm25Search }            from './bm25.mjs';
import { vectorSearch }          from './vector.mjs';
import { graphSearch }           from './graph.mjs';
import { extractTimeWindow, timeSearch } from './time.mjs';
import { mergeRetrievalResults } from './rrf.mjs';
import { rerank }                from './rerank.mjs';
import { compress }              from './compress.mjs';

/**
 * @param {object} db
 * @param {object} llm           — must expose llm.embed(text) and optionally llm.chat(msgs)
 * @param {string} userId
 * @param {string} query
 * @param {object} [opts]
 * @param {number}  [opts.topK=10]           — final result count
 * @param {number}  [opts.rrfCandidates=40]  — candidates fed to reranker
 * @param {boolean} [opts.compress=false]    — compress output for LLM injection
 * @param {boolean} [opts.useLLMCompress=false] — use LLM for compression (slower)
 * @param {string}  [opts.type]              — memory type filter (forwarded to BM25/vector)
 * @param {string[]}[opts.tags]              — tag filter
 * @param {string}  [opts.intentType='default'] — for TSS rerank fallback
 * @returns {Promise<object[] | string>}     — array of memory objects, or string if compress=true
 */
export async function run(db, llm, userId, query, opts = {}) {
  const {
    topK            = 10,
    rrfCandidates   = 40,
    compress: doCompress = false,
    useLLMCompress  = false,
    type,
    tags,
    intentType      = 'default',
  } = opts;

  // ── Step 1: Time window extraction ───────────────────────────────────────
  const timeWindow = extractTimeWindow(query);

  // ── Step 2: Parallel retrieval ───────────────────────────────────────────
  const retrievalLimit = rrfCandidates;

  const [bm25Results, vectorResults, timeResults] = await Promise.all([
    bm25Search(db, userId, query, { topK: retrievalLimit, type, tags, timeWindow })
      .catch(err => { console.warn('[hybrid] bm25 failed:', err.message?.slice(0, 60)); return []; }),

    vectorSearch(db, llm, userId, query, { topK: retrievalLimit, type, tags, timeWindow })
      .catch(err => { console.warn('[hybrid] vector failed:', err.message?.slice(0, 60)); return []; }),

    timeWindow
      ? timeSearch(db, userId, timeWindow, { topK: retrievalLimit })
          .catch(err => { console.warn('[hybrid] time failed:', err.message?.slice(0, 60)); return []; })
      : Promise.resolve([]),
  ]);

  // ── Step 3: Graph search using top-5 seed IDs ────────────────────────────
  const seedCandidates = [...bm25Results, ...vectorResults]
    .sort((a, b) => (b.vector_score ?? 0) - (a.vector_score ?? 0))
    .slice(0, 5);
  const seedIds = [...new Set(seedCandidates.map(c => c.id).filter(Boolean))];

  const alreadyFoundIds = new Set([
    ...bm25Results.map(r => r.id),
    ...vectorResults.map(r => r.id),
    ...timeResults.map(r => r.id),
  ]);

  const graphResults = seedIds.length
    ? await graphSearch(db, userId, seedIds, {
        hops: 2,
        topK: Math.floor(rrfCandidates / 2),
        excludeIds: [...alreadyFoundIds],
      }).catch(err => { console.warn('[hybrid] graph failed:', err.message?.slice(0, 60)); return []; })
    : [];

  // ── Step 4: RRF merge ─────────────────────────────────────────────────────
  const merged = mergeRetrievalResults(
    bm25Results,
    vectorResults,
    timeResults,
    graphResults,
    { topK: rrfCandidates },
  );

  if (!merged.length) return doCompress ? '' : [];

  // Collect vector similarities for TSS rerank fallback
  const similarities = merged.map(m => m.vector_score ?? 0);

  // ── Step 5: Rerank ────────────────────────────────────────────────────────
  const reranked = await rerank(query, merged, {
    topK,
    llm,
    similarities,
    intentType,
  });

  // ── Step 6: Update last_recalled_at (fire-and-forget) ────────────────────
  _updateLastRecalledAt(db, reranked.map(r => r.id)).catch(() => {});

  // ── Step 7: Optional compression ─────────────────────────────────────────
  if (doCompress) {
    return compress(reranked, query, llm, { useLLM: useLLMCompress });
  }

  return reranked;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function _updateLastRecalledAt(db, ids) {
  if (!ids?.length) return;
  try {
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
    await db.query(
      `UPDATE memories SET last_recalled_at = NOW() WHERE id IN (${placeholders})`,
      ids,
    );
  } catch {
    // Non-critical; column may not exist yet
  }
}
