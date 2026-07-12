// 每日执行 (Daily Engine) 数据类型
// M3 模块：晨间计划 / 全天执行 / 晚间反思

export interface Task {
  id: string;
  goalId?: string;
  goalTitle?: string;
  planNodeId?: string;
  title: string;
  description?: string;
  estimatedDuration?: number;
  estimatedMinutes?: number;
  energyLevel?: 'low' | 'medium' | 'high';
  priority?: number | 'high' | 'medium' | 'low';
  status: 'pending' | 'in_progress' | 'completed' | 'skipped' | 'postponed';
  scheduledDate?: string;
  dueDate?: string;
  completedAt?: string;
  isMIT?: boolean;
  feelingTag?: 'smooth' | 'challenging' | 'struggling';
  createdAt?: string;
}

export interface CheckIn {
  id: string;
  taskId: string;
  status: 'completed' | 'not_completed' | 'partial';
  reasonCode?: ReasonCode;
  reasonNote?: string;
  actualDuration?: number;
  moodRating?: 1 | 2 | 3 | 4 | 5;
  feelingTag?: 'smooth' | 'challenging' | 'struggling';
  obstacleMatched?: boolean;
  checkedAt: string;
}

export type ReasonCode =
  | 'time_insufficient'
  | 'energy_low'
  | 'priority_changed'
  | 'external_interrupt'
  | 'forgot'
  | 'procrastination'
  | 'other';

export interface Adjustment {
  id: string;
  triggerCheckInId?: string;
  adjustmentType: 'reschedule' | 'split' | 'postpone' | 'cancel';
  originalTaskId: string;
  newTaskIds?: string[];
  reason: string;
  aiSuggestion?: {
    message: string;
    options: Array<{ id: string; label: string; action: string }>;
  };
  accepted?: boolean;
  createdAt: string;
}

// 晚间反思
export interface Reflection {
  id: string;
  date: string;
  q1ObstacleTag: ReasonCode | null;
  q2MostValuable: string;
  q3AdjustmentTag: 'more_time' | 'fewer_tasks' | 'reorder' | 'no_change';
  ecsScore: ECSScore;
  createdAt: string;
}

// ECS 执行一致性分数
export interface ECSScore {
  completionRate: number;
  planStability: number;
  reflectionCompleted: boolean;
  total: number;
}

export type DayPhase = 'morning' | 'daytime' | 'evening';

export const REASON_LABELS: Record<ReasonCode, { label: string; icon: string }> = {
  time_insufficient: { label: '时间不够', icon: '⏰' },
  energy_low: { label: '精力不足', icon: '😴' },
  priority_changed: { label: '优先级变更', icon: '🔄' },
  external_interrupt: { label: '外部打断', icon: '📞' },
  forgot: { label: '忘记了', icon: '🤔' },
  procrastination: { label: '拖延', icon: '🐌' },
  other: { label: '其他原因', icon: '💬' },
};

export const ENERGY_LABELS: Record<Task['energyLevel'], { label: string; color: string }> = {
  low: { label: '低能量', color: '#22c55e' },
  medium: { label: '中等', color: '#f59e0b' },
  high: { label: '高能量', color: '#ef4444' },
};

export const PRIORITY_LABELS: Record<string, string> = {
  '1': '最低',
  '2': '较低',
  '3': '普通',
  '4': '较高',
  '5': '最高',
  low: '低',
  medium: '中',
  high: '高',
};

export const FEELING_LABELS: Record<NonNullable<Task['feelingTag']>, { label: string; icon: string }> = {
  smooth: { label: '顺畅', icon: '😊' },
  challenging: { label: '有难度', icon: '😤' },
  struggling: { label: '很挣扎', icon: '😰' },
};

export const ADJUSTMENT_TAG_LABELS: Record<Reflection['q3AdjustmentTag'], string> = {
  more_time: '增加时间',
  fewer_tasks: '减少任务',
  reorder: '调整顺序',
  no_change: '不需要调整',
};

export function getECSLevel(score: number): { label: string; color: string } {
  if (score >= 80) return { label: '优秀', color: '#10b981' };
  if (score >= 60) return { label: '良好', color: '#3b82f6' };
  if (score >= 40) return { label: '待改善', color: '#f59e0b' };
  return { label: '警示', color: '#ef4444' };
}
