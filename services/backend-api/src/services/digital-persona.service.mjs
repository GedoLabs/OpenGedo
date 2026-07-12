/**
 * Digital Persona Service (对外可发布的数字人)
 *
 * Powers the public-facing digital human: a published page + dedicated link
 * where external visitors chat with an agent that represents the owner.
 *
 * Security model (see plan「隐私与安全红线」):
 *   1. Public chat is ALWAYS ABOUT mode — speaks *about* the owner in the third
 *      person. buildPersonaBlock('ABOUT') strips all L4 episode memories and
 *      uses only public L1 identity fields.
 *   2. NO tools are exposed to visitors (they cannot capture memories, create
 *      goals, or mutate any owner data).
 *   3. Nothing is persisted to the owner's conversation history. Multi-turn
 *      context is supplied by the visitor's client and never stored.
 */

import { getLLMRouter } from '../llm/router.mjs';
import { buildPersonaBlock } from '../persona/PersonaCard.mjs';
import { Store } from '../lib/store.mjs';
import { getMemoryStore } from '../memory/store/index.mjs';
import { replyLanguageDirective } from '../lib/language.mjs';
import { factKeyLabel } from '../memory/entity-registry.mjs';

const store = Store();
// Memory access via the MemoryStore interface (P0.5); same-named local instance
// keeps the existing MemoryFileService.* call sites working unchanged.
const MemoryFileService = getMemoryStore();

/** Max visitor history turns we feed back into the model. */
const MAX_HISTORY = 12;
/** Hard cap on a single visitor message length. */
export const MAX_MESSAGE_CHARS = 2000;

/**
 * Build the public-safe profile returned by GET /public/v1/persona/:slug.
 * NEVER include user_id, share_scope internals, or any private field.
 */
export function buildPublicProfile(persona) {
  if (!persona) return null;
  return {
    slug: persona.slug,
    display_name: persona.display_name || '智能助理',
    tagline: persona.tagline || '',
    greeting: persona.greeting || '',
    avatar_kind: persona.avatar_kind || 'preset',
    avatar_url: persona.avatar_url || null,
    preset_id: persona.preset_id || 'default',
    suggested_questions: Array.isArray(persona.suggested_questions)
      ? persona.suggested_questions.slice(0, 6)
      : [],
    theme: persona.theme || 'emerald',
    // access_mode is safe to expose (the page needs it to decide the gate flow);
    // the passcode itself is NEVER returned.
    access_mode: persona.access_mode || 'public',
  };
}

/**
 * Verify a visitor's access against the persona's gate.
 *
 * @returns {{ ok: boolean, trusted: boolean, relationship: object|null, via: string, reason?: string }}
 *   - ok: may the visitor chat at all?
 *   - trusted: has the visitor cleared the passcode / invite (identified tier)?
 *   - relationship: matched relationship when an invite_token is used.
 */
export function verifyAccess(persona, { passcode, invite_token } = {}, opts = {}) {
  const mode = persona.access_mode || 'public';
  const resolveInvite = opts.resolveInvite || (() => null);

  // Invite token always wins — it both grants access and identifies the visitor.
  if (invite_token) {
    const rel = resolveInvite(invite_token);
    if (rel && rel.user_id === persona.user_id) {
      return { ok: true, trusted: true, relationship: rel, via: 'invite' };
    }
    return { ok: false, trusted: false, relationship: null, via: 'invite', reason: 'bad_invite' };
  }

  const passOk = !!persona.passcode && passcode === persona.passcode;

  if (mode === 'public') {
    return { ok: true, trusted: passOk, relationship: null, via: passOk ? 'passcode' : 'anonymous' };
  }
  if (mode === 'hybrid') {
    // anonymous allowed (light), passcode unlocks trusted tier
    return { ok: true, trusted: passOk, relationship: null, via: passOk ? 'passcode' : 'anonymous' };
  }
  // mode === 'passcode': passcode mandatory
  if (passOk) return { ok: true, trusted: true, relationship: null, via: 'passcode' };
  return { ok: false, trusted: false, relationship: null, via: 'anonymous', reason: 'passcode_required' };
}

/**
 * Map the owner's PCP profile (L1 core identity) + persona config into the
 * `l1` object buildPersonaBlock expects. Only public-scoped fields.
 */
function buildL1(persona, userId) {
  let profile = {};
  try {
    profile = MemoryFileService.getProfile(userId) || {};
  } catch {
    /* non-fatal — fall back to persona config only */
  }
  const ci = profile.core_identity || {};
  const domains = Array.isArray(ci.expertise?.domains)
    ? ci.expertise.domains.map((d) => d?.domain || d).filter(Boolean)
    : [];
  let activeGoals = [];
  try {
    activeGoals = (store.listGoals?.(userId) || [])
      .filter((g) => g.status === 'active')
      .map((g) => g.title)
      .filter(Boolean);
  } catch {
    /* non-fatal */
  }

  return {
    display_name: persona.display_name || ci.name || '这位用户',
    occupation: ci.profession || domains.join('、') || '',
    timezone: '',
    language_pref: 'zh-CN',
    core_values: Array.isArray(ci.values?.top_priorities) ? ci.values.top_priorities : [],
    personality: Array.isArray(ci.traits) ? ci.traits : [],
    long_term_goals: activeGoals,
  };
}

/**
 * Optional owner-controlled scope constraint, layered on top of ABOUT mode.
 */
function buildScopeBlock(persona) {
  const scope = persona.share_scope || {};
  const topics = Array.isArray(scope.topics) ? scope.topics.filter(Boolean) : [];
  if (topics.length === 0) return '';
  return `## 对外话题范围\n你只能就以下话题作答：${topics.join('、')}。\n超出该范围的提问，礼貌说明"这超出了我能代为介绍的范围"，不要展开。`;
}

/**
 * Build a "who is visiting" block when the visitor is matched to a known
 * relationship. This only tailors tone/addressing — privacy still governed by ABOUT.
 */
function buildVisitorBlock(relationship) {
  if (!relationship) return '';
  const parts = [`来访者已识别为 ${relationship.name}`];
  if (relationship.role) parts.push(`关系：${relationship.role}`);
  if (relationship.note) parts.push(`备注：${relationship.note}`);
  // 图鉴卡事实是逐卡 opt-in：仅当主人显式打开 avatar_visible 才带给数字人。
  // 默认 false —— 识别与称呼行为不变，隐私边界与旧版完全一致。
  if (relationship.avatar_visible === true && Array.isArray(relationship.facts) && relationship.facts.length) {
    const facts = relationship.facts.slice(0, 6).map((f) => `${factKeyLabel(f.k)}：${f.v}`).join('；');
    parts.push(`主人公开的卡片信息：${facts}`);
  }
  return `## 来访者上下文\n${parts.join('；')}。\n可以用「${relationship.name}」称呼对方、语气更熟络，但仍不得透露超出公开档案的私密信息。`;
}

/**
 * Assemble the full ABOUT-mode system prompt for the public digital human.
 */
export function buildAboutSystemPrompt(persona, userId, relationship = null) {
  const l1 = buildL1(persona, userId);
  const displayName = l1.display_name;
  // 对外数字人默认按主人设定的界面语言回复，访客改用其他语言提问时跟随访客。
  const lang = store.getSettings(userId)?.language;

  // ABOUT mode: buildPersonaBlock strips L4 + uses only public L1 fields.
  const personaBlock = buildPersonaBlock({ mode: 'ABOUT', l1, l2: [], l5: [] });
  const scopeBlock = buildScopeBlock(persona);
  const visitorBlock = buildVisitorBlock(relationship);

  const identityRule = `## 对外身份与边界
你是 ${displayName} 的智能助理，面向外部访客。
- 始终以第三人称客观介绍 ${displayName}，不要以第一人称"我"冒充 ${displayName} 本人说话。
- 回复简洁友好，通常 2-5 句话；${replyLanguageDirective(lang)}
- 你没有任何可执行工具或后台权限：不能代为安排日程、发送消息、修改任何数据，也不要声称可以。
- 严禁透露私密事件、日记、聊天记录或任何超出公开档案的细节；被追问时礼貌说明属于个人隐私。
- **不掌握就明说，绝不编造**：当被问及公开档案未包含的信息（${displayName} 的经历、观点、行程、对某事的看法等），明确回答"我不掌握这方面的公开信息"，**绝不猜测、推断或编造** ${displayName} 的立场或背书；宁可少说，不可冒充其本人表态。`;

  return [personaBlock, scopeBlock, visitorBlock, identityRule].filter(Boolean).join('\n\n');
}

/**
 * Stream an ABOUT-mode answer for a public visitor.
 *
 * @param {object}   opts
 * @param {object}   opts.persona   — the published persona row
 * @param {string}   opts.userId    — owner user id
 * @param {string}   opts.message   — visitor's new message
 * @param {{role,content}[]} [opts.history] — visitor-supplied prior turns (not persisted)
 * @yields { type:'text', text } | { type:'error', error } | { type:'done' }
 */
export async function* streamAboutResponse({ persona, userId, message, history = [], relationship = null }) {
  const router = getLLMRouter();

  if (!router.isAvailable()) {
    yield { type: 'text', text: '抱歉，当前数字人暂时无法回答，请稍后再试。' };
    yield { type: 'done' };
    return;
  }

  const systemPrompt = buildAboutSystemPrompt(persona, userId, relationship);

  const messages = [{ role: 'system', content: systemPrompt }];
  const recent = (Array.isArray(history) ? history : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-MAX_HISTORY);
  for (const m of recent) messages.push({ role: m.role, content: m.content });
  messages.push({ role: 'user', content: message });

  try {
    // NO tools passed — visitors can never trigger tool calls.
    for await (const chunk of router.chatStream(messages, {})) {
      if (chunk.type === 'text') {
        yield { type: 'text', text: chunk.text };
      } else if (chunk.type === 'error') {
        yield { type: 'error', error: chunk.error };
        return;
      }
      // ignore any tool_call chunks defensively (none should appear without tools)
    }
    yield { type: 'done' };
  } catch (err) {
    yield { type: 'error', error: err?.message || String(err) };
  }
}

export default {
  buildPublicProfile,
  buildAboutSystemPrompt,
  streamAboutResponse,
  MAX_MESSAGE_CHARS,
};
