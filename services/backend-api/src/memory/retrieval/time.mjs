/**
 * Time Window Retriever (P3-B)
 *
 * 从查询文本中提取时间词，生成 `created_at` 窗口预过滤条件，
 * 供 bm25.mjs / vector.mjs 使用（减少候选集 + 提升时序相关性）。
 *
 * 复用 intent-classifier.mjs 的关键词模式，扩展具体时间词解析。
 */

// 时间词 → 相对天数偏移（负数=过去，正数=未来）
const TIME_PATTERNS = [
  // 精确相对
  { re: /今天|today/i,              days: [0, 0] },
  { re: /昨天|yesterday/i,          days: [-1, 0] },
  { re: /前天/i,                    days: [-2, -1] },
  { re: /明天|tomorrow/i,           days: [0, 1] },
  { re: /上周|上个星期|last\s*week/i, days: [-14, -7] },
  { re: /本周|这周|this\s*week/i,    days: [-7, 0] },
  { re: /下周|next\s*week/i,        days: [0, 7] },
  { re: /上个月|last\s*month/i,     days: [-60, -30] },
  { re: /本月|这个月|this\s*month/i, days: [-30, 0] },
  { re: /最近|近期|recently/i,       days: [-7, 0] },
  { re: /这段时间|这阵子/i,           days: [-14, 0] },
  { re: /过去[一1]周/i,              days: [-7, 0] },
  { re: /过去[一1]个月/i,            days: [-30, 0] },
  { re: /过去[三3]个月/i,            days: [-90, 0] },
  { re: /过去[半]年/i,               days: [-180, 0] },
  { re: /去年|last\s*year/i,        days: [-365, -180] },
  { re: /今年|this\s*year/i,        days: [-365, 0] },
  // 模糊/宽泛
  { re: /很久前|很早以前|long\s*ago/i, days: [-730, -90] },
  { re: /以前|之前|before/i,          days: [-180, 0] },
  { re: /以后|之后|after/i,           days: [0, 30] },
];

// 中文数字 → 阿拉伯数字（覆盖常见 0–99）
const CN_DIGITS = { 零: 0, 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

/** 解析中文/阿拉伯数字（支持 "三"、"十"、"二十三"、"3"）。返回 NaN 表示无法解析。 */
function parseCnNumber(s) {
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  if (!s) return NaN;
  // 处理含"十"的两位数：十=10, 二十=20, 二十三=23, 十三=13
  if (s.includes('十')) {
    const [tens, ones] = s.split('十');
    const t = tens === '' ? 1 : CN_DIGITS[tens];
    const o = ones === '' || ones === undefined ? 0 : CN_DIGITS[ones];
    if (t === undefined || o === undefined) return NaN;
    return t * 10 + o;
  }
  return s in CN_DIGITS ? CN_DIGITS[s] : NaN;
}

// 时间单位 → 每单位天数
const TIME_UNITS = [
  { re: '年',                  days: 365 },
  { re: '个月|月',             days: 30 },
  { re: '周|星期|礼拜',        days: 7 },
  { re: '天|日',               days: 1 },
];

/**
 * 解析 "N单位前 / 过去N单位 / 近N单位" 这类相对时间词。
 * 例：三个月前 → [-90, 0]，两年前 → [-730, 0]，三周前 → [-21, 0]。
 * @returns {{ days: [number, number], matched: string } | null}
 */
function parseRelativeAgo(query) {
  for (const { re: unitRe, days: unitDays } of TIME_UNITS) {
    // 数字（中文/阿拉伯）+ 单位 + （前/以前/之前）  或  过去/近 + 数字 + 单位
    const re = new RegExp(`(?:过去|近|前)?\\s*([零一两二三四五六七八九十\\d]+)\\s*(?:${unitRe})\\s*(?:前|以前|之前)?`);
    const m = query.match(re);
    if (!m) continue;
    const n = parseCnNumber(m[1]);
    if (!Number.isFinite(n) || n <= 0) continue;
    return { days: [-(n * unitDays), 0], matched: m[0] };
  }
  return null;
}

/**
 * 从查询中提取时间窗口。
 * @param {string} query
 * @param {Date}   [now]
 * @returns {{ startDate?: Date, endDate?: Date, matched?: string } | null}
 */
export function extractTimeWindow(query, now = new Date()) {
  if (!query) return null;
  for (const { re, days } of TIME_PATTERNS) {
    if (re.test(query)) {
      const msPerDay = 86400000;
      const startDate = days[0] !== null
        ? new Date(now.getTime() + days[0] * msPerDay)
        : null;
      const endDate = days[1] !== null
        ? new Date(now.getTime() + days[1] * msPerDay + msPerDay - 1) // end of day
        : null;
      return {
        startDate,
        endDate,
        matched: re.source,
        offsetDays: days,
      };
    }
  }

  // 动态解析 "N单位前 / 过去N单位"（如 三个月前、两年前、三周前）
  const rel = parseRelativeAgo(query);
  if (rel) {
    const msPerDay = 86400000;
    return {
      startDate: new Date(now.getTime() + rel.days[0] * msPerDay),
      endDate: new Date(now.getTime() + rel.days[1] * msPerDay + msPerDay - 1),
      matched: rel.matched,
      offsetDays: rel.days,
    };
  }

  return null;
}

/**
 * 将时间窗口转换为 SQL WHERE 片段 + 参数。
 * 参数起始偏移从 startIdx 开始（避免与上游参数冲突）。
 *
 * @param {{ startDate?: Date, endDate?: Date } | null} window
 * @param {number} startIdx   — $N 起始编号
 * @returns {{ clause: string, params: any[] }}
 */
export function buildTimeClause(window, startIdx = 4) {
  if (!window) return { clause: '', params: [] };

  const parts  = [];
  const params = [];
  let   idx    = startIdx;

  if (window.startDate) {
    parts.push(`m.created_at >= $${idx}`);
    params.push(window.startDate.toISOString());
    idx++;
  }
  if (window.endDate) {
    parts.push(`m.created_at <= $${idx}`);
    params.push(window.endDate.toISOString());
    idx++;
  }

  return {
    clause: parts.length ? `AND ${parts.join(' AND ')}` : '',
    params,
  };
}

/**
 * 专为时间相关查询做精确检索（不依赖向量）。
 * 当查询明确指定时间范围时，按时间排序优先。
 *
 * @param {object} db
 * @param {string} userId
 * @param {object} window   — from extractTimeWindow
 * @param {object} [opts]
 * @param {number} [opts.topK=30]
 * @returns {Promise<Array>}
 */
export async function timeSearch(db, userId, window, opts = {}) {
  const { topK = 30 } = opts;
  if (!window?.startDate && !window?.endDate) return [];

  const { clause, params } = buildTimeClause(window, 2);
  if (!clause) return [];

  const sql = `
    SELECT
      m.id, m.user_id, m.type, m.content_raw, m.content_struct,
      m.system_tags, m.user_tags, m.decay_class, m.importance,
      m.created_at, m.updated_at, m.impact_score, m.usage_count,
      m.reminder_date, m.layer_source, m.superseded_by,
      1.0 AS time_score
    FROM memories m
    WHERE m.user_id = $1
      AND m.superseded_by IS NULL
      ${clause}
    ORDER BY m.created_at DESC, m.importance DESC
    LIMIT $${params.length + 2}
  `;

  try {
    const rows = await db.queryAll(sql, [userId, ...params, topK]);
    return rows.map(r => ({ ...r, _source: 'time' }));
  } catch (err) {
    console.warn('[time] query failed:', err.message?.slice(0, 80));
    return [];
  }
}
