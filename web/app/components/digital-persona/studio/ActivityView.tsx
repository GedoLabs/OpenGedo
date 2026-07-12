'use client';

import { fontVars } from '@/app/components/gedo/typography';
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowRight, EyeOff, Settings2 } from 'lucide-react';
import { useAuth } from '@/app/contexts/AuthContext';
import type { DigitalPersona, InboxItem, PersonaStats } from '@/lib/apiClient';
import { SectionTitle } from './shared';
import { InsightsCards } from './InsightsCards';
import { SessionsView } from './SessionsView';

const KIND_KEYS = ['task', 'memory', 'reminder'];

/** 活动 tab：洞察面板 + 待审收件箱 + 访客对话回看。 */
export function ActivityView({
  persona,
  onGoConfig,
  onGoDistribute,
}: {
  persona: DigitalPersona;
  onGoConfig: () => void;
  onGoDistribute: () => void;
}) {
  const { api } = useAuth();
  const t = useTranslations('app');
  const [stats, setStats] = useState<PersonaStats | null>(null);
  const [items, setItems] = useState<InboxItem[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const [st, inbox] = await Promise.all([
        api.getPersonaStats(),
        api.getInbox('pending'),
      ]);
      setStats(st);
      setItems(inbox.items || []);
    } catch (e) {
      console.error('load activity failed', e);
    } finally {
      setLoaded(true);
    }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const decide = async (id: string, decision: 'approved' | 'rejected') => {
    setBusyId(id);
    try {
      await api.decideInboxItem(id, decision);
      setItems(prev => prev.filter(x => x.id !== id));
      api.getPersonaStats().then(setStats).catch(() => {});
    } catch (e) {
      console.error(e);
    } finally {
      setBusyId(null);
    }
  };

  const needsConfig = !persona.setup_completed
    || !persona.display_name?.trim()
    || !persona.greeting?.trim();

  return (
    <main
      className="gedo-main-padded"
      style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: '22px 28px 32px', display: 'flex', flexDirection: 'column', gap: 24 }}
    >
      {!persona.published && (
        <section
          style={{
            borderRadius: 14,
            border: '1px solid color-mix(in oklch, var(--g-dim-persona) 38%, transparent)',
            background: 'color-mix(in oklch, var(--g-dim-persona) 8%, transparent)',
            padding: '16px 18px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <EyeOff size={18} style={{ color: 'var(--g-dim-persona)', flexShrink: 0, marginTop: 2 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <h3 style={{ margin: 0, fontSize: fontVars.sm, fontWeight: 600, color: 'var(--g-text)' }}>
                {t('avatar.activity.publishGuideTitle')}
              </h3>
              <p style={{ margin: '6px 0 0', fontSize: fontVars.sm, color: 'var(--g-text-muted)', lineHeight: 1.55 }}>
                {t('avatar.activity.publishGuideDesc')}
              </p>
              <ol style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: fontVars.sm, color: 'var(--g-text-muted)', lineHeight: 1.7 }}>
                <li style={{ color: needsConfig ? 'var(--g-text)' : 'var(--g-text-faint)' }}>
                  {t('avatar.activity.publishGuideStepConfig')}
                </li>
                <li>{t('avatar.activity.publishGuideStepPublish')}</li>
                <li>{t('avatar.activity.publishGuideStepShare')}</li>
              </ol>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
                <button
                  type="button"
                  onClick={onGoConfig}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '7px 14px',
                    borderRadius: 9,
                    border: '1px solid var(--g-border)',
                    background: 'var(--g-bg-raised)',
                    color: 'var(--g-text)',
                    fontSize: fontVars.sm,
                    fontWeight: 500,
                    cursor: 'pointer',
                  }}
                >
                  <Settings2 size={14} />
                  {t('avatar.activity.publishGuideConfigBtn')}
                </button>
                <button
                  type="button"
                  onClick={onGoDistribute}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '7px 14px',
                    borderRadius: 9,
                    border: 'none',
                    background: 'var(--g-dim-persona)',
                    color: 'var(--g-accent-ink)',
                    fontSize: fontVars.sm,
                    fontWeight: 500,
                    cursor: 'pointer',
                  }}
                >
                  {t('avatar.activity.publishGuideDistributeBtn')}
                  <ArrowRight size={14} />
                </button>
              </div>
            </div>
          </div>
        </section>
      )}

      <InsightsCards stats={stats} />

      <section>
        <SectionTitle title={t('avatar.activity.inboxTitle')} mono="INBOX" desc={t('avatar.activity.inboxDesc')} />
        {!loaded ? (
          <Empty text={t('avatar.activity.loading')} />
        ) : items.length === 0 ? (
          <Empty text={t('avatar.activity.inboxEmpty')} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {items.map(it => (
              <article
                key={it.id}
                style={{ background: 'var(--g-bg-raised)', border: '1px solid var(--g-border)', borderRadius: 12, padding: '12px 14px' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: fontVars.sm, padding: '1px 7px', borderRadius: 5, background: 'var(--g-surface-2)', color: 'var(--g-text-mid)', fontFamily: 'var(--g-font-mono)' }}>
                    {KIND_KEYS.includes(it.kind) ? t(`avatar.activity.kind.${it.kind}`) : it.kind}
                  </span>
                  <span style={{ fontSize: fontVars.sm, color: 'var(--g-text-faint)' }}>{it.source_label}</span>
                </div>
                <p style={{ margin: '0 0 10px', fontSize: fontVars.sm, color: 'var(--g-text)', lineHeight: 1.5 }}>
                  {it.payload?.title || it.payload?.content || it.payload?.quote || t('avatar.activity.noContent')}
                </p>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    onClick={() => decide(it.id, 'rejected')}
                    disabled={busyId === it.id}
                    style={{ fontSize: fontVars.sm, padding: '4px 12px', borderRadius: 8, background: 'transparent', border: '1px solid var(--g-border)', color: 'var(--g-text-muted)', cursor: 'pointer', opacity: busyId === it.id ? 0.5 : 1 }}
                  >
                    {t('avatar.activity.ignore')}
                  </button>
                  <button
                    type="button"
                    onClick={() => decide(it.id, 'approved')}
                    disabled={busyId === it.id}
                    style={{ fontSize: fontVars.sm, padding: '4px 12px', borderRadius: 8, background: 'var(--g-dim-persona)', border: 'none', color: 'var(--g-accent-ink)', cursor: 'pointer', fontWeight: 500, opacity: busyId === it.id ? 0.5 : 1 }}
                  >
                    {t('avatar.activity.adopt')}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <SessionsView />
    </main>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--g-text-faint)', fontSize: fontVars.sm, border: '1px dashed var(--g-border)', borderRadius: 12 }}>
      {text}
    </div>
  );
}
