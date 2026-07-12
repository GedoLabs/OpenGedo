'use client';

// 画像视图（IA v2 侧栏化改版）：main + gedo-aux-sidebar 布局。
// 左主区=分析类叙事（身份 / 成长叙事 / 人格模型 / 经历 / 生命之花 / 自我认知），
// 右侧栏=辅助与操作（此刻的你 / 核心档案 / 完善画像 / 一键梳理），
// ≤900px 侧栏收进右侧 Drawer（.gedo-aux-sidebar 既有响应式规则）。
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/app/contexts/AuthContext';
import type { MemoryStats, MemoryState, MemoryIdentity, MemoryNarrative, MemoryDimensionAssessment } from '@/lib/apiClient';
import { IconSpark } from '@/app/components/gedo/icons';
import { ScreenCard, ghostBtnStyle } from '@/app/components/gedo/primitives';
import { fontVars, text } from '@/app/components/gedo/typography';
import { Drawer } from '@/app/components/gedo/Drawer';
import { LifeFlowerCard } from '../LifeFlowerCard';
import { SelfInsightCard } from '../SelfInsightCard';
import { knowLevelKey } from '@/app/components/onboarding/quest-schema';
import { Avatar, Ring } from './shared';
import { NarrativeCard } from './NarrativeCard';
import { IdentityCard } from './IdentityCard';
import { ExperienceCard, type Milestone, type Learning } from './ExperienceCard';
import { ProfileSidePanel } from './ProfileSidePanel';

type DimData = { summary?: string; self_score?: number | null; skills?: string[] };

type Profile = {
  core_identity?: {
    name?: string | null;
    profession?: string | null;
    location?: string | null;
    values?: { top_priorities?: string[]; non_negotiables?: string[] };
    vision?: { north_star?: string; five_year?: string };
  };
  semantic_memory?: {
    dimensions?: Record<string, DimData>;
    milestone_events?: Milestone[];
    failure_learnings?: Learning[];
    relationship_map?: { name: string; role?: string }[];
  };
  last_consolidated?: string | null;
};

type Working = {
  active_goals?: { title: string; phase?: string; progress?: number }[];
  current_context?: { focus_domain?: string | null; emotional_state?: string | null; challenges?: string[] };
};

export function MemoryProfileView({ onGoTimeline, onOpenInbox, onGoMemories, onGoCodex, onEvidence }: {
  onGoTimeline?: () => void;
  /** 画像变更确认收敛到统一收件箱（一键梳理产出 / 待确认徽标都跳它） */
  onOpenInbox?: () => void;
  /** 生命之花「看记忆」：跳记忆视图并选中该领域 */
  onGoMemories?: (dim: string) => void;
  /** 经历卡「重要的人 N 位」：跳图鉴 */
  onGoCodex?: () => void;
  /** 「来自这 N 条记忆」证据下钻：跳记忆视图按证据过滤 */
  onEvidence?: (ids: string[], label: string) => void;
}) {
  const { api } = useAuth();
  const t = useTranslations('app');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [working, setWorking] = useState<Working | null>(null);
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [state, setState] = useState<MemoryState | null>(null);
  const [identity, setIdentity] = useState<MemoryIdentity | null>(null);
  const [narrative, setNarrative] = useState<MemoryNarrative | null>(null);
  const [dimAssessment, setDimAssessment] = useState<MemoryDimensionAssessment | null>(null);
  const [narrativeWindow, setNarrativeWindow] = useState<7 | 30 | 90>(30);
  const [loading, setLoading] = useState(true);
  const [reorganizing, setReorganizing] = useState(false);
  const [conflictCount, setConflictCount] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [sideOpen, setSideOpen] = useState(false);

  const load = useCallback(() => {
    let cancelled = false;
    Promise.all([
      api.getMemoryProfile().catch(() => null),
      api.getMemoryWorking().catch(() => null),
      api.getMemoryStats().catch(() => null),
      api.getMemoryConflicts().catch(() => ({ conflicts: [] })),
      api.getMemoryState().catch(() => null),
      api.getMemoryIdentity().catch(() => null),
      api.getMemoryNarrative(30).catch(() => null),
      api.getMemoryDimensions().catch(() => null),
    ]).then(([p, w, s, c, st, id, nr, da]) => {
      if (cancelled) return;
      setProfile(p as Profile | null);
      setWorking(w as Working | null);
      setStats(s);
      setConflictCount((c as { conflicts?: unknown[] })?.conflicts?.length ?? 0);
      setState(st as MemoryState | null);
      setIdentity(id as MemoryIdentity | null);
      setNarrative(nr as MemoryNarrative | null);
      setDimAssessment(da as MemoryDimensionAssessment | null);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [api]);

  useEffect(() => load(), [load]);

  const handleReorganize = async () => {
    if (reorganizing) return;
    setReorganizing(true);
    setNotice(null);
    try {
      const r = await api.reorganizeMemory();
      const auto = r.autoApplied ? t('memory.profile.reorgDoneUpdated') : t('memory.profile.reorgDoneNoChange');
      if (r.pendingConflicts > 0) {
        setNotice(t('memory.profile.reorgNoticeConflicts', { auto, n: r.pendingConflicts }));
        onOpenInbox?.();
      } else {
        setNotice(t('memory.profile.reorgNoticeDone', { auto, offline: r.llm_unavailable ? t('memory.profile.offlineSuffix') : '' }));
      }
      load();
    } catch (e: unknown) {
      setNotice(e instanceof Error ? t('memory.profile.reorgFailedDetail', { msg: e.message }) : t('memory.profile.reorgFailed'));
    } finally {
      setReorganizing(false);
    }
  };

  const launchOnboarding = () => {
    try { window.dispatchEvent(new CustomEvent('gedo:open-onboarding')); } catch { /* ignore */ }
  };

  const changeNarrativeWindow = async (w: 7 | 30 | 90) => {
    setNarrativeWindow(w);
    try { setNarrative(await api.getMemoryNarrative(w)); } catch { /* keep previous */ }
  };

  const ci = profile?.core_identity ?? {};
  const sm = profile?.semantic_memory ?? {};
  const ctx = working?.current_context ?? {};
  const dims = useMemo(() => profile?.semantic_memory?.dimensions ?? {}, [profile]);
  const percent = stats?.core_slots?.percent ?? 0;
  const unfilled = (stats?.core_slots?.slots ?? []).filter(s => !s.filled).map(s => s.label);
  const northStar = ci.vision?.north_star || ci.vision?.five_year || '';

  // overall = AI 评估有分维度的均值（Dimension Engine 产物），不再用自评均值
  const overall = dimAssessment?.overall?.score ?? null;

  if (loading) {
    return (
      <main style={mainStyle}>
        <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--g-text-faint)', fontSize: fontVars.sm }}>{t('memory.profile.loading')}</div>
      </main>
    );
  }

  const sidePanel = (
    <ProfileSidePanel
      state={state}
      stats={stats}
      careAbout={(ci.values?.top_priorities?.length ?? 0) > 0 ? ci.values!.top_priorities!.slice(0, 3).join('；') : null}
      bottomLine={(ci.values?.non_negotiables?.length ?? 0) > 0 ? ci.values!.non_negotiables!.slice(0, 3).join('；') : null}
      northStar={northStar || null}
      challenges={ctx.challenges ?? []}
      percent={percent}
      unfilled={unfilled}
      lastConsolidated={profile?.last_consolidated ?? null}
      conflictCount={conflictCount}
      reorganizing={reorganizing}
      notice={notice}
      onReorganize={handleReorganize}
      onOpenInbox={onOpenInbox}
      onGoTimeline={onGoTimeline}
      onImprove={launchOnboarding}
    />
  );

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0 }}>
      {/* ≤900px：侧栏收进右侧 Drawer，这里给入口 */}
      <div className="gedo-mobile-toolbar gedo-mobile-only">
        <button type="button" style={{ ...ghostBtnStyle(), flex: 1, justifyContent: 'center' }} onClick={() => setSideOpen(true)}>
          <IconSpark size={14} /> {t('memory.profile.sidebar.open')}
        </button>
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <main style={mainStyle}>
          <div className="gedo-content-padded" style={{ width: '100%', padding: '24px 32px 32px', display: 'flex', flexDirection: 'column', gap: 12 }}>

            {/* ── 1. 身份区（分析首屏：我是谁 + AI 眼中的我 + 了解度）── */}
            <ScreenCard>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                <Avatar name={ci.name} />
                <div style={{ flex: 1, minWidth: 180 }}>
                  <h2 style={{ margin: 0, ...text.title }}>{ci.name || t('memory.profile.defaultName')}</h2>
                  <div style={{ ...text.bodySm, color: 'var(--g-text-muted)', marginTop: 3 }}>
                    {[ci.profession, ci.location].filter(Boolean).join(' · ') || t('memory.profile.gettingToKnow')}
                  </div>
                  {northStar && (
                    <div style={{ ...text.bodySm, color: 'var(--g-text-mid)', marginTop: 6, fontStyle: 'italic' }}>{t('memory.profile.northStar', { value: northStar })}</div>
                  )}
                  {(narrative?.stage || narrative?.summary) && (
                    <div style={{ ...text.bodySm, color: 'var(--g-text-mid)', marginTop: 6 }}>
                      {t('memory.profile.aiSeesYou')}
                      <b style={{ color: 'var(--g-text)' }}>{narrative.stage || ''}</b>
                      {narrative.summary ? `${narrative.stage ? ' — ' : ''}${String(narrative.summary).split('。')[0]}` : ''}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                  <Ring percent={percent} />
                  <span style={{ fontSize: fontVars.xs, fontWeight: 600, color: 'var(--g-accent)' }}>
                    {t(`memory.knowLevels.${knowLevelKey(percent)}` as Parameters<typeof t>[0])}
                  </span>
                </div>
              </div>
            </ScreenCard>

            {/* ── 2. 成长叙事 ── */}
            <NarrativeCard narrative={narrative} window={narrativeWindow} onWindow={changeNarrativeWindow} onEvidence={onEvidence} />

            {/* ── 3. 人格模型 ── */}
            <IdentityCard identity={identity} onEvidence={onEvidence} />

            {/* ── 4. 经历：里程碑时间线 + 经验教训 + 重要的人入口 ── */}
            <ExperienceCard
              milestones={sm.milestone_events ?? []}
              learnings={sm.failure_learnings ?? []}
              peopleCount={sm.relationship_map?.length ?? 0}
              onGoCodex={onGoCodex}
              onReorganize={handleReorganize}
              reorganizing={reorganizing}
            />

            {/* ── 5. 生命之花：AI 评估主实线 + 自评虚线对比；点维度看解读 ── */}
            <ScreenCard
              title={t('memory.profile.lifeFlowerTab')}
              action={
                <span style={{ fontSize: fontVars.xs, color: 'var(--g-text-faint)' }}>
                  {overall != null ? t.rich('memory.profile.overallScore', { score: overall, b: (chunks) => <b style={{ color: 'var(--g-text)', fontFamily: 'var(--g-font-mono)' }}>{chunks}</b> }) : t('memory.flowerCard.aiEmptyShort')}
                </span>
              }
            >
              <LifeFlowerCard
                assessment={dimAssessment}
                dims={dims}
                onGoMemories={(k) => onGoMemories?.(k)}
                onEvidence={onEvidence}
              />
            </ScreenCard>

            {/* ── 6. 自我认知报告（证据驱动、非临床；了解度达标解锁）── */}
            <SelfInsightCard />
          </div>
        </main>

        {sidePanel}
      </div>

      <Drawer open={sideOpen} onClose={() => setSideOpen(false)} title={t('memory.profile.sidebar.title')} side="right" width={340}>
        <div className="gedo-drawer-inner" style={{ height: '100%', display: 'flex' }}>
          {sidePanel}
        </div>
      </Drawer>
    </div>
  );
}

const mainStyle: React.CSSProperties = {
  flex: 1, minWidth: 0, overflow: 'auto', background: 'var(--g-bg)',
};
