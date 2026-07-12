/**
 * Graph Retriever (P3-B)
 *
 * 2-3 hop 图遍历：
 *   Hop 1 — 直接相关（memory_relations）
 *   Hop 2 — 间接相关（与 hop-1 结果再关联一次）
 *   Bonus — skill_memories 关联（现有表）
 *
 * 用于找到向量/BM25 检索遗漏的"弱连接"记忆（如证据链、因果链）。
 * 通常在 BM25 + vector 结果确定后，取 top-5 seed 做图扩展。
 */

/**
 * @param {object} db
 * @param {string} userId
 * @param {string[]} seedIds   — BM25/vector top-K 的 memory IDs（作为图遍历起点）
 * @param {object} [opts]
 * @param {number} [opts.hops=2]          — 最大跳数
 * @param {number} [opts.topK=20]         — 最多返回条数
 * @param {string[]} [opts.excludeIds=[]] — 排除已在其他结果中的 ID
 * @param {string[]} [opts.relationTypes] — 只走指定关系类型
 * @returns {Promise<Array>}
 */
export async function graphSearch(db, userId, seedIds, opts = {}) {
  const {
    hops         = 2,
    topK         = 20,
    excludeIds   = [],
    relationTypes = ['supports', 'elaborates', 'causes', 'related'],
  } = opts;

  if (!seedIds?.length) return [];

  const visited   = new Set([...seedIds, ...excludeIds]);
  const collected = [];

  let frontier = [...seedIds];

  for (let hop = 0; hop < hops && frontier.length > 0 && collected.length < topK; hop++) {
    if (!frontier.length) break;

    const relTypeList = relationTypes.map(t => `'${t}'`).join(',');
    const seedPlaceholders = frontier.map((_, i) => `$${i + 3}`).join(',');

    // Follow edges outward (source → target) and inward (target → source)
    const sql = `
      SELECT DISTINCT ON (m.id)
        m.id, m.user_id, m.type, m.content_raw, m.content_struct,
        m.system_tags, m.user_tags, m.decay_class, m.importance,
        m.created_at, m.updated_at, m.impact_score, m.usage_count,
        m.superseded_by,
        r.relation_type, r.weight AS graph_weight,
        $2::int AS hop_distance
      FROM memory_relations r
      JOIN memories m ON (
        (r.source_id = ANY($1::uuid[]) AND m.id = r.target_id)
        OR
        (r.target_id = ANY($1::uuid[]) AND m.id = r.source_id)
      )
      WHERE m.user_id = $3
        AND m.superseded_by IS NULL
        AND r.relation_type IN (${relTypeList})
      ORDER BY m.id, r.weight DESC
      LIMIT $4
    `;

    let neighbors = [];
    try {
      neighbors = await db.queryAll(sql, [
        `{${frontier.join(',')}}`,   // $1 uuid[]
        hop + 1,                      // $2 hop_distance
        userId,                       // $3
        topK * 2,                     // $4
      ]);
    } catch (err) {
      // memory_relations table may not exist yet (migration not run)
      if (hop === 0) {
        console.warn('[graph] memory_relations query failed (migration not run?):', err.message?.slice(0, 80));
      }
      break;
    }

    const newNeighbors = neighbors.filter(n => !visited.has(n.id));
    for (const n of newNeighbors) {
      visited.add(n.id);
      collected.push({ ...n, _source: `graph_hop${hop + 1}` });
    }
    frontier = newNeighbors.map(n => n.id);
  }

  // Bonus: skill_memories adjacency
  if (seedIds.length && collected.length < topK) {
    try {
      const skillSql = `
        SELECT DISTINCT m.*,
          0.4 AS graph_weight, 1 AS hop_distance
        FROM skill_memories sm
        JOIN memories m ON m.id = sm.memory_id
        WHERE sm.skill_id IN (
          SELECT skill_id FROM skill_memories WHERE memory_id = ANY($1::uuid[])
        )
          AND m.user_id = $2
          AND m.id != ALL($1::uuid[])
          AND m.superseded_by IS NULL
        LIMIT $3
      `;
      const skillRows = await db.queryAll(skillSql, [
        `{${seedIds.join(',')}}`, userId, topK - collected.length,
      ]);
      for (const r of skillRows) {
        if (!visited.has(r.id)) {
          visited.add(r.id);
          collected.push({ ...r, _source: 'graph_skill' });
        }
      }
    } catch { /* skill_memories may be empty */ }
  }

  return collected.slice(0, topK);
}
