'use client';

import { fontVars, text } from '../typography';

import { useTranslations } from 'next-intl';
import { Modal } from '@/app/components/gedo/Modal';
import { Pill, ghostBtnStyle } from '@/app/components/gedo/primitives';

export type ApiReview = {
  id: string;
  period_type: 'weekly' | 'monthly';
  period_start?: string;
  period_end?: string;
  summary?: string;
  highlights?: string[];
  lowlights?: string[];
  next_period_focus?: string[];
  ecs_avg?: number;
  completion_rate?: number;
  created_at?: string;
};

export function ReviewDetailModal({
  open, onClose, review, onExport,
}: {
  open: boolean;
  onClose: () => void;
  review: ApiReview | null;
  onExport?: (review: ApiReview) => void;
}) {
  const t = useTranslations('app');
  return (
    <Modal
      open={open}
      onClose={onClose}
      eyebrow={review?.period_type === 'monthly' ? t('insights.reviewModal.eyebrowMonth') : t('insights.reviewModal.eyebrowWeek')}
      title={review ? `${review.period_start ?? ''} → ${review.period_end ?? ''}` : t('insights.reviewModal.title')}
      size="lg"
      footer={
        review && onExport ? (
          <button type="button" style={ghostBtnStyle()} onClick={() => onExport(review)}>
            {t('insights.reviewModal.exportMd')}
          </button>
        ) : null
      }
    >
      {!review ? (
        <p style={{ margin: 0, color: 'var(--g-text-muted)' }}>{t('insights.reviewModal.noData')}</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {(review.ecs_avg !== undefined || review.completion_rate !== undefined) && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {review.ecs_avg !== undefined && <Pill tone="accent">{t('insights.reviewModal.ecsAvg')} {review.ecs_avg}</Pill>}
              {review.completion_rate !== undefined && <Pill tone="exec">{t('insights.reviewModal.completionRate')} {review.completion_rate}%</Pill>}
            </div>
          )}

          {review.summary && (
            <Section title={t('insights.overview')} mono="SUMMARY">
              <p style={{ margin: 0, fontSize: fontVars.sm, color: 'var(--g-text-mid)', lineHeight: 1.65 }}>
                {review.summary}
              </p>
            </Section>
          )}

          {review.highlights?.length ? (
            <Section title={t('insights.highlights')} mono="HIGHLIGHTS" tone="var(--g-accent)">
              <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--g-text-mid)', fontSize: fontVars.sm, lineHeight: 1.7 }}>
                {review.highlights.map((h, i) => <li key={i}>{h}</li>)}
              </ul>
            </Section>
          ) : null}

          {review.lowlights?.length ? (
            <Section title={t('insights.lowlights')} mono="LOWLIGHTS" tone="var(--g-danger)">
              <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--g-text-mid)', fontSize: fontVars.sm, lineHeight: 1.7 }}>
                {review.lowlights.map((h, i) => <li key={i}>{h}</li>)}
              </ul>
            </Section>
          ) : null}

          {review.next_period_focus?.length ? (
            <Section title={t('insights.nextFocus')} mono="NEXT_FOCUS" tone="var(--g-dim-insight)">
              <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--g-text-mid)', fontSize: fontVars.sm, lineHeight: 1.7 }}>
                {review.next_period_focus.map((h, i) => <li key={i}>{h}</li>)}
              </ul>
            </Section>
          ) : null}
        </div>
      )}
    </Modal>
  );
}

function Section({ title, mono, tone, children }: { title: string; mono: string; tone?: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <h3 style={{ margin: 0, fontSize: fontVars.sm, fontWeight: 500, color: tone ?? 'var(--g-text)' }}>{title}</h3>
        <span style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)', letterSpacing: '0.06em' }}>{mono}</span>
      </div>
      {children}
    </div>
  );
}
