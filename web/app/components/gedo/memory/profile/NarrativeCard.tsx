'use client';

// P4: 成长轨迹叙事卡（窗口可切 7/30/90）。拆自 MemoryProfileView。
import { useTranslations } from 'next-intl';
import type { MemoryNarrative } from '@/lib/apiClient';
import { IconSpark } from '@/app/components/gedo/icons';
import { fontVars } from '@/app/components/gedo/typography';
import { EvidenceLink } from './shared';

function winChipStyle(active: boolean): React.CSSProperties {
  return {
    fontSize: fontVars.sm, padding: '2px 9px', borderRadius: 999, cursor: 'pointer',
    border: `1px solid ${active ? 'var(--g-accent-line)' : 'var(--g-border)'}`,
    background: active ? 'var(--g-accent-soft)' : 'transparent',
    color: active ? 'var(--g-accent)' : 'var(--g-text-muted)',
  };
}

function NarrSection({ label, items, color }: { label: string; items: string[]; color: string }) {
  if (!items?.length) return null;
  return (
    <div>
      <div style={{ fontSize: fontVars.sm, fontWeight: 600, color, marginBottom: 4 }}>{label}</div>
      <ul style={{ margin: 0, paddingLeft: 16, fontSize: fontVars.sm, color: 'var(--g-text-mid)', lineHeight: 1.7 }}>
        {items.slice(0, 4).map((t, i) => <li key={i}>{t}</li>)}
      </ul>
    </div>
  );
}

export function NarrativeCard({ narrative, window, onWindow, onEvidence }: { narrative: MemoryNarrative | null; window: 7 | 30 | 90; onWindow: (w: 7 | 30 | 90) => void; onEvidence?: (ids: string[], label: string) => void }) {
  const t = useTranslations('app');
  const wins: (7 | 30 | 90)[] = [7, 30, 90];
  return (
    <section style={{ background: 'var(--g-bg-raised)', border: '1px solid var(--g-border)', borderRadius: 16, padding: '16px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        <IconSpark size={14} style={{ color: 'var(--g-dim-goal)' }} />
        <span style={{ fontSize: fontVars.base, fontWeight: 600 }}>{t('memory.profile.narrative.title')}</span>
        <div style={{ display: 'flex', gap: 4, marginLeft: 6 }}>
          {wins.map(w => (
            <button key={w} type="button" onClick={() => onWindow(w)} style={winChipStyle(window === w)}>{w}{t('memory.profile.narrative.windowSuffix')}</button>
          ))}
        </div>
        {narrative && (
          <span style={{ marginLeft: 'auto', fontSize: fontVars.xs, color: 'var(--g-text-faint)' }}>
            {t('memory.profile.narrative.confidence', { pct: Math.round((narrative.confidence ?? 0) * 100), ai: narrative.method === 'llm' ? t('memory.profile.narrative.aiSuffix') : '' })}
          </span>
        )}
      </div>
      {!narrative ? (
        <p style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)', margin: 0 }}>{t('memory.profile.narrative.empty')}</p>
      ) : (
        <>
          <div style={{ fontSize: fontVars.base, fontWeight: 600, color: 'var(--g-text)' }}>{narrative.stage}</div>
          {narrative.summary && <p style={{ fontSize: fontVars.sm, color: 'var(--g-text-mid)', lineHeight: 1.7, margin: '6px 0 12px' }}>{narrative.summary}</p>}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <NarrSection label={t('memory.profile.narrative.changes')} items={narrative.changes} color="var(--g-dim-goal)" />
            <NarrSection label={t('memory.profile.narrative.nextSteps')} items={narrative.next_steps} color="var(--g-accent)" />
            <NarrSection label={t('memory.profile.narrative.risks')} items={narrative.risks} color="#e0a458" />
            <NarrSection label={t('memory.profile.narrative.opportunities')} items={narrative.opportunities} color="var(--g-dim-insight)" />
          </div>
          <EvidenceLink
            ids={narrative.evidence_episode_ids}
            label={t('memory.profile.narrative.title')}
            onEvidence={onEvidence}
          />
        </>
      )}
    </section>
  );
}
