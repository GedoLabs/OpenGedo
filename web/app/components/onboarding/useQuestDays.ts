'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import {
  LIFE_WHEEL_DIM_KEYS,
  QUEST_DAY_SCHEMA,
  type QuestDaySchema,
  type QuestQuestionSchema,
} from './quest-schema';

export interface QuestQuestion {
  id: string;
  type: QuestQuestionSchema['type'];
  label: string;
  hint?: string;
  placeholder?: string;
  count?: number;
  dimensions?: Array<{ key: string; label: string }>;
  scale?: { min: number; max: number };
  optional?: boolean;
}

export interface QuestDay {
  day: number;
  title: string;
  intro: string;
  layer: QuestDaySchema['layer'];
  layerLabel: string;
  questions: QuestQuestion[];
}

function qKey(day: number, qid: string, field: 'label' | 'hint' | 'placeholder') {
  // 动态拼出的消息键，next-intl 无法静态校验；转宽松类型交由运行时解析（配合 t.has 兜底）。
  return `days.${day}.questions.${qid}.${field}` as never;
}

export function useQuestDays(): QuestDay[] {
  const t = useTranslations('app.onboarding');

  return useMemo(() => QUEST_DAY_SCHEMA.map((day) => ({
    day: day.day,
    title: t(`days.${day.day}.title` as never),
    intro: t(`days.${day.day}.intro` as never),
    layer: day.layer,
    layerLabel: t(`layers.${day.layerKey}`),
    questions: day.questions.map((q) => {
      const label = t(qKey(day.day, q.id, 'label'));
      const hintKey = qKey(day.day, q.id, 'hint');
      const placeholderKey = qKey(day.day, q.id, 'placeholder');
      const hint = t.has(hintKey) ? t(hintKey) : undefined;
      const placeholder = t.has(placeholderKey) ? t(placeholderKey) : undefined;
      return {
        id: q.id,
        type: q.type,
        optional: q.optional,
        count: q.count,
        scale: q.scale,
        label,
        hint,
        placeholder,
        dimensions: q.type === 'rating_grid'
          ? LIFE_WHEEL_DIM_KEYS.map((key) => ({ key, label: t(`lifeWheel.${key}`) }))
          : undefined,
      };
    }),
  })), [t]);
}
