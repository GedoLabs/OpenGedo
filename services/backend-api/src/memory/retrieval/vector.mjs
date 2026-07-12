/**
 * Vector Retriever (P3-B)
 *
 * 抽离 memory.service.mjs 中原有的 pgvector 调用，
 * 成为独立可组合的模块供 retrieval/index.mjs 并行调度。
 *
 * 返回按余弦相似度排序的候选集，附 vector_score 字段。
 */

/**
 * @param {object} db
 * @param {object} llm          — { embed(text): Promise<number[]> }
 * @param {string} userId
 * @param {string} query
 * @param {object} [opts]
 * @param {number} [opts.topK=30]
 * @param {string} [opts.timeClause='']
 * @param {any[]}  [opts.extraParams=[]]
 * @param {string} [opts.decayFilter]   — e.g. 'permanent,slow' → filter by decay_class
 * @returns {Promise<Array>}
 */
export async function vectorSearch(db, llm, userId, query, opts = {}) {
  const { topK = 30, timeClause = '', extraParams = [], decayFilter } = opts;

  // Generate query embedding (may throw or return null if LLM unavailable)
  let embedding = null;
  try {
    embedding = await llm.embed(query);
  } catch {
    return []; // vector retrieval unavailable → RRF will rely on other sources
  }
  if (!embedding) return [];

  const embJson = JSON.stringify(embedding);
  const baseParams = [userId, topK, embJson, ...extraParams];
  const pOffset   = baseParams.length + 1;

  const decayClause = decayFilter
    ? `AND m.decay_class = ANY('{${decayFilter.split(',').map(s => s.trim()).join(',')}}'::text[])`
    : '';

  const sql = `
    SELECT
      m.id, m.user_id, m.type, m.content_raw, m.content_struct,
      m.system_tags, m.user_tags, m.decay_class, m.importance,
      m.created_at, m.updated_at, m.impact_score, m.usage_count,
      m.reminder_date, m.layer_source, m.superseded_by,
      (1 - (m.embedding <=> $3::vector)) AS vector_score
    FROM memories m
    WHERE m.user_id = $1
      AND m.embedding IS NOT NULL
      AND m.superseded_by IS NULL
      ${decayClause}
      ${timeClause}
    ORDER BY vector_score DESC
    LIMIT $2
  `;

  try {
    const rows = await db.queryAll(sql, baseParams);
    return rows.map(r => ({ ...r, _source: 'vector' }));
  } catch (err) {
    console.warn('[vector] pgvector query failed:', err.message?.slice(0, 80));
    return [];
  }
}
