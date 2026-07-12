/**
 * Intent Classifier — Retrieval Gate
 *
 * Classifies each incoming message into one of five intent types
 * to determine the optimal retrieval strategy, avoiding unnecessary
 * deep retrieval on casual messages.
 *
 * Intent types and their retrieval actions:
 *   goal_planning  → Full memory scan: L2 goals + L4 vector query
 *   task_check     → Episodic only: L2 active goals + L4 recent
 *   reflection     → Full scan + L3 summaries + L4 history
 *   emotional      → L1 preferences + L2 emotional history
 *   casual         → Skip deep retrieval — L1 only for persona tone
 */

import { INTENT_TYPES, TSS_WEIGHTS } from './types.mjs';

// ── Keyword patterns for rule-based classification ────────────────

const INTENT_PATTERNS = {
  goal_planning: {
    keywords: [
      '计划', '目标', '想要', '打算', '准备', '规划', '实现',
      '怎么做', '如何', '方案', '策略', '步骤', '行动',
      'plan', 'goal', 'want to', 'how to', 'strategy', 'launch',
      '帮我', '制定', '开始', '挑战',
    ],
    weight: 1.0,
  },
  task_check: {
    keywords: [
      '完成了', '进展', '进度', '做完', '还差', '剩余',
      '上次', '做到哪', '检查', '跟进', '状态',
      'done', 'finish', 'progress', 'status', 'check', 'left',
      '有没有', '是不是', '什么时候',
    ],
    weight: 1.0,
  },
  reflection: {
    keywords: [
      '回顾', '复盘', '反思', '成长', '学到', '经验', '教训',
      '变化', '改变', '总结', '这段时间', '最近',
      'reflect', 'review', 'learn', 'grow', 'change', 'journey',
      '过去', '之前', '曾经', '回想',
    ],
    weight: 1.0,
  },
  emotional: {
    keywords: [
      '焦虑', '压力', '开心', '难过', '烦', '累', '担心',
      '害怕', '兴奋', '沮丧', '迷茫', '感觉', '心情',
      'anxious', 'stressed', 'happy', 'sad', 'feel', 'burn',
      '情绪', '不安', '放松', '疲惫', '失落',
    ],
    weight: 1.0,
  },
  casual: {
    keywords: [
      '你好', '嗨', '在吗', '聊天', '天气', '吃什么',
      'hi', 'hello', 'hey', 'what\'s up',
      '哈哈', '谢谢', '好的', '知道了', '没事',
    ],
    weight: 0.8,
  },
};

// ── Retrieval config per intent ───────────────────────────────────

const RETRIEVAL_CONFIG = {
  goal_planning: {
    use_l1: true,
    use_l2: true,
    use_l3: true,
    use_l4_vector: true,
    l4_top_k: 5,
    cone_search: true,
  },
  task_check: {
    use_l1: false,
    use_l2: true,
    use_l3: false,
    use_l4_vector: true,
    l4_top_k: 3,
    cone_search: false,
  },
  reflection: {
    use_l1: true,
    use_l2: true,
    use_l3: true,
    use_l4_vector: true,
    l4_top_k: 5,
    cone_search: false,
  },
  emotional: {
    use_l1: true,
    use_l2: true,
    use_l3: false,
    use_l4_vector: false,
    l4_top_k: 0,
    cone_search: false,
  },
  casual: {
    use_l1: true,
    use_l2: false,
    use_l3: false,
    use_l4_vector: false,
    l4_top_k: 0,
    cone_search: false,
  },
};

// ══════════════════════════════════════════════════════════════════
//  Rule-based classifier (lightweight, no LLM call)
// ══════════════════════════════════════════════════════════════════

/**
 * Classify message intent using keyword matching.
 *
 * @param {string} message - User message text
 * @param {object} [context] - Optional context (active goals, recent topic)
 * @returns {{ intent: string, confidence: number, retrievalConfig: object, tssWeights: object }}
 */
export function classifyIntent(message, context = {}) {
  if (!message || typeof message !== 'string') {
    return makeResult('casual', 0.5);
  }

  const text = message.toLowerCase();
  const scores = {};

  for (const [intent, config] of Object.entries(INTENT_PATTERNS)) {
    let score = 0;
    let matches = 0;
    for (const kw of config.keywords) {
      if (text.includes(kw)) {
        score += config.weight;
        matches++;
      }
    }
    scores[intent] = { score, matches };
  }

  // Context boosting: if user has active goals, boost goal/task intents
  if (context.activeGoals?.length > 0) {
    const goalTitles = context.activeGoals.map(g => g.title?.toLowerCase() || '');
    for (const title of goalTitles) {
      if (title && text.includes(title.slice(0, 6))) {
        scores.goal_planning.score += 0.5;
        scores.task_check.score += 0.3;
      }
    }
  }

  // Question pattern boost
  if (text.includes('?') || text.includes('？') || text.endsWith('吗') || text.endsWith('呢')) {
    scores.task_check.score += 0.2;
  }

  // Long message boost for reflection
  if (text.length > 100) {
    scores.reflection.score += 0.3;
  }

  // Find highest scoring intent
  let bestIntent = 'casual';
  let bestScore = 0;
  for (const [intent, { score }] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestIntent = intent;
    }
  }

  // If no clear signal, default to casual
  const confidence = bestScore > 0 ? Math.min(bestScore / 3, 1.0) : 0.3;

  // For ambiguous cases (close scores), prefer more retrieval-heavy intent
  if (bestScore > 0 && bestScore < 1.0) {
    const sorted = Object.entries(scores)
      .filter(([, { score }]) => score > 0)
      .sort(([, a], [, b]) => b.score - a.score);

    if (sorted.length >= 2) {
      const [, secondBest] = sorted[1];
      if (bestScore - secondBest.score < 0.3) {
        const retrievalPriority = ['reflection', 'goal_planning', 'task_check', 'emotional', 'casual'];
        const current = retrievalPriority.indexOf(bestIntent);
        const alternative = retrievalPriority.indexOf(sorted[1][0]);
        if (alternative < current) {
          bestIntent = sorted[1][0];
        }
      }
    }
  }

  return makeResult(bestIntent, confidence);
}

function makeResult(intent, confidence) {
  return {
    intent,
    confidence,
    retrievalConfig: RETRIEVAL_CONFIG[intent] || RETRIEVAL_CONFIG.casual,
    tssWeights: TSS_WEIGHTS[intent] || TSS_WEIGHTS.default,
  };
}

/**
 * Get the retrieval configuration for a given intent type.
 */
export function getRetrievalConfig(intentType) {
  return RETRIEVAL_CONFIG[intentType] || RETRIEVAL_CONFIG.casual;
}

export default {
  classifyIntent,
  getRetrievalConfig,
  INTENT_PATTERNS,
  RETRIEVAL_CONFIG,
};
