/**
 * BM25 Retriever (P3-B)
 *
 * 利用 P3-A L4 迁移中建立的 `memories.fts` (tsvector GENERATED) 列，
 * 通过 Postgres `ts_rank_cd` 实现关键词 BM25 近似排序。
 *
 * 特点：
 *   - 无需 LLM embed，纯 DB 查询，最快（通常 < 50ms）
 *   - 对精确词汇/人名/专有名词效果优于向量检索
 *   - 返回 { id, content_raw, bm25_score, ... }
 */

/**
 * @param {object} db    — db adapter with queryAll(sql, params)
 * @param {string} userId
 * @param {string} query
 * @param {object} [opts]
 * @param {number} [opts.topK=30]           — 候选数量（供 RRF 用）
 * @param {string} [opts.timeClause='']     — 额外时间过滤 SQL 片段（由 time.mjs 传入）
 * @param {any[]}  [opts.extraParams=[]]    — 对应 timeClause 的参数
 * @param {boolean} [opts.fallbackToLike]   — fts 列不存在时降级 ILIKE
 * @returns {Promise<Array<{id, content_raw, bm25_score}>>}
 */
export async function bm25Search(db, userId, query, opts = {}) {
  const { topK = 30, timeClause = '', extraParams = [], fallbackToLike = true } = opts;
  if (!query?.trim()) return [];

  // Postgres plainto_tsquery：将自然语言转为 tsquery（不抛错）
  const tsQuery = query.trim().replace(/'/g, "''");

  const baseParams = [userId, topK, ...extraParams];
  const pOffset = baseParams.length + 1; // next $N

  try {
    // 尝试使用 fts 列（P3-A 已建）
    const sql = `
      SELECT
        m.id, m.user_id, m.type, m.content_raw, m.content_struct,
        m.system_tags, m.user_tags, m.decay_class, m.importance,
        m.created_at, m.updated_at, m.impact_score, m.usage_count,
        m.reminder_date, m.layer_source, m.superseded_by,
        ts_rank_cd(m.fts, plainto_tsquery('simple', $${pOffset})) AS bm25_score
      FROM memories m
      WHERE m.user_id = $1
        AND m.superseded_by IS NULL
        AND m.fts @@ plainto_tsquery('simple', $${pOffset})
        ${timeClause}
      ORDER BY bm25_score DESC
      LIMIT $2
    `;
    const rows = await db.queryAll(sql, [...baseParams, tsQuery]);
    return rows.map(r => ({ ...r, _source: 'bm25' }));
  } catch (ftsErr) {
    if (!fallbackToLike) throw ftsErr;
    // Fallback: fts 列不存在（migration 未跑）→ ILIKE
    console.warn('[bm25] fts column not found, falling back to ILIKE:', ftsErr.message?.slice(0, 60));
    const sql2 = `
      SELECT m.*, 0.5 AS bm25_score
      FROM memories m
      WHERE m.user_id = $1
        AND m.superseded_by IS NULL
        AND m.content_raw ILIKE $${pOffset}
        ${timeClause}
      LIMIT $2
    `;
    const rows2 = await db.queryAll(sql2, [...baseParams, `%${tsQuery}%`]);
    return rows2.map(r => ({ ...r, _source: 'bm25_fallback' }));
  }
}
