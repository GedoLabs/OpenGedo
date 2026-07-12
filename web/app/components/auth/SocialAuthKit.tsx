'use client';

// Shared social sign-in buttons so Google and Apple look identical — a single
// white "pill" matching the app's native design (small logo left, centered label,
// optional "last used" badge). Google keeps the real GIS ID-token flow: the
// official Google button is rendered INVISIBLY on top of our styled button and
// captures the click. That's the supported way to get a custom look without
// giving up the credential (GIS won't hand an ID token to a fully custom button).

import { useEffect, useRef, type ReactNode } from 'react';

const GIS_SRC = 'https://accounts.google.com/gsi/client';
export const APPLE_SRC = 'https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js';

const scriptPromises: Record<string, Promise<void>> = {};
export function loadSocialScript(src: string): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (scriptPromises[src]) return scriptPromises[src];
  scriptPromises[src] = new Promise<void>((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const el = document.createElement('script');
    el.src = src;
    el.async = true;
    el.defer = true;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(el);
  });
  return scriptPromises[src];
}

// One button visual, used by both providers. White so it reads clearly on the
// dark auth card and matches the mobile reference exactly.
const BTN: React.CSSProperties = {
  position: 'relative',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  width: '100%', height: 48, borderRadius: 14, padding: '0 14px',
  background: '#fff', border: '1px solid rgba(0,0,0,0.10)', color: '#202124',
  fontSize: 15, fontWeight: 500, fontFamily: 'var(--g-font-sans)',
  boxShadow: '0 1px 2px rgba(0,0,0,0.16)', WebkitTapHighlightColor: 'transparent',
};

function Spinner() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" className="animate-spin" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="rgba(0,0,0,0.18)" strokeWidth="4" fill="none" />
      <path d="M4 12a8 8 0 018-8" stroke="#202124" strokeWidth="4" fill="none" strokeLinecap="round" />
    </svg>
  );
}

function GoogleGlyph() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

function AppleGlyph() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="#000" aria-hidden>
      <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.7 9.05 7.4c1.3.07 2.18.72 2.98.74.93-.17 1.82-.83 2.88-.89 1.26-.08 2.44.48 3.13 1.42-2.84 1.7-2.37 5.47.42 6.58-.57 1.43-1.28 2.8-2.41 4.03zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
    </svg>
  );
}

function Badge({ children }: { children: ReactNode }) {
  return (
    <span style={{
      position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
      fontSize: 11, fontWeight: 600, color: '#1a73e8',
      background: 'rgba(26,115,232,0.10)', borderRadius: 999, padding: '3px 8px', whiteSpace: 'nowrap',
    }}>{children}</span>
  );
}

/**
 * Google button — our styled pill with the official GIS button layered invisibly
 * on top to capture the click (opacity-0 elements stay interactive). `onCredential`
 * receives the ID token to POST to the backend.
 */
export function GoogleIdButton({ clientId, label, badge, onCredential, busy }: {
  clientId: string;
  label: string;
  badge?: ReactNode;
  onCredential: (credential: string) => void;
  busy?: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const cb = useRef(onCredential);
  cb.current = onCredential;
  const gisReady = useRef(false);

  const renderGoogleButton = () => {
    const wrap = wrapRef.current;
    const el = overlayRef.current;
    if (!wrap || !el || !window.google?.accounts?.id) return;
    const w = Math.max(200, Math.min(400, Math.floor(wrap.getBoundingClientRect().width) || 320));
    el.innerHTML = '';
    window.google.accounts.id.renderButton(el, {
      type: 'standard', theme: 'outline', size: 'large',
      text: 'continue_with', shape: 'pill', logo_alignment: 'center', width: w,
    });
    // GIS iframe defaults to a fixed width — stretch it to cover our full pill so
    // clicks work even when the translated label (or "last used" badge) widens the row.
    const injected = el.firstElementChild as HTMLElement | null;
    if (injected) {
      injected.style.width = '100%';
      injected.style.height = '100%';
      injected.style.minHeight = '48px';
    }
  };

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    let ro: ResizeObserver | undefined;

    const mount = () => {
      if (cancelled || !window.google?.accounts?.id) return;
      if (!gisReady.current) {
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: (r: { credential?: string }) => { cb.current(r?.credential || ''); },
          ux_mode: 'popup', auto_select: false,
        });
        gisReady.current = true;
      }
      renderGoogleButton();
    };

    loadSocialScript(GIS_SRC)
      .then(() => {
        if (cancelled) return;
        mount();
        // Parent framer-motion / font swap can settle after first paint — re-measure.
        requestAnimationFrame(mount);
        window.setTimeout(mount, 120);
        window.setTimeout(mount, 400);
        const wrap = wrapRef.current;
        if (wrap && typeof ResizeObserver !== 'undefined') {
          ro = new ResizeObserver(() => renderGoogleButton());
          ro.observe(wrap);
        }
      })
      .catch(() => { /* CDN blocked → visual pill only */ });

    return () => {
      cancelled = true;
      ro?.disconnect();
    };
  }, [clientId]);

  // Label / badge text length varies by locale — re-sync GIS hit target when they change.
  useEffect(() => {
    renderGoogleButton();
  }, [label, badge, busy]);

  return (
    <div ref={wrapRef} style={{ position: 'relative', opacity: busy ? 0.6 : 1 }}>
      {/* Decorative only — must not steal clicks from the GIS overlay below. */}
      <div style={{ ...BTN, cursor: 'default', pointerEvents: 'none' }} aria-hidden>
        <span style={{ position: 'absolute', left: 16, display: 'flex' }}>{busy ? <Spinner /> : <GoogleGlyph />}</span>
        <span>{label}</span>
        {badge ? <Badge>{badge}</Badge> : null}
      </div>
      <div
        ref={overlayRef}
        aria-label={label}
        style={{
          position: 'absolute', inset: 0, zIndex: 2,
          opacity: 0, overflow: 'visible', borderRadius: 14,
          display: 'flex', alignItems: 'stretch', justifyContent: 'stretch',
          pointerEvents: busy ? 'none' : 'auto',
        }}
      />
    </div>
  );
}

/** Apple button — fully custom (we drive the Apple JS popup ourselves via onClick). */
export function AppleActionButton({ label, badge, onClick, busy }: {
  label: string;
  badge?: ReactNode;
  onClick: () => void;
  busy?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      style={{ ...BTN, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}
    >
      <span style={{ position: 'absolute', left: 16, display: 'flex' }}>{busy ? <Spinner /> : <AppleGlyph />}</span>
      <span>{label}</span>
      {badge ? <Badge>{badge}</Badge> : null}
    </button>
  );
}
