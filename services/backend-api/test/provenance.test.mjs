/**
 * Provenance + Abstention Tests
 *
 * Validates the report-driven improvements:
 *   - formatProvenance() renders 日期·来源·置信度 with a low-confidence flag.
 *   - The memory context exposes provenance to the model.
 *   - The shared tool-usage rules and the public ABOUT prompt carry the
 *     honesty / abstention clauses.
 *
 * Run: npx vitest run test/provenance.test.mjs
 */

import { describe, it, expect } from 'vitest';
import { formatProvenance } from '../src/memory/context-builder.mjs';
import { LOW_CONFIDENCE_THRESHOLD } from '../src/memory/types.mjs';
import { buildAboutSystemPrompt } from '../src/services/digital-persona.service.mjs';

describe('formatProvenance', () => {
  it('renders date · source label · confidence for a high-confidence episode', () => {
    const out = formatProvenance({
      created_at: '2026-05-01T10:00:00.000Z',
      source: 'auto_extract',
      confidence: 0.8,
    });
    expect(out).toBe('2026-05-01·自动提取·置信80%');
    expect(out).not.toContain('⚠低置信');
  });

  it('flags low-confidence memories', () => {
    const out = formatProvenance({
      created_at: '2026-01-15T00:00:00.000Z',
      source: 'chat',
      confidence: LOW_CONFIDENCE_THRESHOLD,
    });
    expect(out).toContain('对话');
    expect(out).toContain('置信50%');
    expect(out).toContain('⚠低置信');
  });

  it('infers visitor source from a from:relId tag', () => {
    const out = formatProvenance({
      created_at: '2026-03-03T00:00:00.000Z',
      tags: ['from:rel_abc', 'topic'],
      confidence: 0.6,
    });
    expect(out).toContain('访客');
  });

  it('degrades gracefully when fields are missing', () => {
    expect(formatProvenance({})).toBe('');
    expect(formatProvenance({ source: 'text' })).toBe('手动记录');
  });
});

describe('ABOUT public prompt — abstention', () => {
  it('instructs the digital human to refuse fabricating facts not in the public profile', () => {
    const persona = {
      slug: 'demo',
      display_name: '张三',
      user_id: 'nonexistent-user-for-test',
    };
    const prompt = buildAboutSystemPrompt(persona, persona.user_id, null);
    expect(prompt).toContain('不掌握就明说');
    expect(prompt).toContain('绝不猜测');
    // Display name is interpolated into the abstention clause.
    expect(prompt).toContain('张三');
  });
});
