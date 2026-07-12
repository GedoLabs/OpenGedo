'use client';

import { useTranslations } from 'next-intl';
import type { GoalLevel, GoalStatus } from './types';
import type { LifeWheelDimension } from '../life-tree/types';
import type { ObstacleType } from '../obstacles/types';
import { LEVEL_COLORS } from './types';
import { OBSTACLE_TYPE_META } from '../obstacles/types';

export function usePlannerDimensions() {
  const t = useTranslations('app.planner.dimensions');
  return (dim: LifeWheelDimension) => t(dim);
}

export function usePlannerLevelInfo() {
  const t = useTranslations('app.planner.levels');
  return (level: GoalLevel) => ({
    label: t(`${level}.label`),
    timeframe: t(`${level}.timeframe`),
    color: LEVEL_COLORS[level],
  });
}

export function usePlannerStatusLabel() {
  const t = useTranslations('app.planner.status');
  return (status: GoalStatus) => t(status);
}

export function useObstacleTypeInfo() {
  const t = useTranslations('app.planner.obstacleTypes');
  return (type: ObstacleType) => {
    const meta = OBSTACLE_TYPE_META[type] ?? OBSTACLE_TYPE_META.procrastination_fear;
    return {
      ...meta,
      label: t(`${type}.label`),
      description: t(`${type}.description`),
    };
  };
}
