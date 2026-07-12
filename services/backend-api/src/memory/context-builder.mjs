/**
 * PCP Context Builder
 *
 * Assembles a context block from the five-layer memory stack for injection
 * into LLM system prompts. Uses Intent Gate to decide retrieval depth
 * and TSS to rank episodic memories.
 *
 * Per-turn retrieval flow (from PCP Architecture §4.1):
 *   1. User message → intent classification
 *   2. Intent gate → decide retrieval scope
 *   3. PCP cold-load (L1+L2, cached per session)
 *   4. Semantic retrieval (conditional) → L4 vector + TSS
 *   5. Context assembly → base_instructions + PCP_summary + retrieved_chunks
 *   6. Post-response → extract memory deltas
 */

import { TOKEN_BUDGET, LIFE_DIMENSIONS, LOW_CONFIDENCE_THRESHOLD } from './types.mjs';
import { getMemoryStore } from './store/index.mjs';
const { getProfile, getWorkingMemory, searchEpisodes, searchEpisodesByVector, incrementEpisodeUsage, listEpisodes } = getMemoryStore();
import { classifyIntent } from './intent-classifier.mjs';
import { rankByTSS, coneSearch } from './tss.mjs';
import { reciprocalRankFusion } from './retrieval/rrf.mjs';
import { detectEntityMentions, renderEntityContext } from './entity-registry.mjs';
import { Store } from '../lib/store.mjs';

const store = Store();

/** User-toggled kill switch: when on, no stored memory is injected into AI context. */
export function isMemoryPaused(userId) {
  try {
    return store.getSettings(userId)?.privacy_settings?.pause_memory === true;
  } catch {
    return false;
  }
}

const EMPTY_CONTEXT = (paused) => ({
  contextText: '',
  tokensUsed: 0,
  layers: {},
  intent: { type: 'casual', confidence: 0, retrieval: {}, paused },
});

// ── Token estimation ───────────────────────────────────────────────

function estimateTokens(text) {
  if (!text) return 0;
  let count = 0;
  for (const ch of text) {
    count += ch.charCodeAt(0) > 127 ? 1.5 : 0.25;
  }
  return Math.ceil(count);
}

function truncateToTokens(text, maxTokens) {
  if (!text) return '';
  let tokens = 0;
  let i = 0;
  for (; i < text.length; i++) {
    tokens += text.charCodeAt(i) > 127 ? 1.5 : 0.25;
    if (tokens > maxTokens) break;
  }
  return text.slice(0, i);
}

// ══════════════════════════════════════════════════════════════════
//  Layer Renderers
// ══════════════════════════════════════════════════════════════════

function renderCoreIdentity(ci) {
  const parts = [];

  if (ci.name) parts.push(`姓名：${ci.name}`);
  if (ci.profession) parts.push(`职业：${ci.profession}`);

  // Big5 personality
  if (ci.personality?.big5) {
    const b5 = ci.personality.big5;
    const labels = { O: '开放性', C: '尽责性', E: '外向性', A: '宜人性', N: '神经质' };
    const items = Object.entries(b5)
      .filter(([, v]) => v != null)
      .map(([k, v]) => `${labels[k] || k}:${(v * 100).toFixed(0)}%`);
    if (items.length) parts.push(`人格特质(Big5)：${items.join(' ')}`);
  }
  if (ci.personality?.mbti_proxy) parts.push(`MBTI倾向：${ci.personality.mbti_proxy}`);

  // Self-insight report summary (自我认知报告 — written back by the insight engine)
  if (ci.self_insight?.summary) parts.push(`自我认知报告：${ci.self_insight.summary}`);

  // Cognition
  if (ci.cognition?.learning_style || ci.cognition?.reasoning_mode) {
    const cogParts = [];
    const lsLabels = { visual: '视觉型', verbal: '语言型', kinesthetic: '动觉型' };
    const rmLabels = { systematic: '系统思维', intuitive: '直觉思维', mixed: '混合型' };
    if (ci.cognition.learning_style) cogParts.push(`学习风格：${lsLabels[ci.cognition.learning_style] || ci.cognition.learning_style}`);
    if (ci.cognition.reasoning_mode) cogParts.push(`推理模式：${rmLabels[ci.cognition.reasoning_mode] || ci.cognition.reasoning_mode}`);
    if (ci.cognition.decision_speed != null) cogParts.push(`决策速度：${ci.cognition.decision_speed > 0.6 ? '快速' : ci.cognition.decision_speed < 0.4 ? '审慎' : '中等'}`);
    parts.push(cogParts.join('；'));
  }

  // Legacy traits
  if (ci.traits?.length) parts.push(`性格特质：${ci.traits.join('、')}`);

  // Values
  if (ci.values?.top_priorities?.length) {
    parts.push(`核心价值观：${ci.values.top_priorities.join('、')}`);
  }

  // Communication preferences
  if (ci.communication?.preferred_tone) {
    const toneLabels = { direct: '直接', nurturing: '温和', analytical: '分析' };
    let commLine = `沟通偏好：${toneLabels[ci.communication.preferred_tone] || ci.communication.preferred_tone}`;
    if (ci.communication.verbosity != null) {
      commLine += `，详细程度${ci.communication.verbosity > 0.6 ? '偏高' : ci.communication.verbosity < 0.4 ? '偏低' : '适中'}`;
    }
    parts.push(commLine);
  }

  // Expertise
  if (ci.expertise?.domains?.length) {
    const domainStr = ci.expertise.domains
      .sort((a, b) => (b.level || 0) - (a.level || 0))
      .slice(0, 5)
      .map(d => `${d.domain}(${Math.round((d.level || 0) * 100)}%)`)
      .join('、');
    parts.push(`专长领域：${domainStr}`);
  }

  // Relationships
  if (ci.key_relationships?.length) {
    const rels = ci.key_relationships.map(r => `${r.name}(${r.relation})`).join('、');
    parts.push(`重要关系：${rels}`);
  }

  // Legacy preferences fallback
  if (ci.preferences && !ci.communication?.preferred_tone) {
    const prefs = [];
    if (ci.preferences.communication_style) prefs.push(`沟通风格偏好${ci.preferences.communication_style}`);
    if (ci.preferences.motivation_type) prefs.push(`动力来源${ci.preferences.motivation_type}`);
    if (prefs.length) parts.push(prefs.join('；'));
  }

  if (parts.length === 0) return '';
  return `## 用户画像\n${parts.join('\n')}`;
}

function renderWorkingMemory(wm) {
  const parts = [];

  // Active goals
  if (wm.active_goals?.length) {
    const goalLines = wm.active_goals
      .filter(g => g.phase !== 'completed' && g.phase !== 'abandoned')
      .slice(0, 5)
      .map(g => {
        const phaseLabels = {
          planning: '📋规划中', in_progress: '🚀进行中',
          review: '🔍复盘中', paused: '⏸暂停',
        };
        const progress = g.progress != null ? ` ${Math.round(g.progress * 100)}%` : '';
        return `- ${g.title} [${phaseLabels[g.phase] || g.phase}${progress}]`;
      });
    if (goalLines.length) {
      parts.push(`当前目标：\n${goalLines.join('\n')}`);
    }
  }

  // Focus domain
  if (wm.current_context?.focus_domain) {
    parts.push(`当前关注：${wm.current_context.focus_domain}`);
  }

  // Emotional state
  if (wm.current_context?.emotional_state && wm.current_context.emotional_state !== 'neutral') {
    const labels = {
      very_positive: '状态很好', positive: '状态不错',
      slightly_stressed: '略感压力', stressed: '压力较大', anxious: '比较焦虑',
    };
    parts.push(`情绪状态：${labels[wm.current_context.emotional_state] || wm.current_context.emotional_state}`);
  }

  // Pending items
  if (wm.pending_items?.length) {
    parts.push(`待办事项：${wm.pending_items.join('、')}`);
  }

  // Recent decisions
  if (wm.recent_decisions?.length) {
    const recent = wm.recent_decisions.slice(-3);
    const decisionLines = recent.map(d => {
      const date = (d.ts || d.date || '').split('T')[0];
      return `- ${date}：${d.decision}${d.rationale ? ` (${d.rationale})` : ''}`;
    });
    parts.push(`近期决策：\n${decisionLines.join('\n')}`);
  }

  // Conversation continuity
  if (wm.conversation_continuity?.last_topic) {
    parts.push(`上次话题：${wm.conversation_continuity.last_topic}`);
    if (wm.conversation_continuity.unresolved) {
      parts.push(`未解决：${wm.conversation_continuity.unresolved}`);
    }
  }

  if (parts.length === 0) return '';
  return `## 近期状态\n${parts.join('\n')}`;
}

function renderSemanticMemory(sm) {
  const sections = [];

  // Dimensions
  if (sm.dimensions) {
    const dimLines = [];
    for (const dim of LIFE_DIMENSIONS) {
      const d = sm.dimensions[dim];
      if (!d) continue;
      const hasContent = d.summary || d.skills?.length || d.patterns?.length;
      if (!hasContent) continue;

      const label = dimensionLabel(dim);
      let line = `**${label}**：`;
      if (d.summary) line += d.summary;
      if (d.skills?.length) line += `\n  技能：${d.skills.join('、')}`;
      if (d.patterns?.length) line += `\n  行为模式：${d.patterns.join('；')}`;
      if (d.recent_insight) line += `\n  近期洞察：${d.recent_insight}`;
      dimLines.push(line);
    }
    if (dimLines.length) {
      sections.push(`## 用户知识图谱\n${dimLines.join('\n\n')}`);
    }
  }

  // Cross-dimension patterns
  if (sm.cross_dimension_patterns?.length) {
    sections.push(`## 跨维度模式\n${sm.cross_dimension_patterns.map(p => `- ${p}`).join('\n')}`);
  }

  // Milestones
  if (sm.milestone_events?.length) {
    const milestones = sm.milestone_events
      .sort((a, b) => (b.impact || 0) - (a.impact || 0))
      .slice(0, 5)
      .map(m => {
        const ts = m.ts ? ` [${m.ts.split('T')[0]}]` : '';
        return `- ${m.event}${ts}`;
      });
    sections.push(`## 关键里程碑\n${milestones.join('\n')}`);
  }

  // Failure learnings
  if (sm.failure_learnings?.length) {
    const lessons = sm.failure_learnings
      .filter(f => !f.applied)
      .slice(0, 3)
      .map(f => `- ${f.lesson}${f.context ? ` (${f.context})` : ''}`);
    if (lessons.length) {
      sections.push(`## 待应用的教训\n${lessons.join('\n')}`);
    }
  }

  // Relationship map
  if (sm.relationship_map?.length) {
    const rels = sm.relationship_map
      .sort((a, b) => (b.trust || 0) - (a.trust || 0))
      .slice(0, 5)
      .map(r => `${r.name}(${r.role}, 信任度:${Math.round((r.trust || 0) * 100)}%)`);
    sections.push(`## 关系网络\n${rels.join('、')}`);
  }

  // Growth trajectory
  if (sm.growth_trajectory?.skill_delta?.length) {
    const deltas = sm.growth_trajectory.skill_delta
      .slice(-5)
      .map(d => `${d.skill}: ${d.delta > 0 ? '+' : ''}${Math.round(d.delta * 100)}% (${d.period})`);
    sections.push(`## 成长轨迹\n${deltas.join('、')}`);
  }

  return sections.join('\n\n');
}

// ── Provenance source labels (EPISODE_SOURCES → 中文) ───────────────

const SOURCE_LABELS = {
  text: '手动记录',
  chat: '对话',
  auto_extract: '自动提取',
  voice: '语音',
  image: '图片',
  reflection: '反思',
  system: '系统',
  consolidation: '归并',
  visitor: '访客',
};

/**
 * Format a single episode's provenance: 日期·来源·置信度, with a low-confidence
 * flag when applicable. Reused by renderEpisodicContext and the search_memory
 * tool result so the model can audit/attribute recalled facts.
 *
 * @param {object} episode - { created_at, source, confidence }
 * @returns {string} e.g. "2026-05-01·自动提取·置信60% ⚠低置信"
 */
export function formatProvenance(episode = {}) {
  const parts = [];

  const dateStr = episode.created_at ? episode.created_at.split('T')[0] : '';
  if (dateStr) parts.push(dateStr);

  // visitor-contributed memories are tagged source:'visitor' or carry a from:relId tag
  let source = episode.source;
  if (!source && Array.isArray(episode.tags) && episode.tags.some(t => String(t).startsWith('from:'))) {
    source = 'visitor';
  }
  if (source) parts.push(SOURCE_LABELS[source] || source);

  const conf = typeof episode.confidence === 'number' ? episode.confidence : null;
  if (conf != null) parts.push(`置信${Math.round(conf * 100)}%`);

  let out = parts.join('·');
  if (conf != null && conf <= LOW_CONFIDENCE_THRESHOLD) {
    out += (out ? ' ' : '') + '⚠低置信';
  }
  return out;
}

function renderEpisodicContext(episodes) {
  if (!episodes.length) return '';
  const lines = episodes.map(ep => {
    const prov = formatProvenance(ep);
    const tssStr = ep.tss ? ` [相关度:${Math.round(ep.tss * 100)}%]` : '';
    return `- [${prov}]${tssStr} ${ep.content_raw?.slice(0, 150) || ''}`;
  });
  return `## 相关记忆\n${lines.join('\n')}`;
}

// ── Dimension label map ────────────────────────────────────────────

function dimensionLabel(dim) {
  const labels = {
    health: '健康', career: '事业', family: '家庭', finance: '财务',
    growth: '成长', social: '社交', hobby: '兴趣', self_realization: '自我实现',
  };
  return labels[dim] || dim;
}

// ══════════════════════════════════════════════════════════════════
//  Public API
// ══════════════════════════════════════════════════════════════════

/**
 * Build the full memory context with intent-gated retrieval and TSS ranking.
 *
 * @param {string} userId
 * @param {object} options
 * @param {string} [options.query]           – user message for intent classification + retrieval
 * @param {number} [options.maxEpisodes=5]   – max episodic memories to include
 * @param {boolean} [options.includeWorking=true]
 * @param {object}  [options.budgetOverride]
 * @param {Function} [options.vectorSearch]   – async (userId, query, k) => [{episode, similarity}]
 * @returns {{ contextText: string, tokensUsed: number, layers: object, intent: object }}
 */
export function buildMemoryContext(userId, options = {}) {
  const {
    query = null,
    maxEpisodes = 5,
    includeWorking = true,
    budgetOverride = {},
    vectorSearch = null,
    queryEmbedding = null,
    stateText = '',
    narrativeText = '',
  } = options;

  const budget = { ...TOKEN_BUDGET, ...budgetOverride };

  // Step 0: Privacy kill switch — if the user paused long-term memory, inject
  // nothing personal (no profile/working/episode reads, no usage side-effects).
  if (isMemoryPaused(userId)) {
    return EMPTY_CONTEXT(true);
  }

  // Step 1: Intent classification
  const profile = getProfile(userId);
  const working = includeWorking ? getWorkingMemory(userId) : null;

  const intentResult = query
    ? classifyIntent(query, {
        activeGoals: working?.active_goals || [],
        lastTopic: working?.conversation_continuity?.last_topic,
      })
    : { intent: 'casual', confidence: 0.5, retrievalConfig: { use_l1: true, use_l2: false, use_l3: false, use_l4_vector: false }, tssWeights: {} };

  const rc = intentResult.retrievalConfig;
  const layers = {};

  // Step 2: L1 Core Identity (always injected for persona)
  const l1Text = renderCoreIdentity(profile.core_identity);
  const l1Truncated = truncateToTokens(l1Text, budget.l1_core_identity);
  layers.core_identity = { text: l1Truncated, tokens: estimateTokens(l1Truncated) };

  // Step 2.5: Current state — computed by the State Engine (P2) and passed in by
  // the caller; rendered near the top as the most immediate "where am I now".
  const stateTruncated = stateText ? truncateToTokens(stateText, 400) : '';
  if (stateTruncated) layers.current_state = { text: stateTruncated, tokens: estimateTokens(stateTruncated) };

  // Step 2.6: Growth narrative (trajectory) — computed by the Narrative Engine (P4),
  // passed in by the caller from the stored report (never generated in the hot path).
  const narrativeTruncated = narrativeText ? truncateToTokens(narrativeText, 300) : '';
  if (narrativeTruncated) layers.narrative = { text: narrativeTruncated, tokens: estimateTokens(narrativeTruncated) };

  // Step 3: L2 Working Memory (conditional)
  let l2Truncated = '';
  if (includeWorking && rc.use_l2 && working) {
    const l2Text = renderWorkingMemory(working);
    l2Truncated = truncateToTokens(l2Text, budget.l2_working_memory);
    layers.working_memory = { text: l2Truncated, tokens: estimateTokens(l2Truncated) };
  }

  // Step 4: L3 Semantic Long-Term (conditional)
  let l3Truncated = '';
  if (rc.use_l3) {
    const l3Text = renderSemanticMemory(profile.semantic_memory);
    l3Truncated = truncateToTokens(l3Text, budget.l3_semantic);
    layers.semantic_memory = { text: l3Truncated, tokens: estimateTokens(l3Truncated) };
  }

  // Step 4.5: Entity cards (图鉴) — when the message mentions a known card
  // by name/alias, inject its fact block regardless of intent depth (this is
  // what makes "妈妈最近怎么样" feel personal even in casual chat). Cards the
  // owner flagged ai_excluded never match (filtered in the registry).
  let entityText = '';
  let matchedEntities = [];
  if (query) {
    matchedEntities = detectEntityMentions(store, userId, query);
    if (matchedEntities.length) {
      entityText = renderEntityContext(matchedEntities, { maxTokens: budget.l35_entities });
      entityText = truncateToTokens(entityText, budget.l35_entities);
      layers.entities = {
        text: entityText,
        tokens: estimateTokens(entityText),
        ids: matchedEntities.map((e) => e.id),
      };
    }
  }

  // Step 5: L4 Episodic recall with TSS ranking (conditional)
  let l4Text = '';
  if (query && rc.use_l4_vector && rc.l4_top_k > 0) {
    // Hybrid candidate pool: semantic (vector) + keyword (+ entity-linked),
    // fused via RRF. queryEmbedding is supplied by the caller (async chat
    // handler) so this stays sync; when absent we fuse what we have.
    const keywordEps = searchEpisodes(userId, query, { limit: maxEpisodes * 3 });
    const sources = [{ results: keywordEps, weight: 0.8, source: 'bm25' }];
    if (queryEmbedding) {
      const vectorEps = searchEpisodesByVector(userId, queryEmbedding, { topK: maxEpisodes * 4 });
      sources.unshift({ results: vectorEps, weight: 1.0, source: 'vector' });
    }
    if (matchedEntities.length) {
      // Fragments linked to the mentioned cards — the graph-ish channel.
      // listEpisodes default excludes ai_excluded rows, matching retrieval.
      const matchedIds = new Set(matchedEntities.map((e) => e.id));
      const entityEps = listEpisodes(userId, { limit: 500 })
        .filter((ep) => Array.isArray(ep.entity_ids) && ep.entity_ids.some((id) => matchedIds.has(id)))
        .slice(0, maxEpisodes * 3);
      if (entityEps.length) sources.push({ results: entityEps, weight: 0.6, source: 'entity' });
    }
    const episodes = sources.length > 1
      ? reciprocalRankFusion(sources, { topK: maxEpisodes * 3 })
      : keywordEps;

    if (episodes.length > 0) {
      let rankedEpisodes;

      // Goal-scoped cone search if active goal present
      const activeGoal = working?.active_goals?.find(g => g.phase === 'in_progress');
      if (rc.cone_search && activeGoal) {
        const skillDomains = (profile.core_identity.expertise?.domains || []).map(d => d.domain);
        rankedEpisodes = coneSearch(episodes, activeGoal, {
          k: maxEpisodes,
          intentType: intentResult.intent,
          skillDomains,
        });
      } else {
        rankedEpisodes = rankByTSS(episodes, {
          intentType: intentResult.intent,
          limit: maxEpisodes,
        });
      }

      // Track usage for accessed episodes
      for (const ep of rankedEpisodes) {
        try { incrementEpisodeUsage(userId, ep.id); } catch { /* non-critical */ }
      }

      const remainingBudget = budget.total_context
        - (layers.core_identity?.tokens || 0)
        - (layers.working_memory?.tokens || 0)
        - (layers.semantic_memory?.tokens || 0)
        - (layers.entities?.tokens || 0);
      const raw = renderEpisodicContext(rankedEpisodes);
      l4Text = truncateToTokens(raw, Math.max(remainingBudget, 200));
      layers.episodic = { text: l4Text, tokens: estimateTokens(l4Text), count: rankedEpisodes.length };
    }
  }

  // Step 6: Assemble context
  const sections = [l1Truncated, stateTruncated, narrativeTruncated, l2Truncated, l3Truncated, entityText, l4Text].filter(Boolean);
  const contextText = sections.join('\n\n');
  const tokensUsed = estimateTokens(contextText);

  return {
    contextText,
    tokensUsed,
    layers,
    intent: {
      type: intentResult.intent,
      confidence: intentResult.confidence,
      retrieval: rc,
    },
  };
}

/**
 * Build a minimal context with only L1 + L3 summary (for lightweight LLM calls).
 */
export function buildProfileContext(userId) {
  const profile = getProfile(userId);
  const l1 = renderCoreIdentity(profile.core_identity);
  const l3 = renderSemanticMemory(profile.semantic_memory);
  const text = [l1, l3].filter(Boolean).join('\n\n');
  return { contextText: text, tokensUsed: estimateTokens(text) };
}

/**
 * Build context for a specific intent type (bypass classification).
 */
export function buildContextForIntent(userId, intentType, query) {
  return buildMemoryContext(userId, {
    query,
    maxEpisodes: intentType === 'casual' ? 0 : 5,
    includeWorking: intentType !== 'casual',
  });
}

export default {
  buildMemoryContext,
  buildProfileContext,
  buildContextForIntent,
  estimateTokens,
  formatProvenance,
};
