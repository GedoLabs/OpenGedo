/**
 * 每日一问（软探询）契约测试。
 *
 * 锁定两个易回归点：
 *   - persona 分支（FEATURE_PERSONA_AS_MODE=true）也要注入探询——此前只有
 *     legacy 分支有，flag 开启后功能静默消失
 *   - buildSystemPrompt 只读不写：守卫经 context._pendingDailyProbe 外传，
 *     由 streamChatResponse 在本轮成功完成后落盘（注入即落盘会在流中断时
 *     白白消耗当天唯一机会）
 *
 * Run: npx vitest run test/daily-probe.test.mjs
 */

import { describe, it, expect, afterAll, afterEach } from 'vitest';
import { Store } from '../src/lib/store.mjs';
import { buildSystemPrompt } from '../src/services/conversation.service.mjs';

const store = Store();
const U = `daily-probe-test-${Date.now()}`;

const FLAG = 'FEATURE_PERSONA_AS_MODE';
const flagBefore = process.env[FLAG];

afterEach(() => {
  if (flagBefore === undefined) delete process.env[FLAG];
  else process.env[FLAG] = flagBefore;
});
afterAll(() => { store.wipeUser(U); });

const today = new Date().toISOString().slice(0, 10);
// 新用户核心槽位全部未填 → 探询必然生成
const baseContext = () => ({ goals: [], todayTasks: [] });

describe('每日一问 — legacy 分支（flag off）', () => {
  it('注入探询，守卫外传而非落盘', () => {
    process.env[FLAG] = 'false';
    const ctx = baseContext();
    const prompt = buildSystemPrompt({ id: U }, ctx);

    expect(prompt).toContain('每日一问');
    expect(ctx._pendingDailyProbe).toEqual({ date: today, id: expect.any(String) });
    // 只读契约：buildSystemPrompt 本身绝不写 settings.daily_probe
    expect(store.getSettings(U)?.daily_probe?.date).not.toBe(today);
  });
});

describe('每日一问 — persona 分支（flag on）', () => {
  const personaContext = (mode) => ({
    ...baseContext(),
    personaMode: mode,
    l1: { display_name: '测试用户' },
    l2: [],
    l5: [],
  });

  it('FOR 模式注入探询（此前缺失的分支）', () => {
    process.env[FLAG] = 'true';
    const ctx = personaContext('FOR');
    const prompt = buildSystemPrompt({ id: U }, ctx);

    expect(prompt).toContain('每日一问');
    expect(ctx._pendingDailyProbe).toEqual({ date: today, id: expect.any(String) });
    expect(store.getSettings(U)?.daily_probe?.date).not.toBe(today);
  });

  it('AS 代写模式不探询（不该在代写产物里问用户个人信息）', () => {
    process.env[FLAG] = 'true';
    const ctx = personaContext('AS');
    const prompt = buildSystemPrompt({ id: U }, ctx);

    expect(prompt).not.toContain('每日一问');
    expect(ctx._pendingDailyProbe).toBeUndefined();
  });
});

describe('每日一问 — 守卫与隐私开关', () => {
  it('当天守卫已落盘 → 两个分支都不再探询', () => {
    store.updateSettings(U, { daily_probe: { date: today, id: 'slot:test' } });

    process.env[FLAG] = 'false';
    const legacyCtx = baseContext();
    expect(buildSystemPrompt({ id: U }, legacyCtx)).not.toContain('每日一问');
    expect(legacyCtx._pendingDailyProbe).toBeUndefined();

    process.env[FLAG] = 'true';
    const personaCtx = { ...baseContext(), personaMode: 'FOR', l1: { display_name: '测试用户' }, l2: [], l5: [] };
    expect(buildSystemPrompt({ id: U }, personaCtx)).not.toContain('每日一问');
    expect(personaCtx._pendingDailyProbe).toBeUndefined();

    store.updateSettings(U, { daily_probe: null });
  });

  it('pause_memory 打开 → 不学习也不探询', () => {
    store.updateSettings(U, { privacy_settings: { pause_memory: true } });

    process.env[FLAG] = 'false';
    const ctx = baseContext();
    expect(buildSystemPrompt({ id: U }, ctx)).not.toContain('每日一问');
    expect(ctx._pendingDailyProbe).toBeUndefined();

    store.updateSettings(U, { privacy_settings: { pause_memory: false } });
  });
});
