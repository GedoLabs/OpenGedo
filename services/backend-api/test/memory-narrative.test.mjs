/**
 * Narrative Engine tests (P4).
 *
 * Verifies rule-based narrative generation, storage per window, window
 * normalization, and the compact chat renderer (no LLM). Isolated user.
 *
 * Run: npx vitest run test/memory-narrative.test.mjs
 */

import { describe, it, expect, afterAll } from 'vitest';
import { generateNarrative, getNarrative, renderNarrativeContext } from '../src/memory/engines/narrative-engine.mjs';
import { addEpisode, updateProfile, wipeUserMemory } from '../src/memory/memory-file.service.mjs';

const U = `narrative-test-${Date.now()}`;
afterAll(() => wipeUserMemory(U));

describe('P4 Narrative Engine', () => {
  it('generates a structured rule-based narrative for a window', async () => {
    updateProfile(U, {
      semantic_memory: {
        dimensions: { career: { summary: 'B端改版', self_score: 8, skills: ['需求分析'] } },
        failure_learnings: [{ lesson: '容易拖延' }],
        milestone_events: [{ event: '完成改版上线', ts: new Date().toISOString() }],
      },
    });
    addEpisode(U, { type: 'key_event', contentRaw: '推进了产品改版', source: 'text', impactScore: 0.8 });
    addEpisode(U, { type: 'decision', contentRaw: '决定每天复盘', source: 'text' });

    const r = await generateNarrative(U, 30, { useLLM: false });
    expect(r.window_days).toBe(30);
    expect(r.method).toBe('rule');
    expect(typeof r.summary).toBe('string');
    expect(r.summary.length).toBeGreaterThan(0);
    for (const k of ['changes', 'risks', 'opportunities', 'next_steps', 'highlights']) {
      expect(Array.isArray(r[k])).toBe(true);
    }
    expect(r.next_steps.length).toBeGreaterThan(0);
    expect(r.signals.episodes).toBeGreaterThanOrEqual(2);
    expect(r.stage).toBeTruthy();
  });

  it('persists per window and getNarrative returns the stored report', async () => {
    const stored = await getNarrative(U, 30, { generateIfMissing: false });
    expect(stored).toBeTruthy();
    expect(stored.window_days).toBe(30);
    // a not-yet-generated window returns null when generateIfMissing=false
    expect(await getNarrative(U, 7, { generateIfMissing: false })).toBeNull();
  });

  it('normalizes invalid windows to 30', async () => {
    const r = await generateNarrative(U, 999, { useLLM: false });
    expect(r.window_days).toBe(30);
  });

  it('renders a compact 成长阶段 block, empty for null', () => {
    const r = { window_days: 30, stage: '建设期 · 专注执行', next_steps: ['推进目标：英语'] };
    const txt = renderNarrativeContext(r);
    expect(txt).toContain('## 成长阶段');
    expect(txt).toContain('近30天');
    expect(renderNarrativeContext(null)).toBe('');
  });
});
