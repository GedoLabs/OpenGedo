'use client';

import { fontVars } from '@/app/components/gedo/typography';
// Gedo 设计系统版 —— If-Then 卡片库（视图切换 + 类型筛选 + 分组）。
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { IfThenCard as IfThenCardType, ObstacleType } from './types';
import { OBSTACLE_TYPE_META } from './types';
import { useObstacleTypeInfo } from '@/app/components/planner/planner-i18n';
import IfThenCard from './IfThenCard';

interface Props {
  cards: IfThenCardType[];
  onDelete?: (id: string) => void;
  onTrigger?: (id: string) => void;
  filterGoalId?: string;
}

type ViewMode = 'by_goal' | 'by_type';

export default function ObstacleLibrary({ cards, onDelete, onTrigger, filterGoalId }: Props) {
  const t = useTranslations('app.planner.obstacleLibrary');
  const obstacleInfo = useObstacleTypeInfo();
  const obstacleTypes = Object.keys(OBSTACLE_TYPE_META) as ObstacleType[];
  const [viewMode, setViewMode] = useState<ViewMode>('by_goal');
  const [selectedType, setSelectedType] = useState<ObstacleType | null>(null);

  const filteredCards = cards
    .filter(c => !filterGoalId || c.goalId === filterGoalId)
    .filter(c => !selectedType || c.obstacleType === selectedType)
    .filter(c => c.status === 'active');

  const typeCount = (type: ObstacleType) => cards.filter(c => c.obstacleType === type && c.status === 'active').length;

  const groupedByGoal = filteredCards.reduce((acc, card) => {
    const key = card.goalTitle || card.goalId;
    if (!acc[key]) acc[key] = [];
    acc[key].push(card);
    return acc;
  }, {} as Record<string, IfThenCardType[]>);

  const groupedByType = filteredCards.reduce((acc, card) => {
    if (!acc[card.obstacleType]) acc[card.obstacleType] = [];
    acc[card.obstacleType].push(card);
    return acc;
  }, {} as Record<string, IfThenCardType[]>);

  const segBtn = (active: boolean) => ({
    padding: '4px 12px',
    border: 'none',
    background: active ? 'var(--g-surface-2)' : 'transparent',
    color: active ? 'var(--g-text)' : 'var(--g-text-muted)',
    borderRadius: 6,
    fontSize: fontVars.sm,
    cursor: 'pointer',
    fontFamily: 'var(--g-font-sans)',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', background: 'var(--g-surface-1)', border: '1px solid var(--g-border)', borderRadius: 8, padding: 2 }}>
          <button type="button" onClick={() => setViewMode('by_goal')} style={segBtn(viewMode === 'by_goal')}>{t('byGoal')}</button>
          <button type="button" onClick={() => setViewMode('by_type')} style={segBtn(viewMode === 'by_type')}>{t('byType')}</button>
        </div>
        <span style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)' }}>{t('cardCount', { n: filteredCards.length })}</span>
      </div>

      {/* Type Filter Pills */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button
          type="button"
          onClick={() => setSelectedType(null)}
          style={{
            padding: '4px 10px', fontSize: fontVars.sm, borderRadius: 999, cursor: 'pointer', fontFamily: 'var(--g-font-sans)',
            border: '1px solid var(--g-border)',
            background: !selectedType ? 'var(--g-surface-2)' : 'transparent',
            color: !selectedType ? 'var(--g-text)' : 'var(--g-text-muted)',
          }}
        >
          {t('all')}
        </button>
        {obstacleTypes.map(type => {
          const info = obstacleInfo(type);
          const count = typeCount(type);
          if (count === 0) return null;
          const active = selectedType === type;
          return (
            <button
              key={type}
              type="button"
              onClick={() => setSelectedType(active ? null : type)}
              style={{
                padding: '4px 10px', fontSize: fontVars.sm, borderRadius: 999, cursor: 'pointer', fontFamily: 'var(--g-font-sans)',
                display: 'flex', alignItems: 'center', gap: 4,
                border: `1px solid ${active ? info.color + '55' : 'var(--g-border)'}`,
                background: active ? info.color + '22' : 'transparent',
                color: active ? info.color : 'var(--g-text-muted)',
              }}
            >
              {info.icon} {info.label} ({count})
            </button>
          );
        })}
      </div>

      {/* Cards */}
      {filteredCards.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--g-text-faint)' }}>
          <p style={{ margin: 0, fontSize: fontVars.sm, color: 'var(--g-text-muted)' }}>{t('emptyTitle')}</p>
          <p style={{ margin: '4px 0 0', fontSize: fontVars.sm }}>{t('emptyHint')}</p>
        </div>
      ) : viewMode === 'by_goal' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          {Object.entries(groupedByGoal).map(([goalTitle, goalCards]) => (
            <div key={goalTitle}>
              <h4 style={{ margin: '0 0 12px', fontSize: fontVars.sm, fontWeight: 500, color: 'var(--g-text-mid)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--g-accent)' }} />
                {goalTitle}
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {goalCards.map(card => (
                  <IfThenCard key={card.id} card={card} onDelete={onDelete} onTrigger={onTrigger} />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          {Object.entries(groupedByType).map(([type, typeCards]) => {
            const info = obstacleInfo(type as ObstacleType);
            return (
              <div key={type}>
                <h4 style={{ margin: '0 0 12px', fontSize: fontVars.sm, fontWeight: 500, color: info.color, display: 'flex', alignItems: 'center', gap: 8 }}>
                  {info.icon} {info.label}
                  <span style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)' }}>({typeCards.length})</span>
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {typeCards.map(card => (
                    <IfThenCard key={card.id} card={card} onDelete={onDelete} onTrigger={onTrigger} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
