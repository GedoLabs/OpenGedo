'use client';

/**
 * Twin 分身模型（个人 LoRA）UI — Wave 1
 * （docs/PHASE_2026-07_内核升级面向用户方案.md §2.1-A / §2.2）
 *
 * - TwinConsentBlock：设置 → 隐私 的"分身模型训练"块（独立同意；撤回=物理删除，二次确认）
 * - TwinCard：数字分身页（ConfigView）的养成卡：权益门 → 开通 → 进度条+三动作 → 铸造中 → 已激活
 *
 * 数据源 GET /v1/twin/status（后端 persona/twin.mjs）；文案 app.twin.*（en/zh/ja）。
 * 同意条款为 beta 草案（twin-consent-v1）；Wave 2 法务定稿后替换文案并升版本。
 */

import { useState, useEffect, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Loader2, Sparkles, Trash2, Upload, MessageCircle, Crown, Check } from 'lucide-react';
import { useAuth } from '@/app/contexts/AuthContext';
import { fontVars } from '@/app/components/gedo/typography';
import type { TwinStatus } from '@/lib/apiClient';

function useTwinStatus() {
  const { api } = useAuth();
  const [status, setStatus] = useState<TwinStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try {
      setStatus(await api.getTwinStatus());
    } catch (e) {
      console.error('[twin] status failed:', e);
    } finally {
      setLoading(false);
    }
  }, [api]);
  useEffect(() => { void refresh(); }, [refresh]);
  return { status, loading, refresh };
}

// ── 轻量弹层 ────────────────────────────────────────────────────────────────

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 460, borderRadius: 14, padding: '20px 22px',
          background: 'var(--g-bg-raised)', border: '1px solid var(--g-border)',
          maxHeight: '85vh', overflow: 'auto', fontFamily: 'var(--g-font-sans)',
        }}
      >
        {children}
      </div>
    </div>
  );
}

function ModalButtons({ busy, confirmLabel, cancelLabel, danger, onConfirm, onCancel }: {
  busy: boolean; confirmLabel: string; cancelLabel: string; danger?: boolean;
  onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
      <button
        type="button" onClick={onCancel} disabled={busy}
        style={{
          padding: '7px 14px', borderRadius: 8, fontSize: fontVars.sm, cursor: 'pointer',
          background: 'var(--g-surface-1)', border: '1px solid var(--g-border)', color: 'var(--g-text)',
        }}
      >
        {cancelLabel}
      </button>
      <button
        type="button" onClick={onConfirm} disabled={busy}
        style={{
          padding: '7px 14px', borderRadius: 8, fontSize: fontVars.sm, fontWeight: 500,
          cursor: busy ? 'wait' : 'pointer', border: 'none', display: 'inline-flex', alignItems: 'center', gap: 6,
          background: danger ? 'oklch(0.55 0.19 25)' : 'var(--g-accent)',
          color: danger ? '#fff' : 'var(--g-accent-ink)',
          opacity: busy ? 0.7 : 1,
        }}
      >
        {busy && <Loader2 size={13} className="animate-spin" />}
        {confirmLabel}
      </button>
    </div>
  );
}

function ConsentModal({ busy, onAgree, onClose }: { busy: boolean; onAgree: () => void; onClose: () => void }) {
  const t = useTranslations('app');
  return (
    <Overlay onClose={onClose}>
      <h3 style={{ margin: 0, fontSize: fontVars.lg, color: 'var(--g-text)' }}>{t('twin.consentTitle')}</h3>
      <p style={{ margin: '8px 0 10px', fontSize: fontVars.sm, color: 'var(--g-text-mid)' }}>{t('twin.consentIntro')}</p>
      <ol style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 7 }}>
        {([1, 2, 3, 4, 5] as const).map(i => (
          <li key={i} style={{ fontSize: fontVars.sm, color: 'var(--g-text-mid)', lineHeight: 1.55 }}>
            {t(`twin.clause${i}`)}
          </li>
        ))}
      </ol>
      <p style={{ margin: '12px 0 0', fontSize: fontVars.xs, color: 'var(--g-text-faint)' }}>{t('twin.consentBeta')}</p>
      <ModalButtons busy={busy} confirmLabel={t('twin.agree')} cancelLabel={t('twin.cancel')} onConfirm={onAgree} onCancel={onClose} />
    </Overlay>
  );
}

function RevokeModal({ busy, onConfirm, onClose }: { busy: boolean; onConfirm: () => void; onClose: () => void }) {
  const t = useTranslations('app');
  return (
    <Overlay onClose={onClose}>
      <h3 style={{ margin: 0, fontSize: fontVars.lg, color: 'var(--g-text)' }}>{t('twin.revokeTitle')}</h3>
      <p style={{ margin: '10px 0 0', fontSize: fontVars.sm, color: 'oklch(0.55 0.19 25)', lineHeight: 1.6 }}>
        {t('twin.revokeWarning')}
      </p>
      <ModalButtons busy={busy} danger confirmLabel={t('twin.revokeConfirm')} cancelLabel={t('twin.cancel')} onConfirm={onConfirm} onCancel={onClose} />
    </Overlay>
  );
}

// ── 共享逻辑：同意/撤回 ─────────────────────────────────────────────────────

function useTwinConsentActions(refresh: () => Promise<void>) {
  const { api } = useAuth();
  const [modal, setModal] = useState<null | 'consent' | 'revoke'>(null);
  const [busy, setBusy] = useState(false);

  const grant = useCallback(async () => {
    setBusy(true);
    try { await api.grantTwinConsent(); setModal(null); await refresh(); }
    catch (e) { console.error('[twin] grant failed:', e); }
    finally { setBusy(false); }
  }, [api, refresh]);

  const revoke = useCallback(async () => {
    setBusy(true);
    try { await api.revokeTwinConsent(); setModal(null); await refresh(); }
    catch (e) { console.error('[twin] revoke failed:', e); }
    finally { setBusy(false); }
  }, [api, refresh]);

  const modals = (
    <>
      {modal === 'consent' && <ConsentModal busy={busy} onAgree={grant} onClose={() => setModal(null)} />}
      {modal === 'revoke' && <RevokeModal busy={busy} onConfirm={revoke} onClose={() => setModal(null)} />}
    </>
  );
  return { setModal, modals };
}

// ── 设置 → 隐私：分身模型训练块 ────────────────────────────────────────────

export function TwinConsentBlock() {
  const t = useTranslations('app');
  const { status, loading, refresh } = useTwinStatus();
  const { setModal, modals } = useTwinConsentActions(refresh);

  const consent = status?.corpus.consent;
  return (
    <div style={{
      borderRadius: 8, border: '1px solid var(--g-border)', background: 'var(--g-surface-1)',
      padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <Sparkles size={15} style={{ color: 'var(--g-text-muted)', marginTop: 2, flexShrink: 0 }} />
          <div>
            <p style={{ margin: 0, fontSize: fontVars.base, color: 'var(--g-text)' }}>{t('twin.consentEntry')}</p>
            <p style={{ margin: '1px 0 0', fontSize: fontVars.sm, color: 'var(--g-text-faint)' }}>{t('twin.consentEntryDesc')}</p>
          </div>
        </div>

        {loading ? (
          <Loader2 size={15} className="animate-spin" style={{ color: 'var(--g-text-muted)', flexShrink: 0 }} />
        ) : !status?.entitled ? (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0,
            fontSize: fontVars.xs, color: 'var(--g-text-faint)', border: '1px solid var(--g-border)',
            borderRadius: 999, padding: '3px 9px',
          }}>
            <Crown size={11} /> {t('twin.upgradeHint')}
          </span>
        ) : consent?.granted ? (
          <button
            type="button" onClick={() => setModal('revoke')}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0, cursor: 'pointer',
              fontSize: fontVars.xs, color: 'oklch(0.55 0.19 25)', background: 'none',
              border: '1px solid oklch(0.55 0.19 25 / 0.35)', borderRadius: 999, padding: '3px 9px',
            }}
          >
            <Trash2 size={11} /> {t('twin.revoke')}
          </button>
        ) : (
          <button
            type="button" onClick={() => setModal('consent')}
            style={{
              flexShrink: 0, cursor: 'pointer', fontSize: fontVars.sm, fontWeight: 500,
              background: 'var(--g-accent)', color: 'var(--g-accent-ink)', border: 'none',
              borderRadius: 8, padding: '6px 12px',
            }}
          >
            {t('twin.enable')}
          </button>
        )}
      </div>

      {consent?.granted && (
        <p style={{ margin: 0, fontSize: fontVars.xs, color: 'var(--g-text-faint)', display: 'flex', alignItems: 'center', gap: 5 }}>
          <Check size={11} style={{ color: 'var(--g-accent)' }} />
          {t('twin.grantedAt', {
            version: consent.version || 'v1',
            date: consent.granted_at ? new Date(consent.granted_at).toLocaleDateString() : '—',
          })}
        </p>
      )}
      {modals}
    </div>
  );
}

// ── 数字分身页：Twin 养成卡 ─────────────────────────────────────────────────

export function TwinCard() {
  const t = useTranslations('app');
  const { api } = useAuth();
  const { status, loading, refresh } = useTwinStatus();
  const { setModal, modals } = useTwinConsentActions(refresh);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [text, setText] = useState('');
  const [uploadState, setUploadState] = useState<null | 'busy' | 'ok' | 'short'>(null);

  const submitSample = useCallback(async () => {
    if (text.trim().length < 20) { setUploadState('short'); return; }
    setUploadState('busy');
    try {
      await api.addTwinSample(text.trim());
      setText('');
      setUploadState('ok');
      await refresh();
    } catch (e) {
      console.error('[twin] sample failed:', e);
      setUploadState('short');
    }
  }, [api, text, refresh]);

  if (loading) {
    return (
      <div style={{ borderRadius: 12, border: '1px solid var(--g-border)', padding: 16, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--g-text-faint)', fontSize: fontVars.sm }}>
        <Loader2 size={14} className="animate-spin" /> {t('twin.title')}
      </div>
    );
  }
  if (!status) return null; // 状态接口失败时安静降级，不影响分身页其他功能

  const consent = status.corpus.consent;
  const forging = status.jobs.some(j => ['queued', 'training', 'gating'].includes(j.status));
  const progressPct = Math.max(4, Math.round(status.corpus.progress * 100));

  return (
    <div style={{
      borderRadius: 12, border: '1px solid var(--g-border)', background: 'var(--g-surface-1)',
      padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <Sparkles size={15} style={{ color: 'var(--g-accent)' }} />
          <span style={{ fontSize: fontVars.base, fontWeight: 600, color: 'var(--g-text)' }}>{t('twin.title')}</span>
        </div>
        <span style={{
          fontSize: fontVars.xs, color: status.active ? 'var(--g-accent)' : 'var(--g-text-faint)',
          border: '1px solid var(--g-border)', borderRadius: 999, padding: '2px 9px',
        }}>
          {status.active ? `v${status.active.version}` : t('twin.badgeSoon')}
        </span>
      </div>

      {!status.entitled ? (
        <p style={{ margin: 0, fontSize: fontVars.sm, color: 'var(--g-text-faint)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Crown size={13} /> {t('twin.gateDesc')}
        </p>
      ) : status.active ? (
        <>
          <p style={{ margin: 0, fontSize: fontVars.sm, color: 'var(--g-text-mid)' }}>
            {t('twin.activeDesc', { version: status.active.version })}
          </p>
          <p style={{ margin: 0, fontSize: fontVars.xs, color: 'var(--g-text-faint)' }}>{t('twin.manageInSettings')}</p>
        </>
      ) : forging ? (
        <p style={{ margin: 0, fontSize: fontVars.sm, color: 'var(--g-text-mid)', display: 'flex', alignItems: 'center', gap: 7 }}>
          <Loader2 size={13} className="animate-spin" /> {t('twin.forging')}
        </p>
      ) : !consent.granted ? (
        <>
          <p style={{ margin: 0, fontSize: fontVars.sm, color: 'var(--g-text-mid)', lineHeight: 1.55 }}>{t('twin.tagline')}</p>
          <div>
            <button
              type="button" onClick={() => setModal('consent')}
              style={{
                cursor: 'pointer', fontSize: fontVars.sm, fontWeight: 500,
                background: 'var(--g-accent)', color: 'var(--g-accent-ink)', border: 'none',
                borderRadius: 8, padding: '7px 14px',
              }}
            >
              {t('twin.enable')}
            </button>
          </div>
        </>
      ) : (
        <>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
              <span style={{ fontSize: fontVars.xs, color: 'var(--g-text-muted)' }}>{t('twin.progressTitle')}</span>
              <span style={{ fontSize: fontVars.xs, color: 'var(--g-text-faint)' }}>
                {t('twin.progressStats', {
                  items: status.corpus.items,
                  minItems: status.corpus.thresholds.min_items,
                })}
              </span>
            </div>
            <div style={{ height: 7, borderRadius: 999, background: 'var(--g-bg)', border: '1px solid var(--g-border)', overflow: 'hidden' }}>
              <div style={{ width: `${progressPct}%`, height: '100%', background: 'var(--g-accent)', transition: 'width 0.4s' }} />
            </div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <Link
              href="/app"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5, textDecoration: 'none',
                fontSize: fontVars.xs, color: 'var(--g-text-mid)', border: '1px solid var(--g-border)',
                borderRadius: 999, padding: '5px 11px',
              }}
            >
              <MessageCircle size={12} /> {t('twin.actionChat')}
            </Link>
            <button
              type="button" onClick={() => { setUploadOpen(v => !v); setUploadState(null); }}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer',
                fontSize: fontVars.xs, color: 'var(--g-text-mid)', background: 'none',
                border: '1px solid var(--g-border)', borderRadius: 999, padding: '5px 11px',
              }}
            >
              <Upload size={12} /> {t('twin.actionUpload')}
            </button>
          </div>
          <p style={{ margin: 0, fontSize: fontVars.xs, color: 'var(--g-text-faint)' }}>{t('twin.actionImport')}</p>

          {uploadOpen && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              <textarea
                value={text}
                onChange={e => setText(e.target.value)}
                rows={4}
                placeholder={t('twin.uploadPlaceholder')}
                style={{
                  width: '100%', borderRadius: 8, border: '1px solid var(--g-border)',
                  background: 'var(--g-bg)', color: 'var(--g-text)', padding: '8px 10px',
                  fontSize: fontVars.sm, fontFamily: 'var(--g-font-sans)', resize: 'vertical', outline: 'none',
                }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button
                  type="button" onClick={submitSample} disabled={uploadState === 'busy'}
                  style={{
                    cursor: uploadState === 'busy' ? 'wait' : 'pointer', fontSize: fontVars.sm,
                    background: 'var(--g-accent)', color: 'var(--g-accent-ink)', border: 'none',
                    borderRadius: 8, padding: '6px 12px', display: 'inline-flex', alignItems: 'center', gap: 6,
                    opacity: uploadState === 'busy' ? 0.7 : 1,
                  }}
                >
                  {uploadState === 'busy' && <Loader2 size={12} className="animate-spin" />}
                  {t('twin.uploadSubmit')}
                </button>
                {uploadState === 'ok' && (
                  <span style={{ fontSize: fontVars.xs, color: 'var(--g-accent)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <Check size={12} /> {t('twin.uploadOk')}
                  </span>
                )}
                {uploadState === 'short' && (
                  <span style={{ fontSize: fontVars.xs, color: 'oklch(0.55 0.19 25)' }}>{t('twin.uploadTooShort')}</span>
                )}
              </div>
            </div>
          )}
        </>
      )}
      {modals}
    </div>
  );
}
