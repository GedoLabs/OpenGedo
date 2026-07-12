/**
 * Onboarding quest structure — copy lives in messages/app/planner-onboarding.<locale>.json
 * under app.onboarding.*. Stable question ids must not change after launch.
 */

export type QuestionType = 'short_text' | 'long_text' | 'multi_short_text' | 'rating_grid';

export interface QuestQuestionSchema {
  id: string;
  type: QuestionType;
  optional?: boolean;
  count?: number;
  scale?: { min: number; max: number };
}

export interface QuestDaySchema {
  day: number;
  layer: 'L1' | 'L2' | 'L3';
  /** i18n key under onboarding.layers.* */
  layerKey: 'identity' | 'semantic' | 'working';
  questions: QuestQuestionSchema[];
}

export const LIFE_WHEEL_DIM_KEYS = [
  'health', 'career', 'family', 'finance', 'growth', 'social', 'hobby', 'self_realization',
] as const;

export const QUEST_DAY_SCHEMA: QuestDaySchema[] = [
  {
    day: 1,
    layer: 'L1',
    layerKey: 'identity',
    questions: [
      { id: 'name', type: 'short_text' },
      { id: 'birthday', type: 'short_text', optional: true },
      { id: 'location', type: 'short_text', optional: true },
      { id: 'role', type: 'short_text' },
    ],
  },
  {
    day: 2,
    layer: 'L1',
    layerKey: 'identity',
    questions: [
      { id: 'core_beliefs', type: 'long_text' },
      { id: 'non_negotiables', type: 'long_text' },
    ],
  },
  {
    day: 3,
    layer: 'L3',
    layerKey: 'semantic',
    questions: [
      { id: 'pivotal_success', type: 'long_text' },
      { id: 'pivotal_failure', type: 'long_text' },
      { id: 'pivotal_turning', type: 'long_text' },
    ],
  },
  {
    day: 4,
    layer: 'L3',
    layerKey: 'semantic',
    questions: [
      { id: 'important_people', type: 'multi_short_text', count: 5 },
      { id: 'relationship_notes', type: 'long_text', optional: true },
    ],
  },
  {
    day: 5,
    layer: 'L3',
    layerKey: 'semantic',
    questions: [
      { id: 'life_wheel_self_score', type: 'rating_grid', scale: { min: 0, max: 10 } },
      { id: 'capability_evidence', type: 'long_text', optional: true },
    ],
  },
  {
    day: 6,
    layer: 'L2',
    layerKey: 'working',
    questions: [
      { id: 'top_3_challenges', type: 'multi_short_text', count: 3 },
      { id: 'why_now', type: 'long_text', optional: true },
    ],
  },
  {
    day: 7,
    layer: 'L1',
    layerKey: 'identity',
    questions: [
      { id: 'future_5y', type: 'long_text' },
      { id: 'future_10y', type: 'long_text', optional: true },
      { id: 'north_star', type: 'short_text' },
    ],
  },
];

export const TOTAL_DAYS = QUEST_DAY_SCHEMA.length;
export const FINAL_STEP = TOTAL_DAYS;

// ── Presentation-only ring grouping（三圈递进：先易后难）───────────────
// Pure UI metadata — question ids and day numbers are untouched (stability
// contract above; submissions still POST the original `day`). The quest
// navigates in ring order so the essay-heavy core ring comes last:
// 基础圈(30秒) → 生活圈(选择为主) → 内核圈(作文题，可"说一句也行").
export type RingKey = 'basics' | 'life' | 'core';

export const RING_SCHEMA: { ring: RingKey; days: number[] }[] = [
  { ring: 'basics', days: [1] },
  { ring: 'life', days: [4, 5, 6] },
  { ring: 'core', days: [2, 3, 7] },
];

/** Navigation order in ring sequence: [1, 4, 5, 6, 2, 3, 7]. */
export const QUEST_SEQUENCE: number[] = RING_SCHEMA.flatMap(r => r.days);

export function ringForDay(day: number): RingKey {
  return RING_SCHEMA.find(r => r.days.includes(day))?.ring ?? 'core';
}

/** Whether submitting this day completes its ring (→ 了解等级 feedback). */
export function isRingFinalDay(day: number): boolean {
  return RING_SCHEMA.some(r => r.days[r.days.length - 1] === day);
}

/** 了解等级 from core-slot completeness percent（初识→熟悉→知己→懂你）. */
export function knowLevelKey(percent: number): 'l1' | 'l2' | 'l3' | 'l4' {
  if (percent >= 85) return 'l4';
  if (percent >= 60) return 'l3';
  if (percent >= 25) return 'l2';
  return 'l1';
}
