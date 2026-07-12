// 生命之树数据类型定义
// 
// 树的语义结构：
// - 土壤：价值观/优先级/约束（来自智忆与设置）
// - 根系：能力 Capability（由智忆证据支撑）
// - 树干：人生主题/北极星 LifeTheme
// - 主枝：人生领域 LifeWheelDimension
// - 叶：今日任务 TaskLeaf（智引执行层）
// - 花：进行中目标 GoalFlower（智引规划层）
// - 果：已完成目标（成果沉淀回智忆，增强能力根系）

// ============ 能力（根系）============
// 能力节点 - 由记忆证据支撑，与目标关联
export interface CapabilityNode {
  id: string;
  name: string;
  category: 'self_awareness' | 'growth_journey' | 'goal_related' | 'relationship';
  proficiencyLevel: number; // 0-1 熟练度/置信度
  evidenceCount: number; // 证据数量
  // 证据链：来自哪些记忆
  evidenceMemoryIds?: string[];
  // 关联的目标ID（需要/强化此能力的目标）
  relatedGoalIds?: string[];
  // 最近更新时间
  updatedAt?: string;
}

// 兼容旧代码的别名
export type SkillNode = CapabilityNode;

// 记忆证据（用于展示能力的来源）
export interface MemoryEvidence {
  id: string;
  type: 'important_info' | 'personal_trait' | 'key_event' | 'date_reminder';
  contentRaw: string;
  createdAt: string;
}

// ============ 人生主题（树干）============
// 北极星 - 人生的核心方向与取舍
export interface LifeTheme {
  id: string;
  title: string; // 如"成为能长期创作的人"
  description?: string;
  // 核心价值观/优先级
  coreValues?: string[];
  // 与之相关的能力
  relatedCapabilityIds?: string[];
  // 状态
  status: 'active' | 'reflecting' | 'archived';
  createdAt: string;
  updatedAt?: string;
}

// ============ 任务（叶）============
export interface TaskLeaf {
  id: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed' | 'skipped';
  scheduledDate: string;
  energyLevel: 'low' | 'medium' | 'high';
  // 关联的目标
  goalId?: string;
  // 训练/应用的能力
  relatedCapabilityIds?: string[];
}

// ============ 目标（花/果）============
export interface GoalFlower {
  id: string;
  title: string;
  status: 'draft' | 'active' | 'paused' | 'completed' | 'cancelled';
  progress: number; // 0-100
  lifeWheelDimension: LifeWheelDimension;
  tasks: TaskLeaf[];
  // 需要的能力（能力差距分析用）
  requiredCapabilityIds?: string[];
  // 会强化的能力
  strengthenCapabilityIds?: string[];
  // 关联的人生主题
  lifeThemeId?: string;
}

// ============ 人生领域（主枝）============
export type LifeWheelDimension = 
  | 'health' 
  | 'career' 
  | 'family' 
  | 'finance' 
  | 'growth' 
  | 'social' 
  | 'hobby' 
  | 'self_realization';

export interface LifeWheelWeights {
  health: number;
  career: number;
  family: number;
  finance: number;
  growth: number;
  social: number;
  hobby: number;
  self_realization: number;
}

// ============ 生命之树完整数据 ============
export interface LifeTreeData {
  // 人生主题（树干）- 北极星
  lifeTheme?: LifeTheme;
  // 能力（根系）- 由智忆证据支撑
  skills: CapabilityNode[]; // 保持字段名兼容，语义为"能力"
  // 目标（花/果）- 智引规划层
  goals: GoalFlower[];
  // 今日任务（叶）- 智引执行层
  todayTasks: TaskLeaf[];
  // 人生领域权重
  lifeWheel: LifeWheelWeights;
}

// ============ 配色与标签 ============

// 生命之花维度配色
export const DIMENSION_COLORS: Record<LifeWheelDimension, string> = {
  health: '#10b981',      // emerald
  career: '#3b82f6',      // blue
  family: '#f59e0b',      // amber
  finance: '#8b5cf6',     // violet
  growth: '#06b6d4',      // cyan
  social: '#ec4899',      // pink
  hobby: '#f97316',       // orange
  self_realization: '#6366f1', // indigo
};

// 能力分类配色
export const CATEGORY_COLORS: Record<CapabilityNode['category'], string> = {
  self_awareness: '#06b6d4',   // cyan - 自我认知
  growth_journey: '#10b981',   // emerald - 成长历程
  goal_related: '#8b5cf6',     // violet - 目标关联
  relationship: '#ec4899',     // pink - 人际管理
};

// 中文标签 - 人生领域
export const DIMENSION_LABELS: Record<LifeWheelDimension, string> = {
  health: '健康',
  career: '事业',
  family: '家庭',
  finance: '财务',
  growth: '成长',
  social: '社交',
  hobby: '兴趣',
  self_realization: '自我实现',
};

// 中文标签 - 能力分类
export const CATEGORY_LABELS: Record<CapabilityNode['category'], string> = {
  self_awareness: '自我认知',
  growth_journey: '成长历程',
  goal_related: '目标关联',
  relationship: '人际管理',
};
