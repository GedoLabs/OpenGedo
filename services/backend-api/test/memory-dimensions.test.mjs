/**
 * Dimension Engine tests（生命之花八维 AI+规则评估）.
 *
 * Covers: insufficient 门槛（空用户不给分）、规则分与等级边界、自评锚方向、
 * damping ±2 钳制与 changes、LLM 越界钳制 + insight 落盘 + level 代码重算。
 * LLM 经 router 参数注入 stub —— 无网络。
 *
 * Run: npx vitest run test/memory-dimensions.test.mjs
 */

import { describe, it, expect, afterAll } from 'vitest';
import { Store } from '../src/lib/store.mjs';
import { addEpisode, updateProfile, wipeUserMemory, saveDimensionAssessment } from '../src/memory/memory-file.service.mjs';
import {
  computeDimensionAssessment, getDimensionAssessment, levelOf, computeConfidence, ruleScoreOf,
} from '../src/memory/engines/dimension-engine.mjs';

const store = Store();

function freshUser() { return `dim-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; }
const users = [];
function U() { const u = freshUser(); users.push(u); return u; }
afterAll(() => { for (const u of users) wipeUserMemory(u); });

/** 造一个 career 维「过门槛」的用户：6 条记忆 + summary + 活跃目标。 */
function seedCareer(u) {
  updateProfile(u, {
    semantic_memory: {
      dimensions: { career: { summary: '在推进跨境电商创业，节奏稳定', skills: ['谈判', '增长'] } },
    },
  });
  for (let i = 0; i < 6; i++) {
    addEpisode(u, { type: 'key_event', contentRaw: `事业推进第 ${i} 步`, source: 'text', dimensions: ['career'], impactScore: 0.5 + i * 0.05 });
  }
  const goal = store.createGoal(u, { title: `${u}-goal`, life_wheel_dimension: 'career', status: 'active' });
  store.updateGoal?.(u, goal.id, { progress: 60 });
  return goal;
}

describe('dimension engine — 纯函数', () => {
  it('levelOf 档位边界（每 2 分一档，10 封顶 blooming）', () => {
    expect(levelOf(0)).toEqual({ level: 1, level_key: 'needs_care' });
    expect(levelOf(1.9).level_key).toBe('needs_care');
    expect(levelOf(2).level_key).toBe('sprouting');
    expect(levelOf(4).level_key).toBe('growing');
    expect(levelOf(6).level_key).toBe('thriving');
    expect(levelOf(8).level_key).toBe('blooming');
    expect(levelOf(10)).toEqual({ level: 5, level_key: 'blooming' });
  });

  it('computeConfidence：零信号≈0，记忆量为主导', () => {
    const zero = computeConfidence({ ep_total: 0, has_summary: false, skills: 0, goals_active: 0, goals_completed_90d: 0, self_score: null });
    expect(zero).toBe(0);
    const rich = computeConfidence({ ep_total: 12, has_summary: true, skills: 2, goals_active: 1, goals_completed_90d: 1, self_score: 7 });
    expect(rich).toBe(1);
    // 仅自评（onboarding 完但没聊过）不过 0.25 门槛 —— 诚实说了解不足
    const selfOnly = computeConfidence({ ep_total: 0, has_summary: false, skills: 0, goals_active: 0, goals_completed_90d: 0, self_score: 7 });
    expect(selfOnly).toBeLessThan(0.25);
  });

  it('ruleScoreOf：自评锚朝自评方向偏移；无目标时缺项重归一不塌分', () => {
    const base = { ep_30d: 3, ep_90d: 5, goals_active: 0, goals_avg_progress: null, goals_completed_90d: 0, has_summary: true, skills: 2, has_patterns: false, self_score: null };
    const noAnchor = ruleScoreOf(base);
    const highAnchor = ruleScoreOf({ ...base, self_score: 10 });
    const lowAnchor = ruleScoreOf({ ...base, self_score: 0 });
    expect(highAnchor).toBeGreaterThan(noAnchor);
    expect(lowAnchor).toBeLessThan(noAnchor);
    // 有目标 vs 无目标：同等其余信号下有推进目标应不低于无目标
    const withGoal = ruleScoreOf({ ...base, goals_active: 1, goals_avg_progress: 80, goals_completed_90d: 1 });
    expect(withGoal).toBeGreaterThanOrEqual(noAnchor);
  });
});

describe('dimension engine — 评估管线', () => {
  it('空用户：全维 insufficient、overall null、generateIfMissing 落盘', async () => {
    const u = U();
    const a = await getDimensionAssessment(u); // 首读触发规则生成
    expect(a.version).toBe(1);
    expect(a.method).toBe('rule');
    expect(a.overall.score).toBeNull();
    expect(a.overall.scored_dims).toBe(0);
    for (const v of Object.values(a.dimensions)) {
      expect(v.status).toBe('insufficient');
      expect(v.score).toBeUndefined();
    }
    // 已落盘：再读不再生成（version 不变）
    const again = await getDimensionAssessment(u);
    expect(again.version).toBe(1);
  });

  it('过门槛维度给分带等级与证据；未种数据的维度仍 insufficient', async () => {
    const u = U();
    seedCareer(u);
    const a = await computeDimensionAssessment(u, { useLLM: false });
    const career = a.dimensions.career;
    expect(career.status).toBe('scored');
    expect(career.score).toBeGreaterThan(0);
    expect(career.level).toBe(levelOf(career.score).level);
    expect(career.rule_score).toBe(career.score);
    expect(career.insight).toBeNull();
    expect(career.insight_method).toBe('rule');
    expect(career.evidence_episode_ids.length).toBeGreaterThan(0);
    expect(career.signals.ep_total).toBe(6);
    expect(a.dimensions.hobby.status).toBe('insufficient');
    expect(a.overall.scored_dims).toBe(1);
    expect(a.overall.score).toBe(career.score);
  });

  it('damping：跳变钳 ±2 且 changes 记录；首评不阻尼', async () => {
    const u = U();
    seedCareer(u);
    const first = await computeDimensionAssessment(u, { useLLM: false });
    const firstScore = first.dimensions.career.score;
    expect(first.dimensions.career.prev_score).toBeUndefined(); // 首评不阻尼

    // 手写一份 prev：career 上次 1.0 分 → 本次真实分与 prev 差 >2 时应被钳
    saveDimensionAssessment(u, {
      ...first,
      dimensions: {
        ...first.dimensions,
        career: { ...first.dimensions.career, score: Math.max(0, firstScore - 5), level: 1, level_key: 'needs_care' },
      },
    });
    const second = await computeDimensionAssessment(u, { useLLM: false });
    const prevScore = Math.max(0, firstScore - 5);
    expect(second.dimensions.career.prev_score).toBe(prevScore);
    expect(second.dimensions.career.score).toBeCloseTo(prevScore + 2, 5); // 钳到 prev+2
    expect(second.dimensions.career.level).toBe(levelOf(second.dimensions.career.score).level);
    expect(second.changes.some(c => c.includes('已阻尼'))).toBe(true);
    expect(second.version).toBe(first.version + 1); // 手写覆盖未改 version，本次 compute +1
  });

  it('LLM 精炼：越界分被钳 rule±2、insight 落盘、level 代码重算、method=llm', async () => {
    const u = U();
    seedCareer(u);
    const stub = {
      isAvailable: () => true,
      async runTask() {
        return { json: { dimensions: { career: { score: 99, insight: '你的事业在稳步推进，跨境电商项目已见雏形。' } } } };
      },
    };
    const a = await computeDimensionAssessment(u, { useLLM: true, router: stub });
    const career = a.dimensions.career;
    expect(a.method).toBe('llm');
    expect(career.score).toBeCloseTo(Math.min(10, career.rule_score + 2), 5); // 99 → rule+2 (≤10)
    expect(career.level).toBe(levelOf(career.score).level);
    expect(career.insight).toContain('跨境电商');
    expect(career.insight_method).toBe('llm');
  });

  it('LLM 单维缺失/失败：该维回落规则分，insight_method 如实 rule', async () => {
    const u = U();
    seedCareer(u);
    const stub = { isAvailable: () => true, async runTask() { return { json: { dimensions: {} } }; } };
    const a = await computeDimensionAssessment(u, { useLLM: true, router: stub });
    const career = a.dimensions.career;
    expect(career.score).toBe(career.rule_score);
    expect(career.insight).toBeNull();
    expect(career.insight_method).toBe('rule');
  });
});
