'use client';

import { fontVars } from '@/app/components/gedo/typography';
import { useTranslations } from 'next-intl';
import { Brain, Tag } from 'lucide-react';
import type { MemoryListCard } from '@/lib/genui/schemas';

export default function MemoryListCard({ card }: { card: MemoryListCard }) {
  const t = useTranslations('app');
  return (
    <div
      style={{
        width: '100%',
        maxWidth: 380,
        padding: 14,
        borderRadius: 12,
        background: 'var(--g-surface-1)',
        border: '1px solid var(--g-border)',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        fontFamily: 'var(--g-font-sans)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: fontVars.sm,
          fontWeight: 500,
          color: 'var(--g-text-faint)',
          fontFamily: 'var(--g-font-mono)',
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
        }}
      >
        <Brain style={{ width: 14, height: 14, color: 'var(--g-dim-memory)' }} />
        {card.title ?? t('companion.cards.memoryList.fallbackTitle')}
        {card.query && (
          <span style={{ marginLeft: 'auto', textTransform: 'none', fontWeight: 400, color: 'var(--g-text-muted)' }}>
            「{card.query}」
          </span>
        )}
      </div>

      <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {card.items.map((item, i) => (
          <li key={i} style={{ display: 'flex', gap: 8, fontSize: fontVars.sm }}>
            <div
              style={{
                width: 3,
                flexShrink: 0,
                borderRadius: 2,
                background: 'color-mix(in oklch, var(--g-dim-memory) 60%, transparent)',
                marginTop: 4,
                alignSelf: 'stretch',
              }}
            />
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <p
                style={{
                  margin: 0,
                  color: 'var(--g-text)',
                  lineHeight: 1.45,
                  display: '-webkit-box',
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                {item.content}
              </p>
              {item.tags && item.tags.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {item.tags.slice(0, 4).map((t, j) => (
                    <span
                      key={j}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 2,
                        fontSize: fontVars.sm,
                        color: 'var(--g-text-muted)',
                        background: 'var(--g-bg-raised)',
                        borderRadius: 6,
                        padding: '1px 6px',
                        border: '1px solid var(--g-border)',
                      }}
                    >
                      <Tag style={{ width: 10, height: 10 }} />{t}
                    </span>
                  ))}
                </div>
              )}
              {item.created_at && (
                <span style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)' }}>
                  {new Date(item.created_at).toLocaleDateString('zh-CN')}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
