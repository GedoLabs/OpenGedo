/**
 * Dimension Classifier — rule-based life-wheel tagging for memory fragments.
 *
 * The LLM extractor is the primary classifier (extract.service emits
 * `dimensions[]` per memory); this keyword fallback covers the proxy-down
 * path, the backfill script and consolidation's skill→dimension mapping.
 * Keyword map lifted from consolidation.service's old inferDimension.
 */

import { LIFE_DIMENSIONS } from './types.mjs';

export const DIMENSION_KEYWORDS = {
  health: ['健康', '运动', '锻炼', '睡眠', '饮食', '健身', '跑步'],
  career: ['工作', '项目', '团队', '职业', '升职', '技能', '编程', '产品'],
  family: ['家人', '家庭', '孩子', '父母', '配偶', '伴侣'],
  finance: ['理财', '投资', '收入', '支出', '储蓄', '财务'],
  growth: ['学习', '成长', '读书', '课程', '提升', '思考'],
  social: ['朋友', '社交', '聚会', '同事', '人际'],
  hobby: ['爱好', '旅行', '音乐', '电影', '游戏', '摄影'],
  self_realization: ['梦想', '使命', '意义', '价值', '自我'],
};

/**
 * Multi-label classification: returns 0–2 dimensions ranked by keyword hit
 * count. Empty array is a valid answer (fragment touches no dimension) —
 * callers must NOT re-introduce a 'growth' fallback here; that fallback is
 * exactly the bug that made every fragment count as 成长 in the old tree.
 *
 * @param {string} text
 * @param {string[]} [tags]
 * @returns {string[]} subset of LIFE_DIMENSIONS
 */
export function classifyDimensions(text, tags = []) {
  const combined = `${Array.isArray(tags) ? tags.join(' ') : ''} ${String(text || '')}`.toLowerCase();
  if (!combined.trim()) return [];
  const scored = [];
  for (const dim of LIFE_DIMENSIONS) {
    const keywords = DIMENSION_KEYWORDS[dim] || [];
    let hits = 0;
    for (const kw of keywords) if (combined.includes(kw)) hits += 1;
    if (hits > 0) scored.push([dim, hits]);
  }
  scored.sort((a, b) => b[1] - a[1]);
  return scored.slice(0, 2).map(([d]) => d);
}

export default { DIMENSION_KEYWORDS, classifyDimensions };
