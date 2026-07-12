'use client';

import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { iconBtnStyle } from './primitives';
import { text } from './typography';

/**
 * Right-side slide-over drawer. Used for the proactive notifications panel
 * and the historical context-artifact stream. Same token surface as Modal.
 */
export function Drawer({
  open,
  onClose,
  title,
  eyebrow,
  width = 380,
  children,
  footer,
  side = 'right',
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  eyebrow?: ReactNode;
  width?: number;
  children: ReactNode;
  footer?: ReactNode;
  side?: 'right' | 'left';
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const t = useTranslations('app');

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  const onBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      onMouseDown={onBackdrop}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        background: 'color-mix(in oklch, var(--g-bg) 50%, oklch(0 0 0 / 0.4))',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        display: 'flex',
        justifyContent: side === 'right' ? 'flex-end' : 'flex-start',
        animation: 'gedoFadeIn 0.14s ease-out',
      }}
    >
      <style>{`
        @keyframes gedoFadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes gedoSlideRight { from { transform: translateX(100%) } to { transform: none } }
        @keyframes gedoSlideLeft  { from { transform: translateX(-100%) } to { transform: none } }
      `}</style>
      <div
        ref={panelRef}
        style={{
          width,
          maxWidth: '92vw',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--g-bg-raised)',
          borderLeft: side === 'right' ? '1px solid var(--g-border)' : 'none',
          borderRight: side === 'left' ? '1px solid var(--g-border)' : 'none',
          fontFamily: 'var(--g-font-sans)',
          color: 'var(--g-text)',
          boxShadow: side === 'right'
            ? '-30px 0 60px -20px oklch(0 0 0 / 0.35)'
            : '30px 0 60px -20px oklch(0 0 0 / 0.35)',
          animation: `${side === 'right' ? 'gedoSlideRight' : 'gedoSlideLeft'} 0.22s cubic-bezier(0.16, 1, 0.3, 1)`,
        }}
      >
        {(title || eyebrow) && (
          <div
            style={{
              flexShrink: 0,
              padding: '18px 20px 14px',
              borderBottom: '1px solid var(--g-border)',
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 16,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              {eyebrow && (
                <div
                  style={{
                    ...text.mono,
                    color: 'var(--g-text-faint)',
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    marginBottom: 6,
                  }}
                >
                  {eyebrow}
                </div>
              )}
              {title && (
                <h2 style={{ margin: 0, ...text.title }}>
                  {title}
                </h2>
              )}
            </div>
            <button
              type="button"
              aria-label={t('common.close')}
              onClick={onClose}
              style={{ ...iconBtnStyle(), color: 'var(--g-text-muted)', flexShrink: 0 }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="m6 6 12 12M6 18 18 6" />
              </svg>
            </button>
          </div>
        )}

        <div style={{ flex: 1, overflow: 'auto' }}>
          {children}
        </div>

        {footer && (
          <div
            style={{
              flexShrink: 0,
              padding: '14px 20px',
              borderTop: '1px solid var(--g-border)',
              background: 'var(--g-surface-1)',
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
