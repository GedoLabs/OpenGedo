'use client';

// 设置弹窗：在应用外壳里挂一次，从任意界面打开，无需跳转到 /app/settings 路由。
// 复用 SettingsPanel（variant="modal"）——路由页与弹窗同一份 UI。
import { useEffect } from 'react';
import { SettingsPanel } from './SettingsPanel';
import type { SettingsSectionId } from './AccountSectionNav';

export function SettingsModal({
  open,
  onClose,
  initialSection,
}: {
  open: boolean;
  onClose: () => void;
  initialSection?: SettingsSectionId;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'oklch(0 0 0 / 0.55)',
        backdropFilter: 'blur(2px)',
        WebkitBackdropFilter: 'blur(2px)',
        padding: 'clamp(8px, 4vh, 48px) 12px',
        overflowY: 'auto',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 1040,
          height: 'min(88vh, 760px)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          background: 'var(--g-bg)',
          border: '1px solid var(--g-border)',
          borderRadius: 16,
          boxShadow: '0 24px 60px -24px oklch(0 0 0 / 0.5)',
        }}
      >
        <SettingsPanel variant="modal" onClose={onClose} initialSection={initialSection} />
      </div>
    </div>
  );
}
