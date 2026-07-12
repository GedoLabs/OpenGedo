'use client';

// 画像右侧栏（辅助+操作）：此刻的你 / 核心档案 / 完善画像 CTA / 记忆碎片+一键梳理。
// 左主区只留分析类叙事内容；本面板 desktop 渲染为 gedo-aux-sidebar，
// ≤900px 由 MemoryProfileView 塞进右侧 Drawer 复用同一份。
import { useLocale, useTranslations } from 'next-intl';
import type { MemoryStats, MemoryState } from '@/lib/apiClient';
import { IconSpark, IconArrow, IconWand } from '@/app/components/gedo/icons';
import { Pill, ScreenCard, IconLabel, ghostBtnStyle, primaryBtnStyle } from '@/app/components/gedo/primitives';
import { fontVars, text } from '@/app/components/gedo/typography';
import { HeroChip, Fact, MiniStat, trendArrow } from './shared';

export function ProfileSidePanel({
  state, stats, careAbout, bottomLine, northStar, challenges, percent, unfilled,
  lastConsolidated, conflictCount, reorganizing, notice,
  onReorganize, onOpenInbox, onGoTimeline, onImprove,
}: {
  state: MemoryState | null;
  stats: MemoryStats | null;
  careAbout: string | null;
  bottomLine: string | null;
  northStar: string | null;
  challenges: string[];
  percent: number;
  unfilled: string[];
  lastConsolidated: string | null;
  conflictCount: number;
  reorganizing: boolean;
  notice: string | null;
  onReorganize: () => void;
  onOpenInbox?: () => void;
  onGoTimeline?: () => void;
  onImprove: () => void;
}) {
  const t = useTranslations('app');
  const locale = useLocale();

  return (
    <aside className="gedo-aux-sidebar" style={{
      width: 380, flexShrink: 0, minHeight: 0, overflow: 'auto',
      borderLeft: '1px solid var(--g-border)', background: 'var(--g-bg)',
      display: 'flex', flexDirection: 'column', gap: 12, padding: 12,
    }}>
      {/* 此刻的你 */}
      <ScreenCard
        icon={<IconSpark size={14} style={{ color: 'var(--g-accent)' }} />}
        title={t('memory.profile.rightNow')}
        action={state && state.confidence >= 0.1
          ? <span style={{ fontSize: fontVars.xs, color: 'var(--g-text-faint)' }}>{t('memory.profile.rightNowStats', { days: state.window_days, signals: state.signals.length, pct: Math.round(state.confidence * 100) })}</span>
          : undefined}
      >
        {state && state.confidence >= 0.1 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {state.focus?.label && <HeroChip label={t('memory.profile.chips.focus')} value={state.focus.label} />}
              <HeroChip label={t('memory.profile.chips.mode')} value={state.cognitive_mode_label} />
              <HeroChip label={t('memory.profile.chips.energy')} value={state.energy_label} />
              {state.emotion !== 'neutral' && <HeroChip label={t('memory.profile.chips.emotion')} value={state.emotion_label} />}
              {state.momentum?.trend_label && <HeroChip label={t('memory.profile.chips.momentum')} value={`${trendArrow(state.momentum.trend)} ${state.momentum.trend_label}`} />}
            </div>
            {state.active_goal?.title && (
              <div style={{ ...text.bodySm, color: 'var(--g-text-mid)' }}>
                {t('memory.profile.inProgress')}<b style={{ color: 'var(--g-text)' }}>{state.active_goal.title}</b>
                {state.active_goal.progress != null && <span style={{ color: 'var(--g-text-faint)' }}> · {state.active_goal.progress}%</span>}
              </div>
            )}
          </div>
        ) : (
          <p style={{ margin: 0, fontSize: fontVars.xs, color: 'var(--g-text-faint)' }}>{t('memory.profile.rightNowEmpty')}</p>
        )}
      </ScreenCard>

      {/* 核心档案 */}
      <ScreenCard title={t('memory.profile.coreArchiveTitle')} hint={t('memory.profile.coreArchiveHint')} accent="var(--g-dim-memory)" bodyStyle={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Fact label={t('memory.profile.careAbout')} value={careAbout} benefit={t('memory.profile.benefit.careAbout')} />
        <Fact label={t('memory.profile.bottomLine')} value={bottomLine} benefit={t('memory.profile.benefit.bottomLine')} />
        <Fact label={t('memory.profile.vision')} value={northStar} benefit={t('memory.profile.benefit.vision')} />
        {challenges.length > 0 && <Fact label={t('memory.profile.currentChallenges')} value={challenges.slice(0, 3).join('；')} />}
        {(() => {
          // 溯源：对话自动补全的槽位（filled_via='chat'）以 pill 呈现。
          const chatFilled = (stats?.core_slots?.slots ?? []).filter(s => s.filled && (s as { filled_via?: string }).filled_via === 'chat');
          if (chatFilled.length === 0) return null;
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 4, paddingTop: 8, borderTop: '1px dashed var(--g-border)' }}>
              <span style={{ fontSize: fontVars.xs, color: 'var(--g-accent)', padding: '1px 8px', background: 'var(--g-accent-soft)', border: '1px solid var(--g-accent-line)', borderRadius: 999 }}>
                {t('memory.profile.provenanceChat')}
              </span>
              <span style={{ fontSize: fontVars.xs, color: 'var(--g-text-faint)' }}>
                {chatFilled.map(s => s.label).join('、')}
              </span>
            </div>
          );
        })()}
      </ScreenCard>

      {/* 完善画像 CTA（操作类，从 hero 卡挪来） */}
      {percent < 100 && (
        <ScreenCard bodyStyle={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <IconLabel icon={<IconSpark size={14} style={{ color: 'var(--g-accent)' }} />} style={{ alignItems: 'flex-start' }}>
            <span style={{ ...text.bodySm, color: 'var(--g-text-mid)' }}>
              {unfilled.length > 0 ? t('memory.profile.inviteWantsToKnow', { list: unfilled.slice(0, 5).join('、') }) : t('memory.profile.inviteGeneric')}{t('memory.profile.inviteSuffix')}
            </span>
          </IconLabel>
          <button type="button" style={{ ...primaryBtnStyle(true), alignSelf: 'flex-start' }} onClick={onImprove}>{t('memory.profile.snapshotCta')}</button>
        </ScreenCard>
      )}

      {/* 记忆碎片 + 一键梳理（维护动作贴着它维护的原材料） */}
      <ScreenCard
        title={t('memory.profile.memoryFragmentsTitle')}
        badge={<Pill mono>{t('memory.detail.countPill', { count: stats?.total_episodes ?? 0 })}</Pill>}
        action={onGoTimeline && (
          <button type="button" style={{ ...ghostBtnStyle(), fontSize: fontVars.xs, padding: '4px 10px', minHeight: 30 }} onClick={onGoTimeline}>{t('memory.profile.viewAll')} <IconArrow size={11} /></button>
        )}
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <MiniStat label={t('memory.profile.memCountLabel')} value={stats?.total_episodes ?? 0} />
          <MiniStat label={t('memory.profile.pendingLabel')} value={stats?.unconsolidated_episodes ?? 0} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--g-border)' }}>
          <IconLabel icon={<IconWand size={14} style={{ color: 'var(--g-text-muted)' }} />} style={{ flex: 1, minWidth: 140, alignItems: 'flex-start' }}>
            <span>
              <span style={{ ...text.bodySm, color: 'var(--g-text-mid)' }}>{t('memory.profile.reorgTitle')}</span>
              <span style={{ display: 'block', fontSize: fontVars.xs, color: 'var(--g-text-faint)', marginTop: 2 }}>
                {t('memory.profile.reorgHint')}
                {lastConsolidated ? t('memory.profile.reorgLast', { date: new Date(lastConsolidated).toLocaleDateString(locale) }) : ''}
              </span>
            </span>
          </IconLabel>
          {conflictCount > 0 && (
            <button type="button" style={ghostBtnStyle()} onClick={() => onOpenInbox?.()}>
              <Pill tone="accent">{conflictCount}</Pill> {t('memory.profile.pendingConfirm')}
            </button>
          )}
          <button type="button" style={{ ...primaryBtnStyle(true), opacity: reorganizing ? 0.6 : 1 }} onClick={onReorganize} disabled={reorganizing}>
            {reorganizing ? t('memory.profile.reorganizing') : t('memory.profile.reorganize')}
          </button>
        </div>
        {notice && <p style={{ margin: '10px 0 0', fontSize: fontVars.xs, color: 'var(--g-text-muted)' }}>{notice}</p>}
      </ScreenCard>
    </aside>
  );
}
