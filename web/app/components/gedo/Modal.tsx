'use client';

import { useEffect, useRef } from 'react';
import type { ReactNode, CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import { iconBtnStyle } from './primitives';
import { text } from './typography';

type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

const SIZE_WIDTH: Record<ModalSize, number> = {
  sm: 380,
  md: 540,
  lg: 720,
  xl: 920,
};

/**
 * Shared modal shell for the redesigned UI.
 * - Backdrop click + Escape close
 * - Title bar with optional eyebrow + close button
 * - Scrollable body
 * - Optional fixed bottom action bar
 * All colors via var(--g-*) tokens — theme & accent independent.
 */
export function Modal({
  open,
  onClose,
  title,
  eyebrow,
  size = 'md',
  children,
  footer,
  contentStyle,
  closeOnBackdrop = true,
  showClose = true,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  eyebrow?: ReactNode;
  size?: ModalSize;
  children: ReactNode;
  footer?: ReactNode;
  contentStyle?: CSSProperties;
  closeOnBackdrop?: boolean;
  showClose?: boolean;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const t = useTranslations('app');

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    // Lock body scroll while modal is open.
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  const onBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!closeOnBackdrop) return;
    if (cardRef.current && !cardRef.current.contains(e.target as Node)) onClose();
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
        background: 'color-mix(in oklch, var(--g-bg) 60%, oklch(0 0 0 / 0.55))',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '40px 20px',
        animation: 'gedoFadeIn 0.16s ease-out',
      }}
    >
      <style>{`
        @keyframes gedoFadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes gedoSlideIn { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }
      `}</style>
      <div
        ref={cardRef}
        style={{
          width: '100%',
          maxWidth: SIZE_WIDTH[size],
          maxHeight: 'calc(100vh - 80px)',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--g-bg-raised)',
          border: '1px solid var(--g-border)',
          borderRadius: 16,
          boxShadow: '0 30px 80px -20px oklch(0 0 0 / 0.5)',
          fontFamily: 'var(--g-font-sans)',
          color: 'var(--g-text)',
          overflow: 'hidden',
          animation: 'gedoSlideIn 0.18s ease-out',
        }}
      >
        {(title || eyebrow || showClose) && (
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
            {showClose && (
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
            )}
          </div>
        )}

        <div
          style={{
            flex: 1,
            overflow: 'auto',
            padding: '18px 20px',
            ...contentStyle,
          }}
        >
          {children}
        </div>

        {footer && (
          <div
            style={{
              flexShrink: 0,
              padding: '14px 20px',
              borderTop: '1px solid var(--g-border)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: 8,
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
