// 个人画像系统类型定义
// 通过智伴对话自动提取，存入记忆系统

// 画像信息分类
export type ProfileCategory =
  | 'life_planning'      // 人生规划：长期愿景、北极星目标
  | 'self_assessment'    // 自我规划：能力评估、发展方向
  | 'psychological'      // 心理测评：性格、压力源、动力来源
  | 'personality'        // 人格分析：MBTI、价值观、决策风格
  | 'growth_experience'  // 成长经历：关键事件、转折点、教训
  | 'pending_task'       // 近期/代办事项：从对话中提取的任务
  | 'daily_routine'      // 日常习惯：作息、工作节奏、偏好
  | 'relationship';      // 人际关系：重要的人、社交模式

// 单条画像信息
export interface ProfileEntry {
  id: string;
  category: ProfileCategory;
  content: string;
  confidence: number; // 0-1 AI 提取置信度
  source: 'chat_extract' | 'user_input' | 'review_insight';
  relatedMessageId?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

// 从对话中提取的待办
export interface ExtractedTask {
  id: string;
  title: string;
  description?: string;
  urgency: 'high' | 'medium' | 'low';
  dueDate?: string;
  sourceMessageId: string;
  confirmed: boolean;
  createdAt: string;
}

// 用户完整画像
export interface UserProfile {
  // 基本信息
  nickname?: string;
  occupation?: string;
  age_range?: string;

  // 人生规划
  lifeVision?: string;
  coreValues: string[];
  longTermGoals: string[];

  // 心理画像
  personalityType?: string; // MBTI etc.
  stressors: string[];
  motivators: string[];
  decisionStyle?: 'analytical' | 'intuitive' | 'deliberate' | 'spontaneous';

  // 能力画像
  strengths: string[];
  weaknesses: string[];
  skillsToDevelop: string[];

  // 行为模式
  peakHours: string[]; // 高效时段
  energyPattern?: 'morning' | 'afternoon' | 'evening' | 'night';
  commonObstacles: string[];

  // 成长轨迹
  keyExperiences: ProfileEntry[];
  turningPoints: ProfileEntry[];

  // 待办事项
  pendingTasks: ExtractedTask[];

  // 画像完整度
  completeness: number; // 0-100
  lastUpdated: string;
}

// 对话提取结果
export interface ChatExtraction {
  profileEntries: ProfileEntry[];
  extractedTasks: ExtractedTask[];
  suggestedActions: Array<{
    type: 'create_goal' | 'add_task' | 'save_memory' | 'update_profile';
    description: string;
    data: Record<string, unknown>;
  }>;
}

// 画像分类标签
export const PROFILE_CATEGORY_LABELS: Record<ProfileCategory, { label: string; icon: string; color: string }> = {
  life_planning: { label: '人生规划', icon: '🌟', color: '#8b5cf6' },
  self_assessment: { label: '自我评估', icon: '🎯', color: '#3b82f6' },
  psychological: { label: '心理画像', icon: '🧠', color: '#ec4899' },
  personality: { label: '人格分析', icon: '💡', color: '#f59e0b' },
  growth_experience: { label: '成长经历', icon: '📖', color: '#10b981' },
  pending_task: { label: '待办事项', icon: '📋', color: '#06b6d4' },
  daily_routine: { label: '日常习惯', icon: '⏰', color: '#f97316' },
  relationship: { label: '人际关系', icon: '🤝', color: '#6366f1' },
};

// Mock 画像提取函数：模拟 AI 从对话中提取画像信息
export function extractProfileFromMessage(message: string): ChatExtraction {
  const entries: ProfileEntry[] = [];
  const tasks: ExtractedTask[] = [];
  const actions: ChatExtraction['suggestedActions'] = [];
  const now = new Date().toISOString();
  const msgId = `msg-${Date.now()}`;

  const lower = message.toLowerCase();

  // 人生规划
  if (/想成为|梦想|未来.*想|人生.*目标|长期/.test(message)) {
    entries.push({
      id: `pe-${Date.now()}-1`,
      category: 'life_planning',
      content: message,
      confidence: 0.8,
      source: 'chat_extract',
      relatedMessageId: msgId,
      tags: ['愿景', '规划'],
      createdAt: now,
      updatedAt: now,
    });
  }

  // 心理/情绪
  if (/压力|焦虑|害怕|担心|开心|自信|动力|迷茫/.test(message)) {
    entries.push({
      id: `pe-${Date.now()}-2`,
      category: 'psychological',
      content: message,
      confidence: 0.7,
      source: 'chat_extract',
      relatedMessageId: msgId,
      tags: ['情绪', '心理'],
      createdAt: now,
      updatedAt: now,
    });
  }

  // 人格/性格
  if (/MBTI|性格|内向|外向|喜欢.*方式|习惯.*做/.test(message)) {
    entries.push({
      id: `pe-${Date.now()}-3`,
      category: 'personality',
      content: message,
      confidence: 0.75,
      source: 'chat_extract',
      relatedMessageId: msgId,
      tags: ['性格', '偏好'],
      createdAt: now,
      updatedAt: now,
    });
  }

  // 成长经历
  if (/之前.*做过|经历|曾经|毕业|工作.*年|学过|做过/.test(message)) {
    entries.push({
      id: `pe-${Date.now()}-4`,
      category: 'growth_experience',
      content: message,
      confidence: 0.85,
      source: 'chat_extract',
      relatedMessageId: msgId,
      tags: ['经历', '背景'],
      createdAt: now,
      updatedAt: now,
    });
  }

  // 能力/技能
  if (/擅长|会.*技术|能力|优势|弱点|不擅长/.test(message)) {
    entries.push({
      id: `pe-${Date.now()}-5`,
      category: 'self_assessment',
      content: message,
      confidence: 0.8,
      source: 'chat_extract',
      relatedMessageId: msgId,
      tags: ['能力', '评估'],
      createdAt: now,
      updatedAt: now,
    });
  }

  // 待办事项提取
  if (/要.*做|需要.*完成|明天.*得|下周.*要|记得.*|别忘了|待办|安排/.test(message)) {
    const title = message.replace(/^(我|要|需要|记得|别忘了)\s*/g, '').slice(0, 50);
    tasks.push({
      id: `et-${Date.now()}`,
      title,
      urgency: /紧急|今天|马上|立刻/.test(message) ? 'high' : /明天|这周/.test(message) ? 'medium' : 'low',
      dueDate: /今天/.test(message) ? new Date().toISOString().split('T')[0] :
               /明天/.test(message) ? new Date(Date.now() + 86400000).toISOString().split('T')[0] : undefined,
      sourceMessageId: msgId,
      confirmed: false,
      createdAt: now,
    });
    actions.push({
      type: 'add_task',
      description: `检测到待办事项：${title}`,
      data: { title, urgency: tasks[tasks.length - 1].urgency },
    });
  }

  // 目标相关
  if (/想要|打算|计划.*个月|目标是/.test(message)) {
    actions.push({
      type: 'create_goal',
      description: '检测到目标描述，建议创建 WOOP 目标',
      data: { prompt: message },
    });
  }

  return { profileEntries: entries, extractedTasks: tasks, suggestedActions: actions };
}
