'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/app/contexts/AuthContext';
import { isQuotaExceeded, type DigitalPersona, type DigitalPersonaPatch } from '@/lib/apiClient';
import { Segmented } from '@/app/components/digital-persona/studio/shared';
import { ConfigView } from '@/app/components/digital-persona/studio/ConfigView';
import { ActivityView } from '@/app/components/digital-persona/studio/ActivityView';
import { DistributeView } from '@/app/components/digital-persona/studio/DistributeView';
import { fontVars, text } from '@/app/components/gedo/typography';

type View = 'config' | 'activity' | 'distribute';

export default function DigitalPersonaPage() {
  const { api, logout } = useAuth();
  const t = useTranslations('app');
  const [persona, setPersona] = useState<DigitalPersona | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [publishError, setPublishError] = useState<{ message: string; upgrade?: boolean } | null>(null);
  const [view, setView] = useState<View>('activity');

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setPersona(await api.getDigitalPersona());
    } catch (e) {
      console.error('Failed to load digital persona:', e);
      // A stale/expired session 401s every request forever — surface it
      // instead of spinning, so the user can re-authenticate rather than
      // being stuck on "loading" indefinitely.
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  // Persist a patch (called on blur / explicit actions). Optimistic + reconcile.
  const patch = useCallback(async (changes: DigitalPersonaPatch) => {
    setPersona(prev => (prev ? { ...prev, ...changes } : prev));
    setSaving(true);
    try {
      setPersona(await api.updateDigitalPersona(changes));
    } catch (e) {
      console.error('Failed to save:', e);
    } finally {
      setSaving(false);
    }
  }, [api]);

  const togglePublish = useCallback(async () => {
    setSaving(true);
    setPublishError(null);
    try {
      const updated = persona?.published
        ? await api.unpublishDigitalPersona()
        : await api.publishDigitalPersona();
      setPersona(updated);
    } catch (e) {
      // Quota gates (e.g. free tier can't publish) are expected, not bugs —
      // surface a friendly message instead of letting the raw error bubble
      // (console.error(Error) triggers Next's dev-overlay crash screen).
      if (isQuotaExceeded(e)) {
        setPublishError({ message: t('avatar.distribute.publishQuotaExceeded'), upgrade: true });
      } else {
        console.error('Failed to toggle publish:', e);
        setPublishError({ message: t('avatar.distribute.publishError') });
      }
    } finally {
      setSaving(false);
    }
  }, [api, persona?.published, t]);

  const handleUpload = useCallback(async (file: File) => {
    setPersona(await api.uploadPersonaAvatar(file));
  }, [api]);

  if (loading) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--g-text-faint)' }}>
        <div style={{ textAlign: 'center' }}>
          <Loader2 className="animate-spin" style={{ width: 28, height: 28, margin: '0 auto 12px' }} />
          {t('avatar.loading')}
        </div>
      </div>
    );
  }

  if (loadError || !persona) {
    const isAuthError = /unauthorized|401/i.test(loadError || '');
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--g-text-faint)' }}>
        <div style={{ textAlign: 'center', maxWidth: 320 }}>
          <p style={{ fontSize: fontVars.base, color: 'var(--g-text-mid)', marginBottom: 14 }}>
            {isAuthError ? t('avatar.sessionExpired') : t('avatar.loadError')}
          </p>
          {isAuthError ? (
            <button
              type="button"
              onClick={logout}
              style={{ padding: '8px 18px', borderRadius: 999, background: 'var(--g-accent)', color: 'var(--g-accent-ink)', border: 'none', fontSize: fontVars.sm, fontWeight: 500, cursor: 'pointer' }}
            >
              {t('avatar.reLogin')}
            </button>
          ) : (
            <button
              type="button"
              onClick={load}
              style={{ padding: '8px 18px', borderRadius: 999, background: 'var(--g-surface-1)', border: '1px solid var(--g-border)', color: 'var(--g-text)', fontSize: fontVars.sm, fontWeight: 500, cursor: 'pointer' }}
            >
              {t('avatar.retry')}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="persona-studio" style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--g-bg)' }}>
      <header
        className="gedo-screen-header"
        style={{
          height: 60, flexShrink: 0, padding: '0 28px',
          borderBottom: '1px solid var(--g-border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'var(--g-bg)', gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
          <div
            className="gedo-hide-mobile"
            style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--g-text-faint)', ...text.mono, letterSpacing: '0.04em' }}
          >
            <span>GEDO</span>
            <span style={{ opacity: 0.5 }}>/</span>
            <span style={{ color: 'var(--g-text-mid)' }}>{t('nav.avatar')}</span>
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h1 style={{ margin: 0, ...text.title }}>{t('avatar.title')}</h1>
            </div>
            <p className="gedo-hide-mobile" style={{ margin: '2px 0 0', ...text.caption, color: 'var(--g-text-muted)' }}>
              {t('avatar.subtitle')}
            </p>
          </div>
        </div>
        <div className="gedo-screen-header-actions" style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          {saving && (
            <span style={{ fontSize: fontVars.sm, color: 'var(--g-text-muted)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Loader2 className="animate-spin" style={{ width: 12, height: 12 }} /> {t('avatar.saving')}
            </span>
          )}
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { value: 'activity', label: t('avatar.tabs.activity') },
              { value: 'config', label: t('avatar.tabs.config') },
              { value: 'distribute', label: t('avatar.tabs.distribute') },
            ]}
          />
        </div>
      </header>

      {view === 'config' && <ConfigView persona={persona} patch={patch} onUpload={handleUpload} />}
      {view === 'activity' && (
        <ActivityView
          persona={persona}
          onGoConfig={() => setView('config')}
          onGoDistribute={() => setView('distribute')}
        />
      )}
      {view === 'distribute' && (
        <DistributeView persona={persona} saving={saving} onTogglePublish={togglePublish} error={publishError} />
      )}

      <style jsx global>{`
        .persona-studio .pin {
          width: 100%;
          background: var(--g-bg-raised);
          border: 1px solid var(--g-border);
          border-radius: 8px;
          padding: 0.5rem 0.75rem;
          font-size: 0.875rem;
          color: var(--g-text);
          outline: none;
          font-family: var(--g-font-sans);
        }
        .persona-studio .pin:focus { border-color: var(--g-dim-persona); }
        .persona-studio .pin::placeholder { color: var(--g-text-faint); }
        .persona-studio textarea.pin { resize: none; }
      `}</style>
    </div>
  );
}
