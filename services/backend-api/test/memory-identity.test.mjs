/**
 * Identity Engine tests (P3).
 *
 * Verifies rule-based identity derivation from semantic memory, append-only
 * versioning, and damping (no LLM). Isolated to a throwaway memory user.
 *
 * Run: npx vitest run test/memory-identity.test.mjs
 */

import { describe, it, expect, afterAll } from 'vitest';
import { computeIdentity, getIdentity } from '../src/memory/engines/identity-engine.mjs';
import { updateProfile, getIdentityVersions, getLatestIdentity, wipeUserMemory } from '../src/memory/memory-file.service.mjs';

const U = `identity-test-${Date.now()}`;
afterAll(() => wipeUserMemory(U));

describe('P3 Identity Engine', () => {
  it('computes a first identity version (rule-based) from semantic memory', async () => {
    updateProfile(U, {
      semantic_memory: {
        dimensions: {
          career: { summary: '主导 B 端工具改版', self_score: 8, skills: ['需求分析', '用户研究'] },
          growth: { summary: '在读书', self_score: 3 },
        },
        failure_learnings: [{ lesson: '容易拖延重要决定' }],
        milestone_events: [{ event: 'a' }, { event: 'b' }, { event: 'c' }],
      },
    });
    const v1 = await computeIdentity(U, { useLLM: false });
    expect(v1.version).toBe(1);
    expect(v1.changes).toContain('首次建立人格模型');
    expect(v1.model.strengths.some(s => s.label.includes('事业'))).toBe(true);
    expect(v1.model.weaknesses.some(w => w.label.includes('拖延') || w.label.includes('成长'))).toBe(true);
    expect(v1.model.growth_stage).toBeTruthy();
    expect(v1.model.decision_style).toBeTruthy();
    expect(typeof v1.confidence.overall).toBe('number');
  });

  it('versions on each compute and keeps history with change notes', async () => {
    const v2 = await computeIdentity(U, { useLLM: false });
    expect(v2.version).toBe(2);
    expect(Array.isArray(v2.changes)).toBe(true);
    expect(v2.changes.length).toBeGreaterThan(0);
    expect(getIdentityVersions(U).length).toBe(2);
    expect(getLatestIdentity(U).version).toBe(2);
  });

  it('getIdentity returns the latest version without creating a new one', async () => {
    const id = await getIdentity(U);
    expect(id.version).toBe(2);
    expect(getIdentityVersions(U).length).toBe(2); // unchanged
  });

  it('damps enum fields — same inputs do not flip growth_stage', async () => {
    const before = getLatestIdentity(U).model.growth_stage;
    const v = await computeIdentity(U, { useLLM: false });
    expect(v.model.growth_stage).toBe(before);
  });
});
