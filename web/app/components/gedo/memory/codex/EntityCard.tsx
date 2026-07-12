'use client';

// 图鉴实体卡（IA v3 高级感改版）：三层信息 —— 类型图标 tile + 名称/关系、
// AI 总结（line-clamp 3，缺失降级 relation+facts 值拼接）、维度点+隐私徽章。
// 卡面不再堆 facts k·v / 完整度环 / 类型 Pill（全部移入详情面板）。
//
// hover 展开（gedo/memory 首次引入 framer-motion，只落 codex/）：悬浮时在
// 卡底浮出 absolute 覆层（完整总结 + 提及 meta），不推挤 auto-fill 网格。
// 降级三保险：无 hover 指针（触屏）不注册展开；prefers-reduced-motion 退化
// 纯 opacity；点卡直开详情面板。
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import type { Entity } from '@/lib/apiClient';
import { fontVars } from '@/app/components/gedo/typography';
import { Dot } from '@/app/components/gedo/primitives';
import { dimColor } from '../dimensions';
import { summaryFallback, type Tr } from './shared';
import { TypeIconTile } from './typeMeta';
import { useMediaQuery } from './useMediaQuery';

export function EntityCard({ entity, onClick, active }: { entity: Entity; onClick: () => void; active?: boolean }) {
  const t = useTranslations('app');
  const td = t as unknown as (key: string, values?: Record<string, unknown>) => string;
  const locale = useLocale();
  const reduced = useReducedMotion();
  const canHover = useMediaQuery('(hover: hover) and (pointer: fine)');
  const [hovered, setHovered] = useState(false);

  const summary = (entity.ai_summary || '').trim() || summaryFallback(entity);
  const lastSeen = entity.last_interaction ? new Date(entity.last_interaction).toLocaleDateString(locale) : null;
  // 展开覆层只在有更多内容可看时出现（总结较长，3 行装不下的概率高）
  const expandable = canHover && summary.length > 60;

  const privacyBadges = (
    <>
      {entity.ai_excluded && (
        <span style={{ fontSize: fontVars.xs, color: 'var(--g-warn, #d9a441)', fontFamily: 'var(--g-font-mono)' }}>
          {t('memory.codex.aiHiddenBadge')}
        </span>
      )}
      {entity.avatar_visible && (
        <span style={{ fontSize: fontVars.xs, color: 'var(--g-accent)', fontFamily: 'var(--g-font-mono)' }}>
          {t('memory.codex.avatarVisibleBadge')}
        </span>
      )}
    </>
  );

  return (
    <motion.button
      type="button"
      onClick={onClick}
      className={`gedo-codex-card${active ? ' is-active' : ''}`}
      whileHover={reduced ? undefined : { y: -4 }}
      whileTap={reduced ? undefined : { y: -1 }}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      style={{
        position: 'relative',
        // 悬浮时把整张卡抬到兄弟卡之上：展开覆层向下溢出卡身，grid 里排在后面的
        // 卡片默认会盖住它（导致「提及」行被遮 + 看似溢出边框）。grid 子项即使
        // 静态定位也认 z-index。
        zIndex: hovered ? 20 : undefined,
        textAlign: 'left',
        background: 'var(--g-bg-raised)',
        borderRadius: 14,
        padding: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        color: 'inherit',
        fontFamily: 'var(--g-font-sans)',
        opacity: entity.ai_excluded ? 0.65 : 1,
      }}
    >
      {/* 头行：类型图标 tile（emoji 角标）+ 名称 + 关系 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <TypeIconTile type={entity.entity_type} emoji={entity.emoji || undefined} size={36} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: fontVars.base, fontWeight: 600, color: 'var(--g-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {entity.name || '—'}
          </div>
          <div style={{ fontSize: fontVars.xs, color: 'var(--g-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {entity.relation || t(`memory.codex.types.${entity.entity_type}` as Parameters<Tr>[0])}
          </div>
        </div>
      </div>

      {/* AI 总结（或降级拼接） */}
      {summary ? (
        <p style={{
          margin: 0, fontSize: fontVars.sm, color: 'var(--g-text-mid)', lineHeight: 1.6,
          display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          {summary}
        </p>
      ) : (
        <p style={{ margin: 0, fontSize: fontVars.sm, color: 'var(--g-text-faint)', fontStyle: 'italic', lineHeight: 1.6 }}>
          {t('memory.codex.summary.empty')}
        </p>
      )}

      {/* 底行：维度点 + 隐私徽章 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 'auto' }}>
        {(entity.dimensions || []).map((d) => <Dot key={d} color={dimColor(d)} size={6} />)}
        <span style={{ flex: 1 }} />
        {privacyBadges}
      </div>

      {/* hover 展开覆层：盖在卡上的「抬升卡」，完整总结 + 提及 meta。
          absolute 定位不改变卡在网格里的占位，同行卡片不抖动。 */}
      <AnimatePresence>
        {expandable && hovered && (
          <motion.div
            initial={{ opacity: 0, y: reduced ? 0 : 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.1 } }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
            style={{
              position: 'absolute', top: -1, left: -1, right: -1, zIndex: 30,
              minHeight: 'calc(100% + 2px)',
              display: 'flex', flexDirection: 'column', gap: 10,
              padding: 14, borderRadius: 14,
              background: 'var(--g-bg-raised)',
              // 边框/环跟随选中态：选中卡（.is-active 绿环）再悬浮时，覆层
              // 也用 accent 绿边+绿环，避免绿外框 + 灰内框的撞色割裂。
              border: `1px solid ${active ? 'var(--g-accent)' : 'var(--g-border-hi)'}`,
              boxShadow: active
                ? '0 0 0 1px var(--g-accent), 0 18px 44px -16px oklch(0 0 0 / 0.5)'
                : '0 18px 44px -16px oklch(0 0 0 / 0.5)',
              pointerEvents: 'none', // 点击穿透给卡本体（整卡即点击目标，覆层不放按钮）
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <TypeIconTile type={entity.entity_type} emoji={entity.emoji || undefined} size={36} className="" />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: fontVars.base, fontWeight: 600, color: 'var(--g-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {entity.name || '—'}
                </div>
                <div style={{ fontSize: fontVars.xs, color: 'var(--g-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {entity.relation || t(`memory.codex.types.${entity.entity_type}` as Parameters<Tr>[0])}
                </div>
              </div>
            </div>
            <p style={{
              margin: 0, fontSize: fontVars.sm, color: 'var(--g-text-mid)', lineHeight: 1.6,
              display: '-webkit-box', WebkitLineClamp: 8, WebkitBoxOrient: 'vertical', overflow: 'hidden',
            }}>
              {summary}
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 'auto' }}>
              <span style={{ fontSize: fontVars.xs, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)' }}>
                {td('memory.codex.detail.mentions', { n: entity.interaction_count || 0 })}{lastSeen ? ` · ${td('memory.codex.detail.lastSeen', { d: lastSeen })}` : ''}
              </span>
              <span style={{ flex: 1 }} />
              {privacyBadges}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.button>
  );
}
