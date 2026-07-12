// 智忆数据类型（记忆 → 能力证据链）

export type MemoryType = 'important_info' | 'personal_trait' | 'key_event' | 'date_reminder' | 'task_item';
export type MemorySource = 'text' | 'voice' | 'image' | 'passive_event' | 'chat_extract';
export type SystemTag = 'self_awareness' | 'growth_journey' | 'goal_related' | 'relationship';
export type VerificationStatus = 'unverified' | 'confirmed' | 'denied';

// AI 提取的结构化结果
export interface AIExtraction {
  summary: string;
  category: 'personal_trait' | 'life_goal' | 'task' | 'emotion' | 'experience' | 'preference' | 'skill';
  keyEntities: string[];
  sentiment?: 'positive' | 'neutral' | 'negative';
  confidence: number; // 0-1
  needsClarification: boolean;
  clarificationQuestion?: string;
  relatedProfileField?: string;
  taskExtracted?: {
    title: string;
    urgency: 'high' | 'medium' | 'low';
    dueDate?: string;
  };
}

export interface Memory {
  id: string;
  type: MemoryType;
  contentRaw: string;
  contentStruct?: {
    people?: string[];
    dates?: string[];
    skills?: string[];
    emotions?: string[];
    conclusions?: string[];
  };
  source: MemorySource;
  attachmentUrl?: string;
  systemTags: SystemTag[];
  userTags: string[];
  confidence: number;
  impactScore: number;
  usageCount: number;
  confirmed: boolean;
  reminderDate?: string;
  createdAt: string;
  updatedAt: string;
  // AI 提取增强
  aiExtraction?: AIExtraction;
  verificationStatus: VerificationStatus;
}

export interface MemoryInput {
  type: MemoryType;
  contentRaw: string;
  source: MemorySource;
  attachmentUrl?: string;
  userTags?: string[];
  reminderDate?: string;
}

// 类型标签
export const TYPE_LABELS: Record<MemoryType, { label: string; icon: string; color: string }> = {
  important_info: { label: '重要信息', icon: '📋', color: '#3b82f6' },
  personal_trait: { label: '个人特质', icon: '🧠', color: '#8b5cf6' },
  key_event: { label: '关键事件', icon: '⭐', color: '#f59e0b' },
  date_reminder: { label: '日期提醒', icon: '📅', color: '#10b981' },
  task_item: { label: '待办任务', icon: '📌', color: '#f97316' },
};

// 系统标签
export const SYSTEM_TAG_LABELS: Record<SystemTag, { label: string; color: string }> = {
  self_awareness: { label: '自我认知', color: '#06b6d4' },
  growth_journey: { label: '成长历程', color: '#10b981' },
  goal_related: { label: '目标关联', color: '#8b5cf6' },
  relationship: { label: '人际管理', color: '#ec4899' },
};

// AI 提取分类标签
export const EXTRACTION_CATEGORY_LABELS: Record<AIExtraction['category'], { label: string; icon: string; color: string }> = {
  personal_trait: { label: '个人特质', icon: '🧠', color: '#8b5cf6' },
  life_goal: { label: '人生目标', icon: '🌟', color: '#f59e0b' },
  task: { label: '待办事项', icon: '📌', color: '#f97316' },
  emotion: { label: '情绪状态', icon: '💙', color: '#3b82f6' },
  experience: { label: '成长经历', icon: '📖', color: '#10b981' },
  preference: { label: '偏好习惯', icon: '⚙️', color: '#06b6d4' },
  skill: { label: '技能能力', icon: '💪', color: '#ec4899' },
};

export const VERIFICATION_LABELS: Record<VerificationStatus, { label: string; color: string }> = {
  unverified: { label: 'AI 分析', color: '#64748b' },
  confirmed: { label: '已确认', color: '#10b981' },
  denied: { label: '已否定', color: '#ef4444' },
};







