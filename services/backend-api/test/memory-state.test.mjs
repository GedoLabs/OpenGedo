/**
 * State Engine tests (P2).
 *
 * Verifies the rule-based current-state computation from working memory +
 * recent episodes (isolated to a throwaway memory user — app-store goals/tasks
 * are empty for it, so store.json is untouched). No LLM required.
 *
 * Run: npx vitest run test/memory-state.test.mjs
 */

import { describe, it, expect, afterAll } from 'vitest';
import { computeState, renderStateContext } from '../src/memory/engines/state-engine.mjs';
import { updateWorkingMemory, addEpisode, wipeUserMemory } from '../src/memory/memory-file.service.mjs';

const U = `state-test-${Date.now()}`;
afterAll(() => wipeUserMemory(U));

describe('P2 State Engine', () => {
  it('computes focus + emotion from working memory', () => {
    updateWorkingMemory(U, { current_context: { focus_domain: 'career', emotional_state: 'slightly_stressed' } });
    const s = computeState(U, { force: true });
    expect(s.focus?.domain).toBe('career');
    expect(s.focus?.label).toBe('事业');
    expect(s.emotion).toBe('slightly_stressed');
    expect(s.emotion_label).toBe('略有压力');
  });

  it('infers cognitive_mode = planning from recent decision episodes', () => {
    addEpisode(U, { type: 'decision', contentRaw: '决定每天写日报', source: 'text' });
    addEpisode(U, { type: 'decision', contentRaw: '决定换一个任务管理工具', source: 'text' });
    const s = computeState(U, { force: true });
    expect(s.cognitive_mode).toBe('planning');
    expect(s.cognitive_mode_label).toBe('规划中');
  });

  it('exposes confidence + evidence signals', () => {
    const s = computeState(U, { force: true });
    expect(typeof s.confidence).toBe('number');
    expect(Array.isArray(s.signals)).toBe(true);
    expect(s.signals.length).toBeGreaterThan(0);
    expect(s.momentum).toHaveProperty('trend');
  });

  it('renders a 当前状态 block, and nothing when there is no signal', () => {
    const txt = renderStateContext(computeState(U, { force: true }));
    expect(txt).toContain('## 当前状态');
    expect(txt).toContain('事业');
    // low/zero confidence → never fabricate a state
    expect(renderStateContext({ confidence: 0 })).toBe('');
    expect(renderStateContext(null)).toBe('');
  });
});
