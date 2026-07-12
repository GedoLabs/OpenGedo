'use client';

import { fontVars } from '@/app/components/gedo/typography';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link2, Copy, Check, Plug, Eye, EyeOff, QrCode, Download, AlertCircle } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { resolveApiBaseUrl, type DigitalPersona } from '@/lib/apiClient';
import { SectionTitle } from './shared';

export function DistributeView({
  persona, saving, onTogglePublish, error,
}: {
  persona: DigitalPersona;
  saving: boolean;
  onTogglePublish: () => void;
  error?: { message: string; upgrade?: boolean } | null;
}) {
  const t = useTranslations('app');
  const [copied, setCopied] = useState<'link' | 'embed' | null>(null);
  const [qr, setQr] = useState<string | null>(null);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const publicUrl = persona.slug ? `${origin}/p/${persona.slug}` : '';
  const embedUrl = persona.slug ? `${origin}/embed/${persona.slug}` : '';
  const embedSnippet = embedUrl
    ? `<iframe src="${embedUrl}" width="400" height="600" style="border:0;border-radius:16px" title="${t('avatar.assistantOf', { name: persona.display_name || t('avatar.defaultAssistantName') })}" loading="lazy"></iframe>`
    : '';

  // Generate the QR client-side from the public URL (kept local — no 3rd party).
  useEffect(() => {
    if (!publicUrl) { setQr(null); return; }
    let cancelled = false;
    import('qrcode')
      .then(({ default: QRCode }) => QRCode.toDataURL(publicUrl, { width: 320, margin: 1, color: { dark: '#0b0b0e', light: '#ffffff' } }))
      .then(url => { if (!cancelled) setQr(url); })
      .catch(() => { if (!cancelled) setQr(null); });
    return () => { cancelled = true; };
  }, [publicUrl]);

  const copy = (text: string, which: 'link' | 'embed') => {
    if (!text) return;
    navigator.clipboard?.writeText(text);
    setCopied(which);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <main
      className="gedo-main-padded"
      style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: '22px 28px 32px', display: 'flex', flexDirection: 'column', gap: 22, maxWidth: 760 }}
    >
      {/* Publish status banner */}
      <section
        style={{
          borderRadius: 14,
          border: `1px solid ${persona.published ? 'color-mix(in oklch, var(--g-dim-persona) 45%, transparent)' : 'var(--g-border)'}`,
          background: persona.published ? 'color-mix(in oklch, var(--g-dim-persona) 9%, transparent)' : 'var(--g-bg-raised)',
          padding: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: fontVars.sm, fontWeight: 600, color: 'var(--g-text)' }}>
              {persona.published
                ? <Eye size={16} style={{ color: 'var(--g-dim-persona)' }} />
                : <EyeOff size={16} style={{ color: 'var(--g-text-faint)' }} />}
              {persona.published ? t('avatar.distribute.published') : t('avatar.distribute.unpublished')}
            </div>
            <p style={{ margin: '4px 0 0', fontSize: fontVars.sm, color: 'var(--g-text-muted)' }}>
              {persona.published ? t('avatar.distribute.publishedDesc') : t('avatar.distribute.unpublishedDesc')}
            </p>
          </div>
          <button
            type="button"
            onClick={onTogglePublish}
            disabled={saving}
            style={{
              flexShrink: 0, padding: '8px 16px', borderRadius: 10, fontSize: fontVars.sm, fontWeight: 500, cursor: 'pointer', border: 'none',
              background: persona.published ? 'var(--g-surface-2)' : 'var(--g-dim-persona)',
              color: persona.published ? 'var(--g-text)' : 'var(--g-accent-ink)',
              opacity: saving ? 0.6 : 1,
            }}
          >
            {persona.published ? t('avatar.distribute.unpublishBtn') : t('avatar.distribute.publishBtn')}
          </button>
        </div>
        {error && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--g-border)' }}>
            <AlertCircle size={15} style={{ color: 'var(--g-warn, #d9a441)', flexShrink: 0 }} />
            <span style={{ flex: 1, fontSize: fontVars.sm, color: 'var(--g-text-mid)' }}>{error.message}</span>
            {error.upgrade && (
              <Link
                href="/pricing"
                style={{
                  flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '5px 12px', borderRadius: 8, fontSize: fontVars.sm, fontWeight: 500, textDecoration: 'none',
                  background: 'linear-gradient(to right, var(--g-dim-memory), var(--g-dim-insight))', color: 'white',
                }}
              >
                {t('settings.membership.upgrade')}
              </Link>
            )}
          </div>
        )}
      </section>

      {persona.published && persona.slug ? (
        <>
          {/* Public link */}
          <section>
            <SectionTitle title={t('avatar.distribute.linkTitle')} mono="LINK" />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--g-surface-1)', border: '1px solid var(--g-border)', borderRadius: 10, padding: '8px 12px' }}>
              <Link2 size={15} style={{ color: 'var(--g-text-faint)', flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: fontVars.sm, color: 'var(--g-text-mid)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'var(--g-font-mono)' }}>{publicUrl}</span>
              <button type="button" onClick={() => copy(publicUrl, 'link')} title={t('avatar.distribute.copyLinkTitle')} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: copied === 'link' ? 'var(--g-dim-persona)' : 'var(--g-text-muted)', display: 'inline-flex', flexShrink: 0 }}>
                {copied === 'link' ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>
          </section>

          {/* QR code */}
          <section>
            <SectionTitle title={t('avatar.distribute.qrTitle')} mono="QR" desc={t('avatar.distribute.qrDesc')} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ width: 132, height: 132, borderRadius: 12, background: '#fff', padding: 8, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {qr ? (
                  // eslint-disable-next-line @next/next/no-img-element -- small QR data-URL, next/image not applicable
                  <img src={qr} alt={t('avatar.distribute.qrAlt')} width={116} height={116} style={{ display: 'block' }} />
                ) : (
                  <QrCode size={40} style={{ color: '#0b0b0e' }} />
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
                <p style={{ margin: 0, fontSize: fontVars.sm, color: 'var(--g-text-muted)', lineHeight: 1.5 }}>{t('avatar.distribute.qrHint')}</p>
                {qr && (
                  <a
                    href={qr}
                    download={`gedo-persona-${persona.slug}.png`}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, border: '1px solid var(--g-border)', color: 'var(--g-text-mid)', fontSize: fontVars.sm, textDecoration: 'none' }}
                  >
                    <Download size={14} /> {t('avatar.distribute.downloadPng')}
                  </a>
                )}
              </div>
            </div>
          </section>

          {/* Embed widget */}
          <section>
            <SectionTitle title={t('avatar.distribute.embedTitle')} mono="EMBED" desc={t('avatar.distribute.embedDesc')} />
            <div style={{ position: 'relative' }}>
              <textarea
                readOnly
                value={embedSnippet}
                rows={3}
                onFocus={(e) => e.currentTarget.select()}
                style={{
                  width: '100%', background: 'var(--g-surface-1)', border: '1px solid var(--g-border)', borderRadius: 10,
                  padding: '10px 12px', paddingRight: 44, fontSize: fontVars.sm, lineHeight: 1.5, color: 'var(--g-text-mid)',
                  fontFamily: 'var(--g-font-mono)', resize: 'none', outline: 'none',
                }}
              />
              <button
                type="button"
                onClick={() => copy(embedSnippet, 'embed')}
                title={t('avatar.distribute.copyEmbedTitle')}
                style={{ position: 'absolute', top: 8, right: 8, background: 'var(--g-surface-2)', border: '1px solid var(--g-border)', borderRadius: 8, padding: 6, cursor: 'pointer', color: copied === 'embed' ? 'var(--g-dim-persona)' : 'var(--g-text-muted)', display: 'inline-flex' }}
              >
                {copied === 'embed' ? <Check size={15} /> : <Copy size={15} />}
              </button>
            </div>
            <a href={embedUrl} target="_blank" rel="noopener noreferrer" style={{ display: 'inline-block', marginTop: 8, fontSize: fontVars.sm, color: 'var(--g-text-faint)', fontFamily: 'var(--g-font-mono)' }}>
              {t('avatar.distribute.previewWidget')} ↗
            </a>
          </section>

          {/* MCP */}
          <section>
            <SectionTitle title={t('avatar.distribute.mcpTitle')} mono="MCP" />
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, background: 'var(--g-bg-raised)', border: '1px solid var(--g-border)', borderRadius: 10, padding: '12px 14px', fontSize: fontVars.sm, color: 'var(--g-text-muted)', lineHeight: 1.55 }}>
              <Plug size={15} style={{ marginTop: 2, flexShrink: 0, color: 'var(--g-text-faint)' }} />
              <span>
                {t.rich('avatar.distribute.mcpBody', {
                  slug: persona.slug,
                  endpoint: `${resolveApiBaseUrl()}/public/mcp`,
                  tool: (chunks) => <code style={{ color: 'var(--g-text)', fontFamily: 'var(--g-font-mono)' }}>{chunks}</code>,
                  code: (chunks) => <code style={{ color: 'var(--g-text)', fontFamily: 'var(--g-font-mono)' }}>{chunks}</code>,
                })}
              </span>
            </div>
          </section>
        </>
      ) : (
        <div style={{ padding: '32px 20px', textAlign: 'center', color: 'var(--g-text-faint)', fontSize: fontVars.sm, border: '1px dashed var(--g-border)', borderRadius: 12 }}>
          {t('avatar.distribute.emptyState')}
        </div>
      )}
    </main>
  );
}
