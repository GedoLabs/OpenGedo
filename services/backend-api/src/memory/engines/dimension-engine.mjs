/**
 * Dimension Engine — 生命之花八维「AI+规则」评估（画像雷达的默认数据源）。
 *
 * 此前雷达实线是用户自评（dimensions[k].self_score，仅人生快照/就地评分写入），
 * 本引擎为每个生命维度计算 0-10 分 + 5 档等级 + 解读文本，自评退为对比系列。
 *
 * 双轨（identity-engine 同款哲学）：
 *   规则层 —— always-on 骨架，无 LLM 可测可跑：合成「参与度(activity) +
 *   进展(goals) + 沉淀(depth)」三分量，自评存在时作 40% 校准锚。
 *   诚实声明：规则层只能度量参与度/进展/沉淀，读不出语义好坏（生病也会
 *   高频聊健康）——语义判断是 LLM 精炼层的职责，规则分保证首屏有形状。
 *   LLM 层 —— useLLM 时对 scored 维微调分数（钳制在 rule_score±2 防漂移）
 *   并产出 100-160 字解读；单维失败回落规则分。
 *
 * 诚实原则（与雷达 floor=0 一脉相承）：
 *   证据不足（confidence < 门槛）的维度 status='insufficient'，不给分不给
 *   等级 —— 前端画到圆心并显示「了解不足」，不造假分。
 *
 * 防跳变：scored→scored 且 |Δ|>2 时向 prev 靠拢 ±2（identity applyDamping
 * 的数值版），changes[] 解释每次变化。
 *
 * 隐私：listEpisodes 默认排除 ai_excluded 碎片 → 信号/证据/LLM 采样天然
 * 不含用户对 AI 隐藏的记忆（与检索/实体总结链路口径一致）。
 *
 * 存储：dimension-assessment/latest.json 覆写（narrative 模式，不留历史；
 * 跨次变化由产物内 changes[] 承担）。刷新时机：首读规则生成（getXxx
 * generateIfMissing）+ weekly cron + 一键梳理（皆 useLLM），不做事件驱动。
 */

import { Store } from '../../lib/store.mjs';
import { getMemoryStore } from '../store/index.mjs';
import { getLLMRouter } from '../../llm/router.mjs';
import { outputLanguageDirective } from '../../lib/language.mjs';
import { LIFE_DIMENSIONS } from '../types.mjs';

const store = Store();
const memStore = getMemoryStore();

const minConfidence = () => Number(process.env.DIMENSION_MIN_CONFIDENCE || 0.25);
const DAMP_MAX_DELTA = 2;   // 单次评估分数最大位移
const LLM_MAX_DRIFT = 2;    // LLM 微调相对规则分的最大偏移
const EVIDENCE_LIMIT = 10;
const SAMPLE_LIMIT = 5;

// 5 档等级 key（三语展示标签在前端 i18n memory.dimLevels.*，后端只存 key）
const LEVEL_KEYS = ['needs_care', 'sprouting', 'growing', 'thriving', 'blooming'];

// zh 标签仅用于 LLM prompt 参照与 changes[] 文案（identity 同模式）；
// 输出语言由 outputLanguageDirective 控制，前端展示走 i18n。
const DIM_LABELS_ZH = {
  health: '健康', career: '事业', family: '家庭', finance: '财务',
  growth: '成长', social: '社交', hobby: '兴趣', self_realization: '自我',
};
const LEVEL_TABLE_ZH = [
  'needs_care 待浇灌 [0,2)：这一维长期少有投入或明显承压，值得优先照看',
  'sprouting 萌芽 [2,4)：刚开始有起色，投入还不稳定',
  'growing 生长 [4,6)：在持续投入，节奏平稳',
  'thriving 繁茂 [6,8)：投入与成果兼具，是生活的支点之一',
  'blooming 绽放 [8,10]：这一维是亮点，有余力滋养其他维度',
].join('\n');

const safe = (fn, dflt) => { try { const v = fn(); return v == null ? dflt : v; } catch { return dflt; } };
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;

// ══════════════════════════════════════════════════════════════════
//  纯函数（导出供测试与前端口径参照）
// ══════════════════════════════════════════════════════════════════

/** 分数 → 5 档等级（每 2 分一档，10 分封顶在 blooming）。 */
export function levelOf(score) {
  const level = Math.min(5, Math.floor(score / 2) + 1);
  return { level, level_key: LEVEL_KEYS[level - 1] };
}

/**
 * 证据充分度（0-1）：记忆量为主（12 条打满半壁），沉淀/目标/自评补足。
 * 低于门槛 → insufficient，不打分。
 */
export function computeConfidence(sig) {
  return round2(Math.min(1,
    0.5 * Math.min(sig.ep_total, 12) / 12
    + 0.2 * (sig.has_summary ? 1 : 0)
    + 0.1 * (sig.skills > 0 ? 1 : 0)
    + 0.1 * Math.min(sig.goals_active + sig.goals_completed_90d, 2) / 2
    + 0.1 * (sig.self_score != null ? 1 : 0),
  ));
}

// 活跃分档：沿用旧雷达活跃系列的绝对刻度哲学（不随用户数据漂移）
function band30(n) { if (n >= 6) return 10; if (n >= 3) return 6.6; if (n >= 1) return 3.3; return 0; }
function band90(n) { if (n >= 10) return 10; if (n >= 4) return 6.6; if (n >= 1) return 3.3; return 0; }

/** 规则分：activity 0.5 + goals 0.3 + depth 0.2（无目标时缺项重归一），自评锚 40%。 */
export function ruleScoreOf(sig) {
  const activity = 0.6 * band30(sig.ep_30d) + 0.4 * band90(sig.ep_90d);
  const hasGoals = sig.goals_active > 0 || sig.goals_completed_90d > 0;
  const goalComp = hasGoals
    ? Math.min(10, (sig.goals_avg_progress ?? 0) / 10 + 2 * sig.goals_completed_90d)
    : null;
  const depth = Math.min(10, (sig.has_summary ? 5 : 0) + Math.min(sig.skills, 3) + (sig.has_patterns ? 2 : 0));
  const raw = goalComp != null
    ? 0.5 * activity + 0.3 * goalComp + 0.2 * depth
    : (0.5 * activity + 0.2 * depth) / 0.7;
  const anchored = sig.self_score != null ? 0.6 * raw + 0.4 * sig.self_score : raw;
  return round1(clamp(anchored, 0, 10));
}

// ══════════════════════════════════════════════════════════════════
//  信号采集
// ══════════════════════════════════════════════════════════════════

function gatherSignals(userId) {
  // listEpisodes 默认 includeExcluded=false → ai_excluded 不进任何下游
  const episodes = safe(() => memStore.listEpisodes(userId, { limit: 1000 }), []) || [];
  const goals = safe(() => store.listGoals(userId), []) || [];
  const profile = safe(() => memStore.getProfile(userId), {}) || {};
  const dims = profile?.semantic_memory?.dimensions || {};

  const now = Date.now();
  const d30 = now - 30 * 24 * 60 * 60 * 1000;
  const d90 = now - 90 * 24 * 60 * 60 * 1000;

  const perDim = {};
  for (const k of LIFE_DIMENSIONS) {
    const eps = episodes.filter(e => Array.isArray(e.dimensions) && e.dimensions.includes(k));
    const activeGoals = goals.filter(g => g.life_wheel_dimension === k && (g.status === 'active' || g.status === 'in_progress'));
    const completed90 = goals.filter(g => g.life_wheel_dimension === k && g.status === 'completed'
      && new Date(g.updated_at || 0).getTime() >= d90);
    const d = dims[k] || {};
    const selfScore = typeof d.self_score === 'number' ? d.self_score : null;

    // 证据挑选：impact 降序 → 时间降序（impact 衡量重要性，不进分数）
    const ranked = [...eps].sort((a, b) =>
      (b.impact_score ?? 0) - (a.impact_score ?? 0)
      || String(b.created_at || '').localeCompare(String(a.created_at || '')));

    perDim[k] = {
      signals: {
        ep_total: eps.length,
        ep_30d: eps.filter(e => new Date(e.created_at || 0).getTime() >= d30).length,
        ep_90d: eps.filter(e => new Date(e.created_at || 0).getTime() >= d90).length,
        goals_active: activeGoals.length,
        goals_avg_progress: activeGoals.length
          ? Math.round(activeGoals.reduce((s, g) => s + (g.progress || 0), 0) / activeGoals.length)
          : null,
        goals_completed_90d: completed90.length,
        skills: Array.isArray(d.skills) ? d.skills.length : 0,
        has_summary: !!(d.summary && String(d.summary).trim()),
        has_patterns: Array.isArray(d.patterns) && d.patterns.length > 0,
        self_score: selfScore,
      },
      summary: String(d.summary || '').slice(0, 200),
      evidence_episode_ids: ranked.slice(0, EVIDENCE_LIMIT).map(e => e.id).filter(Boolean),
      samples: ranked.slice(0, SAMPLE_LIMIT).map(e => ({
        at: String(e.created_at || '').slice(0, 10),
        text: String(e.content_raw || '').slice(0, 120),
      })),
    };
  }
  return perDim;
}

// ══════════════════════════════════════════════════════════════════
//  LLM 精炼（scored 维 only；分数钳 rule±2；level 一律代码重算）
// ══════════════════════════════════════════════════════════════════

function buildAssessPrompt(lang) {
  return `你是用户的生活平衡评估助手。给你用户八个生活维度中已有足够证据的若干维度：每维含规则基础分（rule_score，由记忆活跃度、目标进展、沉淀深度合成）、信号统计、已有的维度小结和近期记忆采样。

请对每个维度：
1. 给出你的评估分 score（0-10，一位小数）。score 必须落在该维 rule_score±2 以内 —— 规则分是证据密度的锚，你负责在带内做语义校准（例如高频聊健康但内容是生病求医，应下调；低频但内容是重大突破，应上调）。
2. 写一段 insight（100-160 字，第二人称称「你」）：这一维当前的状态、依据（必须点出 1-2 个具体细节：某条记忆、某个目标进展）、以及一句温和的展望或建议。不编造采样之外的事实；证据单薄就写保守一点。

等级参照（写 insight 时语气应与分数所处档位一致，但不要输出等级本身）：
${LEVEL_TABLE_ZH}

只对输入里出现的维度输出。只输出 JSON：
{"dimensions":{"career":{"score":7.1,"insight":"…"},…}}
${outputLanguageDirective(lang)}`;
}

async function refineWithLLM({ scoredEntries, lang, router }) {
  const llm = router ?? getLLMRouter();
  if (!llm?.isAvailable?.()) return null;

  const payload = {};
  for (const [k, entry] of Object.entries(scoredEntries)) {
    payload[k] = {
      label: DIM_LABELS_ZH[k] || k,
      rule_score: entry.rule_score,
      confidence: entry.confidence,
      signals: entry.signals,
      summary: entry.summary || undefined,
      recent_samples: entry.samples,
    };
  }

  const res = await llm.runTask('memory.dimensions.assess', [
    { role: 'system', content: buildAssessPrompt(lang) },
    { role: 'user', content: JSON.stringify(payload) },
  ]);
  const out = res?.json?.dimensions;
  return out && typeof out === 'object' ? out : null;
}

// ══════════════════════════════════════════════════════════════════
//  Damping（identity applyDamping 的数值版）
// ══════════════════════════════════════════════════════════════════

function applyDamping(prevDims, nextDims) {
  const changes = [];
  for (const k of LIFE_DIMENSIONS) {
    const next = nextDims[k];
    const prev = prevDims?.[k];
    if (!next || next.status !== 'scored') continue;           // insufficient 如实采用
    if (!prev || prev.status !== 'scored') continue;           // 首评 / insufficient→scored 不阻尼
    next.prev_score = prev.score;
    const delta = next.score - prev.score;
    if (Math.abs(delta) > DAMP_MAX_DELTA) {
      const adopted = round1(prev.score + clamp(delta, -DAMP_MAX_DELTA, DAMP_MAX_DELTA));
      changes.push(`${DIM_LABELS_ZH[k] || k}：${prev.score}→${adopted}（本次评 ${next.score}，已阻尼）`);
      next.score = adopted;
      const lv = levelOf(adopted);
      next.level = lv.level;
      next.level_key = lv.level_key;
    } else if (Math.abs(delta) >= 0.5) {
      changes.push(`${DIM_LABELS_ZH[k] || k}：${prev.score}→${next.score}`);
    }
  }
  return changes;
}

// ══════════════════════════════════════════════════════════════════
//  Public API
// ══════════════════════════════════════════════════════════════════

/**
 * 计算并落盘一次八维评估。
 * @param {string} userId
 * @param {object} [opts] {useLLM=false, trigger='manual', router=null(测试注入)}
 */
export async function computeDimensionAssessment(userId, { useLLM = false, trigger = 'manual', router = null } = {}) {
  const perDim = gatherSignals(userId);
  const threshold = minConfidence();

  // 规则层
  const dimensions = {};
  for (const k of LIFE_DIMENSIONS) {
    const { signals, summary, evidence_episode_ids, samples } = perDim[k];
    const confidence = computeConfidence(signals);
    if (confidence < threshold) {
      dimensions[k] = { status: 'insufficient', confidence, signals, evidence_episode_ids: [] };
      continue;
    }
    const rule = ruleScoreOf(signals);
    const lv = levelOf(rule);
    dimensions[k] = {
      status: 'scored',
      score: rule,
      level: lv.level,
      level_key: lv.level_key,
      confidence,
      rule_score: rule,
      insight: null,
      insight_method: 'rule',
      signals,
      evidence_episode_ids,
      // samples/summary 只在生成期使用，不落盘（瘦产物）
      _summary: summary,
      _samples: samples,
    };
  }

  // LLM 精炼层
  let method = 'rule';
  const scoredEntries = Object.fromEntries(
    Object.entries(dimensions)
      .filter(([, v]) => v.status === 'scored')
      .map(([k, v]) => [k, { rule_score: v.rule_score, confidence: v.confidence, signals: v.signals, summary: v._summary, samples: v._samples }]),
  );
  if (useLLM && Object.keys(scoredEntries).length > 0) {
    const lang = safe(() => store.getSettings(userId)?.language, undefined);
    const refined = await refineWithLLM({ scoredEntries, lang, router }).catch((e) => {
      console.error('[dimension-engine] LLM refine failed:', e?.message);
      return null;
    });
    if (refined) {
      method = 'llm';
      for (const [k, v] of Object.entries(dimensions)) {
        if (v.status !== 'scored') continue;
        const r = refined[k];
        if (!r || typeof r !== 'object') continue; // 该维回落规则分，insight_method 如实留 rule
        const llmScore = Number(r.score);
        if (Number.isFinite(llmScore)) {
          v.score = round1(clamp(llmScore, v.rule_score - LLM_MAX_DRIFT, v.rule_score + LLM_MAX_DRIFT));
          v.score = clamp(v.score, 0, 10);
          const lv = levelOf(v.score); // 等级复核由代码做，不信任 LLM
          v.level = lv.level;
          v.level_key = lv.level_key;
        }
        const insight = String(r.insight || '').trim();
        if (insight) {
          v.insight = insight.slice(0, 400);
          v.insight_method = 'llm';
        }
      }
    }
  }
  for (const v of Object.values(dimensions)) { delete v._summary; delete v._samples; }

  // Damping + overall
  const prev = safe(() => memStore.getDimensionAssessment(userId), null);
  const changes = applyDamping(prev?.dimensions || null, dimensions);
  const scored = Object.values(dimensions).filter(v => v.status === 'scored');
  const overall = scored.length
    ? { score: round1(scored.reduce((s, v) => s + v.score, 0) / scored.length), scored_dims: scored.length }
    : { score: null, scored_dims: 0 };

  const assessment = {
    version: (prev?.version || 0) + 1,
    generated_at: new Date().toISOString(),
    method,
    trigger,
    min_confidence: threshold,
    overall,
    changes,
    dimensions,
  };
  memStore.saveDimensionAssessment(userId, assessment);
  return assessment;
}

/**
 * 读当前评估；不存在时规则生成一份（首屏永远有值，不触发 LLM）。
 */
export async function getDimensionAssessment(userId, { generateIfMissing = true } = {}) {
  const latest = safe(() => memStore.getDimensionAssessment(userId), null);
  if (latest) return latest;
  if (!generateIfMissing) return null;
  return computeDimensionAssessment(userId, { useLLM: false, trigger: 'first_read' });
}

export default { computeDimensionAssessment, getDimensionAssessment, levelOf, computeConfidence, ruleScoreOf };
