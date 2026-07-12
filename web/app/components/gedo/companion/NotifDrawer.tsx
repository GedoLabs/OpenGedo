'use client';

import { fontVars, text } from '../typography';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/app/contexts/AuthContext';
import type { ProactiveMessage } from '@/lib/apiClient';
import { Drawer } from '@/app/components/gedo/Drawer';
import { Pill, primaryBtnStyle, ghostBtnStyle } from '@/app/components/gedo/primitives';
import { IconBell, IconCheck, IconClock, IconMemory, IconTarget, IconSpark } from '@/app/components/gedo/icons';

/**
 * Proactive notifications drawer. Lists messages from
 * GET /v1/proactive/messages and lets the user accept / dismiss / snooze.
 */
export function NotifDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { api } = useAuth();
  const t = useTranslations('app');
  const [items, setItems] = useState<ProactiveMessage[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const id = setTimeout(() => { if (!cancelled) setLoading(true); }, 0);
    api.listProactiveMessages()
      .then(r => { if (!cancelled) setItems(r?.items ?? []); })
      .catch(() => { if (!cancelled) setItems([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; clearTimeout(id); };
  }, [api, open]);

  const handleFeedback = useCallback(
    async (id: string, feedback: 'accepted' | 'dismissed' | 'snoozed', snoozeMinutes?: number) => {
      try {
        await api.proactiveFeedback(id, { feedback, snooze_minutes: snoozeMinutes });
        setItems(prev => prev.map(m => m.id === id ? { ...m, feedback } : m));
      } catch { /* swallow */ }
    },
    [api]
  );

  const pending = items.filter(m => !m.feedback);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      eyebrow={t('companion.notif.eyebrow')}
      title={pending.length > 0 ? t('companion.notif.titlePending', { n: pending.length }) : t('companion.notif.titleEmpty')}
      width={400}
    >
      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {loading && items.length === 0 && (
          <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--g-text-faint)', fontSize: fontVars.sm, fontFamily: 'var(--g-font-mono)' }}>
            {t('companion.notif.loading')}
          </div>
        )}
        {!loading && items.length === 0 && (
          <div
            style={{
              padding: '32px 16px',
              textAlign: 'center',
              color: 'var(--g-text-faint)',
              fontSize: fontVars.sm,
              border: '1px dashed var(--g-border)',
              borderRadius: 12,
            }}
          >
            <IconBell size={24} style={{ color: 'var(--g-text-faint)', display: 'block', margin: '0 auto 8px' }} />
            {t('companion.notif.emptyBody')}
          </div>
        )}
        {items.map(m => (
          <NotifItem key={m.id} msg={m} onFeedback={handleFeedback} />
        ))}
      </div>
    </Drawer>
  );
}

function NotifItem({
  msg, onFeedback,
}: {
  msg: ProactiveMessage;
  onFeedback: (id: string, feedback: 'accepted' | 'dismissed' | 'snoozed', mins?: number) => void;
}) {
  const t = useTranslations('app');
  const settled = !!msg.feedback;
  const config = TYPE_CONFIG[msg.type] ?? TYPE_CONFIG.default;
  return (
    <article
      style={{
        padding: 14,
        background: 'var(--g-surface-1)',
        border: '1px solid var(--g-border)',
        borderRadius: 12,
        opacity: settled ? 0.55 : 1,
        display: 'flex',
        gap: 12,
      }}
    >
      <span
        style={{
          width: 28,
          height: 28,
          borderRadius: 8,
          background: `color-mix(in oklch, ${config.color} 14%, transparent)`,
          border: `1px solid color-mix(in oklch, ${config.color} 32%, transparent)`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: config.color,
          flexShrink: 0,
        }}
      >
        <config.Icon size={14} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
          <span style={{ fontSize: fontVars.sm, color: 'var(--g-text)', fontWeight: 500 }}>{msg.title}</span>
          {settled && (
            <Pill tone={msg.feedback === 'accepted' ? 'accent' : 'neutral'}>
              {msg.feedback === 'accepted' ? t('companion.notif.accepted') : msg.feedback === 'snoozed' ? t('companion.notif.snoozed') : t('companion.notif.dismissed')}
            </Pill>
          )}
        </div>
        <p style={{ margin: 0, fontSize: fontVars.sm, color: 'var(--g-text-mid)', lineHeight: 1.55 }}>{msg.body}</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)' }}>
            {formatTime(msg.created_at, t)}
          </span>
          {!settled && (
            <>
              <div style={{ flex: 1 }} />
              <button
                type="button"
                style={{ ...ghostBtnStyle(), fontSize: fontVars.sm, padding: '4px 10px' }}
                onClick={() => onFeedback(msg.id, 'snoozed', 60)}
              >
                {t('companion.notif.snooze')}
              </button>
              <button
                type="button"
                style={{ ...ghostBtnStyle(), fontSize: fontVars.sm, padding: '4px 10px' }}
                onClick={() => onFeedback(msg.id, 'dismissed')}
              >
                {t('companion.notif.ignore')}
              </button>
              <button
                type="button"
                style={{ ...primaryBtnStyle(true), padding: '4px 12px' }}
                onClick={() => onFeedback(msg.id, 'accepted')}
              >
                {t('companion.notif.accept')}
              </button>
            </>
          )}
        </div>
      </div>
    </article>
  );
}

const TYPE_CONFIG: Record<string, { color: string; Icon: typeof IconBell }> = {
  memory:     { color: 'var(--g-dim-memory)',  Icon: IconMemory },
  task:       { color: 'var(--g-dim-exec)',    Icon: IconTarget },
  goal:       { color: 'var(--g-dim-goal)',    Icon: IconTarget },
  care:       { color: 'var(--g-dim-memory)',  Icon: IconBell },
  reflection: { color: 'var(--g-dim-insight)', Icon: IconSpark },
  plan:       { color: 'var(--g-dim-goal)',    Icon: IconClock },
  message:    { color: 'var(--g-accent)',      Icon: IconCheck },
  default:    { color: 'var(--g-text-muted)',  Icon: IconBell },
};

function formatTime(iso: string, t: (k: string, v?: Record<string, string | number>) => string): string {
  try {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    const min = 60_000;
    const hour = 60 * min;
    const day = 24 * hour;
    if (diff < min) return t('companion.notif.justNow');
    if (diff < hour) return t('companion.notif.minutesAgo', { n: Math.floor(diff / min) });
    if (diff < day) return t('companion.notif.hoursAgo', { n: Math.floor(diff / hour) });
    return t('companion.notif.daysAgo', { n: Math.floor(diff / day) });
  } catch {
    return '';
  }
}
