/**
 * Entity Registry (图鉴) — shared helpers for the entity card layer.
 *
 * Entity cards are the stable anchor layer of memory: the people, pets,
 * objects, places, events and organizations that episodes keep referring to.
 * This module owns the type/fact-template vocabulary and the two pipeline
 * touch points:
 *   - detectEntityMentions()  → which cards a message is talking about
 *   - renderEntityContext()   → the fact block injected into the LLM context
 *
 * Fact keys are canonical machine keys (birthday, personality, …) so
 * fill-gap logic stays language-independent; display labels live in the
 * frontend i18n files (app.memory.codex.factEditor.keyLabels.*).
 */

export const ENTITY_TYPES = ['person', 'pet', 'object', 'place', 'event', 'org', 'other'];

// Per-type suggested fact keys. `core: true` keys drive the fill-gap
// prompting ("图鉴上妈妈的生日还空着") — keep that set small.
export const ENTITY_FACT_TEMPLATES = {
  person: [
    { key: 'birthday', core: true },
    { key: 'personality' },
    { key: 'likes' },
    { key: 'how_we_met' },
  ],
  pet: [
    { key: 'breed', core: true },
    { key: 'birthday' },
    { key: 'personality' },
  ],
  object: [
    { key: 'brand', core: true },
    { key: 'model' },
    { key: 'acquired_at' },
    { key: 'meaning' },
  ],
  place: [
    { key: 'city', core: true },
    { key: 'period' },
    { key: 'meaning' },
  ],
  event: [
    { key: 'when', core: true },
    { key: 'my_role' },
    { key: 'impact' },
  ],
  org: [
    { key: 'my_role', core: true },
    { key: 'joined_at' },
  ],
  other: [],
};

// Human-readable fallbacks for prompts (zh — prompts to the extractor and
// the companion system prompt are assembled in zh and rewritten by the
// language directive downstream, same as the rest of the memory blocks).
const FACT_KEY_LABELS = {
  birthday: '生日',
  personality: '性格',
  likes: '喜好',
  how_we_met: '怎么认识的',
  breed: '品种',
  brand: '品牌',
  model: '型号',
  acquired_at: '入手时间',
  meaning: '对我的意义',
  city: '城市',
  period: '时期',
  when: '发生时间',
  my_role: '我的角色',
  impact: '影响',
  joined_at: '加入时间',
};

const TYPE_LABELS = {
  person: '人', pet: '宠物', object: '物品', place: '地点',
  event: '事件', org: '组织', other: '其他',
};

export function factKeyLabel(key) {
  return FACT_KEY_LABELS[key] || key;
}

export function entityTypeLabel(type) {
  return TYPE_LABELS[type] || TYPE_LABELS.other;
}

/** Core template keys this card hasn't filled yet. */
export function getMissingCoreFacts(entity) {
  const tpl = ENTITY_FACT_TEMPLATES[entity?.entity_type] || [];
  const have = new Set((entity?.facts || []).map((f) => f.k));
  return tpl.filter((t) => t.core && !have.has(t.key)).map((t) => ({ key: t.key, label: factKeyLabel(t.key) }));
}

/**
 * Find which of the user's cards `text` mentions, by name/alias substring.
 * Cheap first-pass linker used on every chat turn — no LLM, no embeddings.
 * Aliases shorter than 2 chars are skipped (too noisy), ai_excluded cards
 * never match (privacy: the owner hid them from the AI), ranking is by
 * interaction_count then recency.
 */
export function detectEntityMentions(store, userId, text, { limit = 3 } = {}) {
  const hay = String(text || '').toLowerCase();
  if (!hay.trim()) return [];
  const hits = [];
  for (const e of store.listEntities(userId)) {
    if (e.ai_excluded) continue;
    const names = [e.name, ...(e.aliases || [])]
      .map((n) => String(n || '').toLowerCase().trim())
      .filter((n) => n.length >= 2);
    if (names.some((n) => hay.includes(n))) hits.push(e);
  }
  hits.sort((a, b) =>
    (b.interaction_count || 0) - (a.interaction_count || 0)
    || new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
  return hits.slice(0, limit);
}

/**
 * Render matched cards as a compact context block. Roughly 4 chars/token
 * for zh text — callers pass maxTokens from TOKEN_BUDGET.l35_entities.
 */
export function renderEntityContext(entities, { maxTokens = 400 } = {}) {
  const list = (entities || []).filter((e) => e && e.ai_excluded !== true);
  if (list.length === 0) return '';
  const maxChars = maxTokens * 4;
  const lines = ['## 相关的人与物（图鉴）'];
  for (const e of list) {
    const bits = [`${e.name}（${entityTypeLabel(e.entity_type)}${e.relation ? `，${e.relation}` : ''}）`];
    for (const f of (e.facts || []).slice(0, 6)) {
      bits.push(`${factKeyLabel(f.k)}：${f.v}`);
    }
    if (e.note) bits.push(`备注：${String(e.note).slice(0, 60)}`);
    lines.push(`- ${bits.join('；')}`);
  }
  let text = lines.join('\n');
  if (text.length > maxChars) text = `${text.slice(0, maxChars - 1)}…`;
  return text;
}

/**
 * Cards worth asking about: frequently-referenced cards with unfilled core
 * facts. Used to steer the extractor (unfilledSlots) and the companion's
 * once-a-day soft probe.
 */
export function getEntityFillGaps(store, userId, { limit = 2 } = {}) {
  const gaps = [];
  const entities = store.listEntities(userId)
    .filter((e) => e.ai_excluded !== true && e.name)
    .sort((a, b) => (b.interaction_count || 0) - (a.interaction_count || 0));
  for (const e of entities) {
    for (const miss of getMissingCoreFacts(e)) {
      gaps.push({
        id: `entity:${e.id}:${miss.key}`,
        entity_id: e.id,
        fact_key: miss.key,
        label: `${e.name} 的${miss.label}`,
        hint: `图鉴里「${e.name}」这张卡还缺${miss.label}`,
      });
      if (gaps.length >= limit) return gaps;
    }
  }
  return gaps;
}

export default {
  ENTITY_TYPES,
  ENTITY_FACT_TEMPLATES,
  factKeyLabel,
  entityTypeLabel,
  getMissingCoreFacts,
  detectEntityMentions,
  renderEntityContext,
  getEntityFillGaps,
};
