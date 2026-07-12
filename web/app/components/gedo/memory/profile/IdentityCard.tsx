'use client';

// P3: 动态人格模型卡（含"为什么变"解释）。拆自 MemoryProfileView。
import { useTranslations } from 'next-intl';
import type { MemoryIdentity } from '@/lib/apiClient';
import { IconSpark } from '@/app/components/gedo/icons';
import { Pill } from '@/app/components/gedo/primitives';
import { fontVars } from '@/app/components/gedo/typography';
import { EvidenceLink, HeroChip } from './shared';

function TraitRow({ label, items, tone }: { label: string; items: string[]; tone: 'insight' | 'goal' | 'neutral' }) {
  if (!items?.length) return null;
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 6, flexWrap: 'wrap' }}>
      <span style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)', minWidth: 48 }}>{label}</span>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {items.slice(0, 6).map((item, i) => <Pill key={i} tone={tone}>{item}</Pill>)}
      </div>
    </div>
  );
}

export function IdentityCard({ identity, onEvidence }: { identity: MemoryIdentity | null; onEvidence?: (ids: string[], label: string) => void }) {
  const t = useTranslations('app');
  const m = identity?.model;
  const lowData = !identity || (identity.confidence?.overall ?? 0) < 0.1 || (!m?.strengths?.length && !m?.weaknesses?.length);
  return (
    <section style={{ background: 'var(--g-bg-raised)', border: '1px solid var(--g-border)', borderRadius: 16, padding: '16px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <IconSpark size={14} style={{ color: 'var(--g-dim-insight)' }} />
        <span style={{ fontSize: fontVars.base, fontWeight: 600 }}>{t('memory.profile.identity.title')}</span>
        {identity && (
          <span style={{ marginLeft: 'auto', fontSize: fontVars.xs, color: 'var(--g-text-faint)' }}>
            {t('memory.profile.identity.version', { v: identity.version, pct: Math.round((identity.confidence?.overall ?? 0) * 100) })}
          </span>
        )}
      </div>
      {lowData ? (
        <p style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)', margin: 0 }}>{t('memory.profile.identity.empty')}</p>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <HeroChip label={t('memory.profile.identity.growthStage')} value={m!.growth_stage_label} />
            <HeroChip label={t('memory.profile.identity.decisionStyle')} value={m!.decision_style_label} />
            <HeroChip label={t('memory.profile.identity.riskTendency')} value={m!.risk_tendency_label} />
          </div>
          <TraitRow label={t('memory.profile.identity.strengths')} items={(m!.strengths || []).map(s => s.label)} tone="insight" />
          <TraitRow label={t('memory.profile.identity.weaknesses')} items={(m!.weaknesses || []).map(s => s.label)} tone="goal" />
          <TraitRow label={t('memory.profile.identity.goalPrefs')} items={m!.goal_preferences || []} tone="neutral" />
          {m!.summary && <p style={{ fontSize: fontVars.sm, color: 'var(--g-text-mid)', lineHeight: 1.7, margin: '8px 0 0' }}>{m!.summary}</p>}
          {(identity!.changes?.length ?? 0) > 0 && identity!.changes[0] !== '无显著变化' && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--g-border)' }}>
              <div style={{ fontSize: fontVars.sm, fontWeight: 600, color: 'var(--g-text-muted)', marginBottom: 4 }}>{t('memory.profile.identity.recentChanges')}</div>
              <ul style={{ margin: 0, paddingLeft: 16, fontSize: fontVars.sm, color: 'var(--g-text-mid)', lineHeight: 1.7 }}>
                {identity!.changes.slice(0, 3).map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            </div>
          )}
          <EvidenceLink
            ids={identity!.evidence_episode_ids}
            label={t('memory.profile.identity.title')}
            onEvidence={onEvidence}
          />
        </>
      )}
    </section>
  );
}
