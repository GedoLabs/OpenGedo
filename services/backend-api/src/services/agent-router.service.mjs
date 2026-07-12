/**
 * Agent Router Service
 * 
 * Intelligent intent detection and agent dispatch:
 * - Detects user intent from natural language
 * - Routes to appropriate agent/service
 * - Manages agent orchestration
 */

/**
 * Intent types that the router can detect
 */
export const INTENTS = {
  MEMORY_CAPTURE: 'memory_capture',      // User wants to record something
  MEMORY_RECALL: 'memory_recall',        // User wants to find/remember something
  GOAL_PLANNING: 'goal_planning',        // User wants to set/plan a goal
  TASK_MANAGEMENT: 'task_management',    // User wants to manage tasks
  TASK_CHECKIN: 'task_checkin',          // User wants to mark task as done
  PROGRESS_CHECK: 'progress_check',      // User asks about progress
  EMOTIONAL_SUPPORT: 'emotional_support', // User needs emotional support
  GENERAL_CHAT: 'general_chat',          // General conversation
};

/**
 * Detect intent from user message using keyword matching
 * (Fast, rule-based detection - used before LLM for quick routing)
 */
export function detectIntent(message) {
  const lower = message.toLowerCase();

  // Memory capture patterns
  const capturePatterns = ['记住', '记录', '记下', '学会', '学到', '保存', '存下', '我今天', '我刚才', '告诉你'];
  if (capturePatterns.some(p => lower.includes(p))) {
    return { intent: INTENTS.MEMORY_CAPTURE, confidence: 0.8 };
  }

  // Memory recall patterns
  const recallPatterns = ['还记得', '之前', '上次', '回忆', '找找', '搜索', '有没有', '我说过'];
  if (recallPatterns.some(p => lower.includes(p))) {
    return { intent: INTENTS.MEMORY_RECALL, confidence: 0.8 };
  }

  // Goal planning patterns
  const goalPatterns = ['目标', '计划', '想要', '打算', '准备', '规划', '达到', '实现', '成为'];
  if (goalPatterns.some(p => lower.includes(p))) {
    return { intent: INTENTS.GOAL_PLANNING, confidence: 0.7 };
  }

  // Task check-in patterns
  const checkinPatterns = ['完成', '做完', '搞定', '打卡', '做了', '弄好'];
  if (checkinPatterns.some(p => lower.includes(p))) {
    return { intent: INTENTS.TASK_CHECKIN, confidence: 0.8 };
  }

  // Task management patterns
  const taskPatterns = ['任务', '安排', '今天做', '待办', '代办', '清单'];
  if (taskPatterns.some(p => lower.includes(p))) {
    return { intent: INTENTS.TASK_MANAGEMENT, confidence: 0.7 };
  }

  // Progress check patterns
  const progressPatterns = ['进度', '怎么样', '情况', '统计', '数据', '完成率'];
  if (progressPatterns.some(p => lower.includes(p))) {
    return { intent: INTENTS.PROGRESS_CHECK, confidence: 0.7 };
  }

  // Emotional support patterns
  const emotionPatterns = ['累', '烦', '压力', '焦虑', '迷茫', '难过', '开心', '高兴', '感觉'];
  if (emotionPatterns.some(p => lower.includes(p))) {
    return { intent: INTENTS.EMOTIONAL_SUPPORT, confidence: 0.6 };
  }

  return { intent: INTENTS.GENERAL_CHAT, confidence: 0.5 };
}

/**
 * Get enhanced system prompt based on detected intent
 */
export function getIntentEnhancement(intent) {
  switch (intent) {
    case INTENTS.MEMORY_CAPTURE:
      return '\n\n[当前意图：记忆捕获] 用户想要记录信息。请使用 capture_memory 工具帮助保存，并确认已记录。';

    case INTENTS.MEMORY_RECALL:
      return '\n\n[当前意图：记忆搜索] 用户想要回忆或查找信息。请使用 search_memory 工具搜索，并整理结果展示。';

    case INTENTS.GOAL_PLANNING:
      return '\n\n[当前意图：目标规划] 用户想要设定目标。请帮助明确目标，必要时使用 create_goal 工具创建。引导用户思考 SMART 原则。';

    case INTENTS.TASK_CHECKIN:
      return '\n\n[当前意图：任务打卡] 用户完成了某个任务。请使用 list_today_tasks 查看任务列表，然后用 complete_task 标记完成，给予鼓励。';

    case INTENTS.TASK_MANAGEMENT:
      return '\n\n[当前意图：任务管理] 用户想查看或管理任务。请使用 list_today_tasks 获取任务列表并展示。';

    case INTENTS.PROGRESS_CHECK:
      return '\n\n[当前意图：进度查看] 用户想了解进度。请使用 list_today_tasks 和 list_goals 获取数据并生成进度报告。';

    case INTENTS.EMOTIONAL_SUPPORT:
      return '\n\n[当前意图：情感支持] 用户需要情感关怀。请以温暖、理解的态度回应，不要急于给建议，先共情。';

    default:
      return '';
  }
}

/**
 * Route a message and return enhanced context
 */
export function routeMessage(message) {
  const { intent, confidence } = detectIntent(message);
  const enhancement = getIntentEnhancement(intent);

  return {
    intent,
    confidence,
    enhancement,
    requiresTools: [
      INTENTS.MEMORY_CAPTURE,
      INTENTS.MEMORY_RECALL,
      INTENTS.GOAL_PLANNING,
      INTENTS.TASK_CHECKIN,
      INTENTS.TASK_MANAGEMENT,
      INTENTS.PROGRESS_CHECK,
    ].includes(intent),
  };
}

export default {
  INTENTS,
  detectIntent,
  getIntentEnhancement,
  routeMessage,
};
