// 图鉴共享词汇：类型枚举 / 4 分组 / fact 模板（镜像后端 entity-registry.mjs）。
// 拆自 EntityCodexView（IA v3 高级感改版）。
import type { useTranslations } from 'next-intl';
import type { EntityType, Entity } from '@/lib/apiClient';

export const ENTITY_TYPE_KEYS: EntityType[] = ['person', 'pet', 'object', 'place', 'event', 'org', 'other'];

// 4 组筛选（IA v2 批次3）：7 类实体折叠为通讯录式分组，减少类型噪音
export const ENTITY_GROUPS = [
  { key: 'people', types: ['person'] as EntityType[] },
  { key: 'things', types: ['pet', 'object', 'other'] as EntityType[] },
  { key: 'places', types: ['place', 'org'] as EntityType[] },
  { key: 'events', types: ['event'] as EntityType[] },
] as const;
export type GroupKey = typeof ENTITY_GROUPS[number]['key'];

export function groupOf(type: EntityType): GroupKey {
  return ENTITY_GROUPS.find(g => (g.types as readonly EntityType[]).includes(type))?.key ?? 'things';
}

// 用户自填 emoji 的编辑器 placeholder / 类型选择 chip 用；类型图标本体已
// 换 lucide（typeMeta.tsx）。
export const TYPE_FALLBACK_EMOJI: Record<EntityType, string> = {
  person: '🧑', pet: '🐾', object: '📦', place: '📍', event: '🎫', org: '🏢', other: '✨',
};

// Mirrors backend ENTITY_FACT_TEMPLATES (src/memory/entity-registry.mjs):
// canonical machine keys per type; display labels live in i18n keyLabels.
export const FACT_TEMPLATES: Record<EntityType, string[]> = {
  person: ['birthday', 'personality', 'likes', 'how_we_met'],
  pet: ['breed', 'birthday', 'personality'],
  object: ['brand', 'model', 'acquired_at', 'meaning'],
  place: ['city', 'period', 'meaning'],
  event: ['when', 'my_role', 'impact'],
  org: ['my_role', 'joined_at'],
  other: [],
};
export const KNOWN_FACT_KEYS = new Set(Object.values(FACT_TEMPLATES).flat());

export type Tr = ReturnType<typeof useTranslations<'app'>>;

export function factKeyLabel(t: Tr, k: string): string {
  return KNOWN_FACT_KEYS.has(k) ? t(`memory.codex.keyLabels.${k}` as Parameters<Tr>[0]) : k;
}

/** 卡片完整度：已填 facts 相对该类型建议模板键数（模板空的类型返回 null 不显示）。 */
export function completenessOf(entity: Entity): number | null {
  const template = FACT_TEMPLATES[entity.entity_type] ?? [];
  if (!template.length) return null;
  const filled = new Set((entity.facts || []).map(f => f.k));
  const hit = template.filter(k => filled.has(k)).length;
  return Math.min(1, hit / template.length);
}

/** 卡面 AI 总结的降级拼接：relation + 前 2 条 facts 的值（不带 k 标签）。 */
export function summaryFallback(entity: Entity): string {
  return [entity.relation, ...(entity.facts || []).slice(0, 2).map(f => f.v)]
    .map(s => String(s || '').trim())
    .filter(Boolean)
    .join(' · ');
}
