// 目标建构 (Goal Architect) 数据类型
// M1 模块：WOOP + OKR 四层结构

import { LifeWheelDimension } from '../life-tree/types';

// OKR 四层层级
export type GoalLevel = 'objective' | 'key_result' | 'monthly' | 'task';

export type GoalStatus = 'draft' | 'active' | 'paused' | 'completed' | 'cancelled';

export interface Goal {
  id: string;
  title: string;
  description?: string;

  // SMART 字段
  specific?: string;
  measurable?: string;
  achievable?: string;
  relevant?: string;
  timeBound?: string;

  // WOOP 四要素
  wish?: string;
  outcome?: string;
  obstacle?: string;
  plan?: string;

  // OKR 层级
  level: GoalLevel;
  parentId?: string;
  children?: Goal[];
  lifeWheelDimension: LifeWheelDimension;
  status: GoalStatus;
  progress: number;

  /** Server-computed: has child goals or any attached ToDos (GET /v1/goals). */
  decomposed?: boolean;

  // 障碍命中率 (M2 关联)
  obstacleHitRate?: number;

  startDate?: string;
  endDate?: string;

  createdAt: string;
  updatedAt: string;
}

// 目标建构：AI 诊断问题
export interface DiagnosisQuestion {
  id: string;
  question: string;
  hint?: string;
  options?: { id: string; label: string }[];
  type: 'text' | 'select' | 'multi-select';
  required: boolean;
  field: 'quantifiable' | 'timeline' | 'resources' | 'outcome' | 'obstacle';
}

// 目标建构会话
export interface GoalBuildSession {
  goalPrompt: string;
  step: 'input' | 'diagnosis' | 'woop' | 'structure' | 'obstacle_plan';
  diagnosisAnswers: Record<string, string>;
  woopData: {
    wish: string;
    outcome: string;
    obstacle: string;
    plan: string;
  };
  generatedOKR?: OKRStructure;
  generatedIfThenCards?: Array<{
    obstacleDescription: string;
    ifCondition: string;
    thenAction: string;
  }>;
}

// OKR 四层生成结构
export interface OKRStructure {
  objective: {
    title: string;
    description: string;
    timeframe: string;
  };
  keyResults: Array<{
    id: string;
    title: string;
    description: string;
    timeframe: string;
  }>;
  monthlyGoals: Array<{
    id: string;
    keyResultId: string;
    title: string;
    description: string;
  }>;
  tasks: Array<{
    id: string;
    monthlyGoalId: string;
    title: string;
    scheduledDate?: string;
    estimatedDuration?: number;
  }>;
}

export interface ClarifyQuestion {
  id: string;
  question: string;
  options?: { id: string; label: string }[];
  type: 'text' | 'select' | 'multi-select' | 'number' | 'date';
  field: string;
}

export interface ClarifySession {
  goalPrompt: string;
  questions: ClarifyQuestion[];
  answers: Record<string, string | string[]>;
  currentStep: number;
  relatedMemories?: Array<{
    id: string;
    content: string;
    relevance: string;
  }>;
}

export interface PlanNode {
  id: string;
  goalId: string;
  title: string;
  description?: string;
  granularity: 'year' | 'quarter' | 'month' | 'week' | 'day';
  parentId?: string;
  sortOrder: number;
  status: 'pending' | 'in_progress' | 'completed' | 'skipped';
  startDate?: string;
  endDate?: string;
}

export interface Task {
  id: string;
  goalId?: string;
  planNodeId?: string;
  title: string;
  description?: string;
  estimatedDuration?: number;
  energyLevel: 'low' | 'medium' | 'high';
  priority: 1 | 2 | 3 | 4 | 5;
  status: 'pending' | 'in_progress' | 'completed' | 'skipped' | 'postponed';
  scheduledDate?: string;
  dueDate?: string;
  completedAt?: string;
}

/** Raw ToDo (tasks table) as returned by the API — snake_case; rendered as leaf rows in the goal tree. */
export interface TreeTask {
  id: string;
  title: string;
  status?: string;
  goal_id?: string | null;
  key_result_id?: string | null;
  plan_node_id?: string | null;
  is_mit?: boolean;
  estimated_duration?: number;
}

// OKR 四层 — 颜色为分类语义色（与 GoalList / GoalWizard 一致）
export const LEVEL_COLORS: Record<GoalLevel, string> = {
  objective: '#8b5cf6',
  key_result: '#3b82f6',
  monthly: '#06b6d4',
  task: '#10b981',
};

/** @deprecated UI 文案走 app.planner.levels；仅保留颜色供旧引用 */
export const LEVEL_LABELS: Record<GoalLevel, { label: string; timeframe: string; color: string }> = {
  objective: { label: '', timeframe: '', color: LEVEL_COLORS.objective },
  key_result: { label: '', timeframe: '', color: LEVEL_COLORS.key_result },
  monthly: { label: '', timeframe: '', color: LEVEL_COLORS.monthly },
  task: { label: '', timeframe: '', color: LEVEL_COLORS.task },
};

export { DIMENSION_COLORS } from '../life-tree/types';
