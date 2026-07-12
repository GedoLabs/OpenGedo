/**
 * Avatar Agent Service
 * 
 * Manages the digital avatar's personality, state, and proactive behaviors:
 * - Personality system with configurable traits
 * - Mood tracking based on user interactions
 * - Proactive care (reminders, encouragement)
 * - Experience/level progression
 */

/**
 * Avatar personality profiles
 */
export const PERSONALITY_PROFILES = {
  friendly: {
    name: '友善温暖',
    traits: ['亲切', '温暖', '鼓励', '理解'],
    style: '像最好的朋友一样，温暖真诚',
    emoji_usage: 'moderate',
    tone: 'warm_supportive',
  },
  professional: {
    name: '专业高效',
    traits: ['精准', '高效', '务实', '有条理'],
    style: '像专业顾问一样，精准高效',
    emoji_usage: 'minimal',
    tone: 'clear_concise',
  },
  motivational: {
    name: '激励型',
    traits: ['热情', '积极', '挑战', '鞭策'],
    style: '像教练一样，激发潜能',
    emoji_usage: 'frequent',
    tone: 'energetic_pushing',
  },
  gentle: {
    name: '温柔型',
    traits: ['细腻', '耐心', '包容', '治愈'],
    style: '像知心姐姐一样，温柔细腻',
    emoji_usage: 'moderate',
    tone: 'gentle_patient',
  },
};

/**
 * Get personality-enhanced system prompt
 */
export function getPersonalityPrompt(personalityKey = 'friendly') {
  const profile = PERSONALITY_PROFILES[personalityKey] || PERSONALITY_PROFILES.friendly;

  return `## 你的性格特征
名称：${profile.name}
特质：${profile.traits.join('、')}
风格：${profile.style}
语气：${profile.tone === 'warm_supportive' ? '温暖支持' : 
       profile.tone === 'clear_concise' ? '简洁明确' :
       profile.tone === 'energetic_pushing' ? '充满能量' : '温柔耐心'}

## 表达规范
- 表情符号使用：${profile.emoji_usage === 'moderate' ? '适度使用' : 
  profile.emoji_usage === 'minimal' ? '少量使用' : '频繁使用'}
- 回复长度：通常 2-5 句话，除非用户需要详细解答
- 避免说教式口吻，保持对等交流
- 记住用户之前提到的事情，体现"懂你"`;
}

/**
 * Calculate avatar mood based on context
 */
export function calculateMood(context = {}) {
  const { todayCompleted = 0, todayTotal = 0, streakDays = 0, lastMood = 'neutral' } = context;

  if (todayTotal === 0) return 'neutral';

  const completionRate = todayCompleted / todayTotal;

  if (completionRate >= 1) return 'excited';
  if (completionRate >= 0.7) return 'happy';
  if (completionRate >= 0.3) return 'encouraging';
  if (streakDays > 0 && completionRate < 0.2) return 'concerned';

  return 'neutral';
}

/**
 * Calculate experience gained from an action
 */
export function calculateExperience(action) {
  const XP_TABLE = {
    chat_message: 1,
    memory_capture: 5,
    goal_created: 10,
    task_completed: 8,
    daily_login: 3,
    streak_bonus: 2,   // per streak day
  };

  return XP_TABLE[action] || 0;
}

/**
 * Calculate level from total experience
 */
export function calculateLevel(totalXP) {
  // Each level requires progressively more XP
  // Level 1: 0, Level 2: 100, Level 3: 250, Level 4: 500...
  const thresholds = [0, 100, 250, 500, 1000, 2000, 4000, 8000, 16000, 32000];
  let level = 1;
  for (let i = 0; i < thresholds.length; i++) {
    if (totalXP >= thresholds[i]) {
      level = i + 1;
    } else {
      break;
    }
  }
  return {
    level,
    currentXP: totalXP - (thresholds[level - 1] || 0),
    nextLevelXP: (thresholds[level] || thresholds[thresholds.length - 1] * 2) - (thresholds[level - 1] || 0),
  };
}

/**
 * Generate proactive care messages based on user state
 */
export function generateProactiveCare(context = {}) {
  const { todayCompleted = 0, todayTotal = 0, streakDays = 0, lastActiveHours = 0 } = context;
  const hour = new Date().getHours();
  const messages = [];

  // Morning greeting
  if (hour >= 7 && hour <= 9) {
    messages.push({
      type: 'greeting',
      priority: 'low',
      content: `早上好！新的一天开始了${todayTotal > 0 ? `，今天有 ${todayTotal} 个任务等你完成` : ''}。`,
    });
  }

  // Task reminder (afternoon)
  if (hour >= 14 && hour <= 16 && todayTotal > 0 && todayCompleted < todayTotal) {
    const remaining = todayTotal - todayCompleted;
    messages.push({
      type: 'task_reminder',
      priority: 'medium',
      content: `下午好，还有 ${remaining} 个任务待完成。要不要现在处理一下？`,
    });
  }

  // Streak encouragement
  if (streakDays > 0 && streakDays % 7 === 0) {
    messages.push({
      type: 'streak_celebration',
      priority: 'medium',
      content: `恭喜！你已经连续打卡 ${streakDays} 天了！保持这个节奏！`,
    });
  }

  // Inactive user
  if (lastActiveHours > 48) {
    messages.push({
      type: 're_engagement',
      priority: 'high',
      content: '好久不见！想念你了。有什么我能帮你的吗？',
    });
  }

  // Evening wrap-up
  if (hour >= 20 && hour <= 22 && todayTotal > 0) {
    if (todayCompleted >= todayTotal) {
      messages.push({
        type: 'daily_complete',
        priority: 'low',
        content: '今天的任务全部完成了！辛苦了，好好休息。',
      });
    } else {
      messages.push({
        type: 'evening_reminder',
        priority: 'low',
        content: `今天完成了 ${todayCompleted}/${todayTotal} 个任务。没关系，明天继续加油！`,
      });
    }
  }

  return messages;
}

// ── P3-C: Persona mode switching ──────────────────────────────────────────────

/**
 * Valid persona modes (P3-C §5.4).
 * AS and ABOUT default to OFF — user must explicitly enable them.
 */
export const PERSONA_MODE_LABELS = {
  FOR:   '助手模式',    // Default: AI acts *for* the user
  AS:    '分身模式',    // AI writes *as* the user (opt-in)
  ABOUT: '介绍模式',    // AI describes the user to a third party (opt-in)
};

/**
 * Whether a mode requires explicit opt-in (privacy/legal constraint).
 * AS mode must embed a legal footer in all outputs.
 * ABOUT mode must suppress L4 episode memories.
 */
export const PERSONA_MODE_OPTIN = { FOR: false, AS: true, ABOUT: true };

/**
 * Returns the active persona mode from context, defaulting to FOR.
 * Validates that opt-in modes can only be used if the flag is enabled.
 *
 * @param {string} [requestedMode]
 * @returns {'FOR'|'AS'|'ABOUT'}
 */
export function resolvePersonaMode(requestedMode) {
  const mode = (requestedMode || 'FOR').toUpperCase();
  if (!PERSONA_MODE_LABELS[mode]) return 'FOR';
  if (PERSONA_MODE_OPTIN[mode] && process.env.FEATURE_PERSONA_AS_MODE !== 'true') return 'FOR';
  return mode;
}

export default {
  PERSONALITY_PROFILES,
  getPersonalityPrompt,
  calculateMood,
  calculateExperience,
  calculateLevel,
  generateProactiveCare,
  PERSONA_MODE_LABELS,
  PERSONA_MODE_OPTIN,
  resolvePersonaMode,
};
