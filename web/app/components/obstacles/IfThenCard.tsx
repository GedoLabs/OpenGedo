'use client';

import { fontVars } from '@/app/components/gedo/typography';
// Gedo 设计系统版 —— If-Then 应急卡。颜色全部走 --g-* token；
// 障碍类型色 (info.color) 为分类语义色，保留原 hex。
import { IconBolt, IconCheck } from '@/app/components/gedo/icons';
import { useTranslations } from 'next-intl';
import type { IfThenCard as IfThenCardType } from './types';
import { useObstacleTypeInfo } from '@/app/components/planner/planner-i18n';

interface Props {
  card: IfThenCardType;
  compact?: boolean;
  onDelete?: (id: string) => void;
  onTrigger?: (id: string) => void;
}

export default function IfThenCard({ card, compact = false, onDelete, onTrigger }: Props) {
  const t = useTranslations('app.planner.obstacleLibrary');
  const obstacleInfo = useObstacleTypeInfo();
  const typeInfo = obstacleInfo(card.obstacleType);
  const executeRate = card.triggeredCount > 0
    ? Math.round((card.executedCount / card.triggeredCount) * 100)
    : 0;

  const borderColor = card.triggeredCount === 0
    ? 'var(--g-border)'
    : card.executedCount > 0
    ? 'var(--g-accent-line)'
    : 'color-mix(in oklch, var(--g-warning, #f59e0b) 40%, transparent)';

  const typeBadge = (
    <span style={{ fontSize: fontVars.sm, padding: '2px 8px', borderRadius: 999, background: typeInfo.color + '22', color: typeInfo.color }}>
      {typeInfo.icon} {typeInfo.label}
    </span>
  );

  if (compact) {
    return (
      <div style={{ borderRadius: 10, background: 'var(--g-surface-1)', border: `1px solid ${borderColor}`, padding: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          {typeBadge}
          {card.goalTitle && <span style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)' }}>{card.goalTitle}</span>}
        </div>
        <p style={{ margin: '0 0 4px', fontSize: fontVars.sm, color: 'var(--g-text-muted)', overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
          <span style={{ color: 'var(--g-warning, #f59e0b)', fontWeight: 500 }}>{t('ifLabel')}</span> {card.ifCondition.replace(/^(如果|If|もし)\s*/, '')}
        </p>
        <p style={{ margin: 0, fontSize: fontVars.sm, color: 'var(--g-text)', fontWeight: 400, overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
          <span style={{ color: 'var(--g-accent)', fontWeight: 500 }}>{t('thenLabel')}</span> {card.thenAction.replace(/^(那么|Then|なら)\s*/, '')}
        </p>
      </div>
    );
  }

  return (
    <div style={{ borderRadius: 14, background: 'var(--g-surface-1)', border: `1px solid ${borderColor}`, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '14px 18px 10px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            {typeBadge}
            {card.goalTitle && <span style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{card.goalTitle}</span>}
          </div>
          <p style={{ margin: 0, fontSize: fontVars.sm, color: 'var(--g-text-mid)' }}>{card.obstacleDescription}</p>
        </div>
        {onDelete && (
          <button
            type="button"
            onClick={() => onDelete(card.id)}
            title={t('deleteTitle')}
            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--g-text-faint)', padding: 2, display: 'flex', fontSize: fontVars.sm, lineHeight: 1 }}
          >
            ✕
          </button>
        )}
      </div>

      {/* If-Then Body */}
      <div style={{ padding: '14px 18px', background: 'var(--g-bg-raised)', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Row label={t('ifLabel')} labelColor="var(--g-warning, #f59e0b)" text={card.ifCondition.replace(/^(如果|If|もし)\s*/, '')} />
        <Row label={t('thenLabel')} labelColor="var(--g-accent)" text={card.thenAction.replace(/^(那么|Then|なら)\s*/, '')} strong />
        {card.untilCondition && <Row label="直到" labelColor="var(--g-dim-insight)" text={card.untilCondition} />}
      </div>

      {/* Footer Stats */}
      <div style={{ padding: '10px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', borderTop: '1px solid var(--g-border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', fontSize: fontVars.sm, color: 'var(--g-text-faint)', minWidth: 0 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><IconBolt size={12} /> {t('triggerCount', { n: card.triggeredCount })}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><IconCheck size={12} /> 执行 {card.executedCount} 次</span>
          {card.triggeredCount > 0 && (
            <span style={{ fontWeight: 500, color: executeRate >= 70 ? 'var(--g-accent)' : executeRate >= 40 ? 'var(--g-warning, #f59e0b)' : 'var(--g-danger)' }}>
              执行率 {executeRate}%
            </span>
          )}
        </div>
        {onTrigger && (
          <button
            type="button"
            onClick={() => onTrigger(card.id)}
            style={{ fontSize: fontVars.sm, padding: '4px 12px', background: 'var(--g-accent-soft)', color: 'var(--g-accent)', border: '1px solid var(--g-accent-line)', borderRadius: 8, cursor: 'pointer', fontFamily: 'var(--g-font-sans)' }}
          >
            立即执行
          </button>
        )}
      </div>
    </div>
  );
}

function Row({ label, labelColor, text, strong }: { label: string; labelColor: string; text: string; strong?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 12, minWidth: 0 }}>
      <span style={{ color: labelColor, fontSize: fontVars.sm, fontWeight: 500, whiteSpace: 'nowrap', marginTop: 1, flexShrink: 0 }}>{label}</span>
      <p className="gedo-sidebar-card-text" style={{ margin: 0, fontSize: fontVars.sm, color: strong ? 'var(--g-text)' : 'var(--g-text-mid)', fontWeight: 400, flex: 1, minWidth: 0 }}>{text}</p>
    </div>
  );
}
