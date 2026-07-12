// 障碍预案 (Obstacle Engine) 数据类型
// M2 模块：If-Then 障碍应对卡片 + 障碍库

export type ObstacleType =
  | 'time_limited'
  | 'attention_scattered'
  | 'procrastination_fear'
  | 'info_insufficient'
  | 'energy_low'
  | 'external_dependency';

export interface IfThenCard {
  id: string;
  goalId: string;
  goalTitle?: string;
  obstacleDescription: string;
  ifCondition: string;
  thenAction: string;
  untilCondition?: string;
  obstacleType: ObstacleType;
  triggeredCount: number;
  executedCount: number;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
}

export interface ObstacleEvent {
  id: string;
  taskId: string;
  taskTitle?: string;
  obstacleType: ObstacleType;
  matchedPredicted: boolean;
  ifThenCardId?: string;
  ifThenTriggered: boolean;
  ifThenExecuted: boolean;
  reasonNote?: string;
  occurredAt: string;
}

export interface ObstacleStats {
  totalCards: number;
  totalEvents: number;
  hitRate: number;
  triggerCount: number;
  executeCount: number;
  byType: Record<ObstacleType, number>;
}

export const OBSTACLE_TYPE_META: Record<ObstacleType, { icon: string; color: string }> = {
  time_limited: { icon: '⏰', color: '#f59e0b' },
  attention_scattered: { icon: '🎯', color: '#3b82f6' },
  procrastination_fear: { icon: '😰', color: '#ef4444' },
  info_insufficient: { icon: '📋', color: '#8b5cf6' },
  energy_low: { icon: '🔋', color: '#06b6d4' },
  external_dependency: { icon: '🔗', color: '#ec4899' },
};

/** @deprecated 文案走 app.planner.obstacleTypes；保留供未迁移引用 */
export const OBSTACLE_TYPE_LABELS: Record<ObstacleType, { label: string; icon: string; color: string; description: string }> = {
  time_limited: { ...OBSTACLE_TYPE_META.time_limited, label: '', description: '' },
  attention_scattered: { ...OBSTACLE_TYPE_META.attention_scattered, label: '', description: '' },
  procrastination_fear: { ...OBSTACLE_TYPE_META.procrastination_fear, label: '', description: '' },
  info_insufficient: { ...OBSTACLE_TYPE_META.info_insufficient, label: '', description: '' },
  energy_low: { ...OBSTACLE_TYPE_META.energy_low, label: '', description: '' },
  external_dependency: { ...OBSTACLE_TYPE_META.external_dependency, label: '', description: '' },
};
