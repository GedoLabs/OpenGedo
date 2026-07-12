import { describe, it, expect } from 'vitest';
import { validateGedoCard, parseGedoCards } from './schemas';

describe('validateGedoCard — shape guard (crash prevention)', () => {
  it('accepts a well-formed goal_progress card', () => {
    expect(validateGedoCard({
      card_type: 'goal_progress',
      goals: [{ goal_id: 'g1', title: 't', progress: 50, status: 'on_track' }],
    })).not.toBeNull();
  });

  it('rejects goal_progress drift with no goals array (was: crash at card.goals.map)', () => {
    expect(validateGedoCard({ card_type: 'goal_progress', milestones: [{ title: 'm' }] })).toBeNull();
    expect(validateGedoCard({ card_type: 'goal_progress' })).toBeNull();
    expect(validateGedoCard({ card_type: 'goal_progress', goals: 'oops' })).toBeNull();
  });

  it('accepts snapshot / task_adjust / memory_list with their array field', () => {
    expect(validateGedoCard({ card_type: 'snapshot', period: 'week', stats: [] })).not.toBeNull();
    expect(validateGedoCard({ card_type: 'task_adjust', items: [] })).not.toBeNull();
    expect(validateGedoCard({ card_type: 'memory_list', items: [] })).not.toBeNull();
  });

  it('rejects a card missing its array field', () => {
    expect(validateGedoCard({ card_type: 'snapshot', period: 'week' })).toBeNull();
    expect(validateGedoCard({ card_type: 'memory_list' })).toBeNull();
  });

  it('rejects unknown card_type, non-objects, and missing card_type', () => {
    expect(validateGedoCard({ card_type: 'weekly_snapshot', data: {} })).toBeNull();
    expect(validateGedoCard('nope')).toBeNull();
    expect(validateGedoCard(null)).toBeNull();
    expect(validateGedoCard([1, 2])).toBeNull();
    expect(validateGedoCard({ stats: [] })).toBeNull();
  });
});

describe('parseGedoCards — history rehydrate', () => {
  it('extracts a card from a stored body and strips the fence from display text', () => {
    const raw = '回顾一下。\n```gedo:card:v1\n{"card_type":"goal_progress","goals":[{"goal_id":"g1","title":"读书","progress":40,"status":"on_track"}]}\n```';
    const { text, cards } = parseGedoCards(raw);
    expect(cards).toHaveLength(1);
    expect(cards[0].card_type).toBe('goal_progress');
    expect(text).toBe('回顾一下。');
  });

  it('extracts multiple fenced cards', () => {
    const raw = '```gedo:card:v1\n{"card_type":"snapshot","period":"week","stats":[]}\n```\n中间\n```gedo:card:v1\n{"card_type":"memory_list","items":[]}\n```';
    const { cards } = parseGedoCards(raw);
    expect(cards).toHaveLength(2);
  });

  it('keeps a malformed-JSON fence in the text instead of losing it', () => {
    const { cards, text } = parseGedoCards('x\n```gedo:card:v1\n{bad json}\n```');
    expect(cards).toHaveLength(0);
    expect(text).toContain('gedo:card:v1');
  });

  it('returns the input untouched when there is no fence', () => {
    const { cards, text } = parseGedoCards('just a normal reply');
    expect(cards).toHaveLength(0);
    expect(text).toBe('just a normal reply');
  });

  it('handles empty / falsy input', () => {
    expect(parseGedoCards('')).toEqual({ text: '', cards: [] });
  });
});
