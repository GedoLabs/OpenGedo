'use client';

// 图鉴类型视觉系统（IA v3 高级感改版）：每类实体一个 lucide 线性图标 + 固定
// oklch 色相，经 color-mix 生成浅底/描边，暗浅主题皆可用。替代原 emoji
// 类型图标（用户自填 emoji 降级为 tile 角标装饰，编辑器 placeholder 仍用
// TYPE_FALLBACK_EMOJI）。
import type { LucideIcon } from 'lucide-react';
import {
  UserRound, PawPrint, Package, MapPin, CalendarDays, Building2, Sparkles,
  LayoutGrid, Users,
} from 'lucide-react';
import type { EntityType } from '@/lib/apiClient';

export const TYPE_META: Record<EntityType, { Icon: LucideIcon; hue: number | null }> = {
  person: { Icon: UserRound,    hue: 250 }, // 蓝
  pet:    { Icon: PawPrint,     hue: 80 },  // 黄绿
  object: { Icon: Package,      hue: 160 }, // 绿
  place:  { Icon: MapPin,       hue: 30 },  // 橙红
  event:  { Icon: CalendarDays, hue: 300 }, // 紫
  org:    { Icon: Building2,    hue: 210 }, // 青
  other:  { Icon: Sparkles,     hue: null }, // 中性
};

export function typeColor(type: EntityType): string {
  const hue = TYPE_META[type]?.hue ?? null;
  return hue == null ? 'var(--g-text-muted)' : `oklch(0.68 0.13 ${hue})`;
}


// 左导航 4 分组的图标（分组定义在 shared.ts ENTITY_GROUPS）
export const GROUP_ICONS: Record<string, LucideIcon> = {
  all: LayoutGrid,
  people: Users,
  things: Package,
  places: MapPin,
  events: CalendarDays,
};

/**
 * 类型图标 tile：浅底圆角方块 + 线性图标；用户自填 emoji 以小角标叠在
 * 右下（次级装饰）。className 默认挂 gedo-codex-emoji 以复用卡片 hover
 * 的微动效（globals.css）。
 */
export function TypeIconTile({ type, emoji, size = 36, className = 'gedo-codex-emoji' }: {
  type: EntityType;
  emoji?: string;
  size?: number;
  className?: string;
}) {
  const { Icon } = TYPE_META[type] ?? TYPE_META.other;
  const color = typeColor(type);
  return (
    <span
      className={className}
      style={{
        position: 'relative', width: size, height: size, borderRadius: Math.round(size * 0.32),
        flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: `color-mix(in oklch, ${color} 13%, transparent)`,
        border: `1px solid color-mix(in oklch, ${color} 32%, transparent)`,
        color,
      }}
    >
      <Icon size={Math.round(size * 0.5)} strokeWidth={1.7} />
      {emoji ? (
        <span style={{ position: 'absolute', right: -5, bottom: -5, fontSize: Math.max(11, Math.round(size * 0.36)), lineHeight: 1 }}>
          {emoji}
        </span>
      ) : null}
    </span>
  );
}
