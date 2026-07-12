/**
 * PersonaCard (P3-C)
 *
 * Builds the dynamic system-prompt block injected into every LLM call.
 * Three modes (§5.4 of design doc):
 *
 *   AS    — AI acts *as* the user's digital twin (write emails/docs in their voice)
 *   FOR   — AI acts *for* the user (personal assistant, default mode)
 *   ABOUT — AI provides objective info *about* the user to a third party
 *
 * Data sourced from L1 (identity_profile) + L2 (semantic_profile) + L5 (procedural_rules)
 * plus the top-K retrieved L4 memories passed in externally.
 *
 * Legal constraint (§5.5): AS mode output MUST include the footer:
 *   "Drafted by GEDO, reviewed by {display_name}"
 *
 * Privacy constraint: ABOUT mode uses ONLY L1 + public-scoped fields.
 *   L4 episode details are NEVER exposed in ABOUT mode.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TEMPLATES = {
  AS:    _loadTemplate('as.md'),
  FOR:   _loadTemplate('for.md'),
  ABOUT: _loadTemplate('about.md'),
};

function _loadTemplate(filename) {
  try {
    return readFileSync(path.join(__dirname, 'templates', filename), 'utf8');
  } catch {
    return ''; // graceful: template file optional
  }
}

/**
 * Interpolate {{KEY}} placeholders in template string.
 */
function interpolate(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}

// ── Public API ────────────────────────────────────────────────────────────────

export const PERSONA_MODES = /** @type {const} */ (['AS', 'FOR', 'ABOUT']);

/**
 * Build a persona context block for the system prompt.
 *
 * @param {object}   opts
 * @param {'AS'|'FOR'|'ABOUT'} [opts.mode='FOR']
 * @param {object}   [opts.l1={}]        — identity_profile row
 * @param {object[]} [opts.l2=[]]        — semantic_profile rows
 * @param {object[]} [opts.l5=[]]        — procedural_rules rows
 * @param {object[]} [opts.memories=[]]  — retrieved L4 memories (already compressed/formatted)
 * @param {string}   [opts.compressedMemories=''] — pre-compressed string from compress.mjs
 * @returns {string}  — system prompt section (markdown)
 */
export function buildPersonaBlock(opts = {}) {
  const {
    mode              = 'FOR',
    l1                = {},
    l2                = [],
    l5                = [],
    compressedMemories = '',
  } = opts;

  const safeMode = PERSONA_MODES.includes(mode) ? mode : 'FOR';

  // ── Identity summary from L1 ──────────────────────────────────────────────
  const displayName  = l1.display_name  || l1.preferred_name || '用户';
  const occupation   = l1.occupation    || '';
  const location     = l1.timezone      || '';
  const language     = l1.language_pref || 'zh-CN';
  const values       = Array.isArray(l1.core_values)  ? l1.core_values.join('、') : '';
  const traits       = Array.isArray(l1.personality)  ? l1.personality.join('、') : '';
  const goals_short  = Array.isArray(l1.long_term_goals) ? l1.long_term_goals.join('、') : '';

  // ── Semantic profile from L2 ──────────────────────────────────────────────
  const semanticLines = l2
    .filter(row => row.data && Object.keys(row.data).length > 0)
    .map(row => {
      const dim = row.dimension || row.profile_dimension || '';
      const summary = row.data?.summary || JSON.stringify(row.data).slice(0, 120);
      return `- **${dim}**: ${summary}`;
    })
    .join('\n');

  // ── Procedural rules from L5 ──────────────────────────────────────────────
  const learnedRules = l5
    .filter(r => r.active !== false)
    .map(r => `- ${r.rule_text || r.description || JSON.stringify(r).slice(0, 80)}`)
    .join('\n');

  // ── ABOUT mode: strip L4 memories, only use public L1 fields ─────────────
  const memoriesSection = safeMode === 'ABOUT'
    ? '' // No episode details in ABOUT mode
    : compressedMemories
      ? `\n## 相关记忆\n${compressedMemories}`
      : '';

  // ── AS mode footer reminder ───────────────────────────────────────────────
  const asFooterReminder = safeMode === 'AS'
    ? `\n> ⚠️ AS模式要求：所有代写内容末尾必须附加 "Drafted by GEDO, reviewed by ${displayName}"`
    : '';

  // ── Fill template ─────────────────────────────────────────────────────────
  const template = TEMPLATES[safeMode] || TEMPLATES.FOR;
  const vars = {
    MODE:            safeMode,
    DISPLAY_NAME:    displayName,
    OCCUPATION:      occupation,
    LOCATION:        location,
    LANGUAGE:        language,
    CORE_VALUES:     values,
    PERSONALITY:     traits,
    LONG_TERM_GOALS: goals_short,
    SEMANTIC:        semanticLines || '（暂无）',
    LEARNED_RULES:   learnedRules  || '（暂无）',
    MEMORIES:        memoriesSection,
    AS_FOOTER:       asFooterReminder,
  };

  if (template) {
    return interpolate(template, vars);
  }

  // ── Fallback inline template if file not found ────────────────────────────
  return _fallbackBlock(safeMode, vars);
}

function _fallbackBlock(mode, v) {
  // 模板文件缺失时的兜底也必须带红线，防止打包/路径回归静默丢失拒绝条款
  const redline = '\n红线（不可协商）：一律拒绝代写冒充他人/机构身份、索取验证码或密码、承诺投资"稳赚不赔"、或顶替本人完成需本人在场确认的内容；拒绝时立场清楚并给建设性替代。';
  const modeHeader = {
    AS:    `# 你是 ${v.DISPLAY_NAME} 的数字分身（AS 模式）\n你将代表 ${v.DISPLAY_NAME} 起草文稿，语言风格与其一致。${redline}${v.AS_FOOTER}`,
    FOR:   `# 你是 ${v.DISPLAY_NAME} 的 AI 助手（FOR 模式）\n你了解 ${v.DISPLAY_NAME} 的个性与目标，以贴心专业的方式提供支持。${redline}`,
    ABOUT: `# 你是一个了解 ${v.DISPLAY_NAME} 的 AI（ABOUT 模式）\n仅使用公开档案信息回答，不透露任何私密事件或 L4 记忆。不代 ${v.DISPLAY_NAME} 起草消息或表态；涉及冒充身份、索取验证码/密码、投资回报承诺、或需本人确认的请求一律拒绝。`,
  }[mode] || '';

  const sections = [modeHeader];

  if (v.OCCUPATION || v.CORE_VALUES || v.PERSONALITY) {
    sections.push(`## 用户档案\n- 职业：${v.OCCUPATION || '未知'}\n- 核心价值观：${v.CORE_VALUES || '未知'}\n- 性格特征：${v.PERSONALITY || '未知'}`);
  }
  if (v.SEMANTIC && mode !== 'ABOUT') {
    sections.push(`## 语义画像\n${v.SEMANTIC}`);
  }
  if (v.LEARNED_RULES && mode !== 'ABOUT') {
    sections.push(`## 学习到的规则\n${v.LEARNED_RULES}`);
  }
  if (v.MEMORIES && mode !== 'ABOUT') {
    sections.push(v.MEMORIES);
  }

  return sections.filter(Boolean).join('\n\n');
}
