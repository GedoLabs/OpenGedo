'use client';

// Google + Apple sign-in for the web auth pages. Each provider hands the browser
// a signed ID token; we POST it to the backend (/v1/auth/google | /v1/auth/apple),
// which verifies it and returns the same session as password login.
//
// The button visuals come from SocialAuthKit so both providers are one consistent
// white pill. Buttons only render for a provider whose public config is present,
// so the section degrades to nothing until the env vars below are filled in:
//   NEXT_PUBLIC_GOOGLE_CLIENT_ID    — Google "Web application" OAuth client ID
//   NEXT_PUBLIC_APPLE_SERVICES_ID   — Apple Services ID (the web identifier)
//   NEXT_PUBLIC_APPLE_REDIRECT_URI  — return URL registered on that Services ID

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useAuth } from '@/app/contexts/AuthContext';
import { ApiError } from '@/lib/apiClient';
import { AppleActionButton, GoogleIdButton, APPLE_SRC, loadSocialScript } from '@/app/components/auth/SocialAuthKit';

declare global {
  interface Window {
    // Provider SDKs — untyped globals loaded from their CDNs on demand.
    google?: any;
    AppleID?: any;
  }
}

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '';
const APPLE_SERVICES_ID = process.env.NEXT_PUBLIC_APPLE_SERVICES_ID || '';
const APPLE_REDIRECT_URI = process.env.NEXT_PUBLIC_APPLE_REDIRECT_URI || '';
const APPLE_READY = !!APPLE_SERVICES_ID && !!APPLE_REDIRECT_URI;

// Remember which provider signed you in last, to surface a "last used" hint.
const LAST_SOCIAL_KEY = 'gedo_last_social';

interface SocialAuthButtonsProps {
  mode: 'login' | 'signup';
  /** Signup passes the invite-code field value; login omits it. */
  getInviteCode?: () => string;
  /** Signup only: whether an invite code is currently required (open-reg → false). */
  inviteRequired?: boolean;
  onSuccess: (isNew: boolean) => void;
  onError: (message: string) => void;
}

export function SocialAuthButtons({ mode, getInviteCode, inviteRequired = false, onSuccess, onError }: SocialAuthButtonsProps) {
  const t = useTranslations('auth');
  const locale = useLocale();
  const { loginWithGoogle, loginWithApple } = useAuth();
  const [busy, setBusy] = useState(false);
  const [lastUsed, setLastUsed] = useState<string | null>(null);
  useEffect(() => { try { setLastUsed(localStorage.getItem(LAST_SOCIAL_KEY)); } catch { /* ignore */ } }, []);

  // Keep the latest props/handlers in a ref so the async callbacks always see
  // current values without re-creating the SDK callbacks.
  const ctx = useRef({ mode, getInviteCode, inviteRequired, onSuccess, onError, locale, loginWithGoogle, loginWithApple });
  ctx.current = { mode, getInviteCode, inviteRequired, onSuccess, onError, locale, loginWithGoogle, loginWithApple };

  const mapError = useCallback(
    (err: unknown): string => {
      if (err instanceof ApiError) {
        const code = (err.body as { error?: string })?.error || '';
        if (err.status === 403 || code === 'invite_required') {
          return mode === 'signup' ? t('errSocialInviteFirst') : t('errSocialNoAccount');
        }
        if (err.status === 409 || code === 'email_exists') return t('errSocialEmailExists');
        if (err.status === 503) return t('errSocialUnavailable');
      }
      return t('errSocialFailed');
    },
    [mode, t],
  );

  const remember = (p: string) => { try { localStorage.setItem(LAST_SOCIAL_KEY, p); } catch { /* ignore */ } };

  const handleGoogleCredential = useCallback(
    async (credential: string) => {
      const c = ctx.current;
      if (!credential) return;
      // Skip a wasted round-trip: on signup, only pre-block when an invite is required.
      const invite = c.getInviteCode?.() ?? '';
      if (c.mode === 'signup' && c.inviteRequired && !invite.trim()) {
        c.onError(t('errSocialInviteFirst'));
        return;
      }
      setBusy(true);
      try {
        const { isNew } = await c.loginWithGoogle(credential, { inviteCode: invite, locale: c.locale });
        remember('google');
        c.onSuccess(isNew);
      } catch (err) {
        c.onError(mapError(err));
      } finally {
        setBusy(false);
      }
    },
    [mapError, t],
  );

  const handleApple = useCallback(async () => {
    if (!APPLE_READY) return;
    const c = ctx.current;
    const invite = c.getInviteCode?.() ?? '';
    if (c.mode === 'signup' && c.inviteRequired && !invite.trim()) {
      c.onError(t('errSocialInviteFirst'));
      return;
    }
    setBusy(true);
    try {
      await loadSocialScript(APPLE_SRC);
      if (!window.AppleID?.auth) throw new Error('apple_unavailable');
      window.AppleID.auth.init({
        clientId: APPLE_SERVICES_ID,
        scope: 'name email',
        redirectURI: APPLE_REDIRECT_URI,
        usePopup: true,
      });
      const data = await window.AppleID.auth.signIn();
      const idToken: string | undefined = data?.authorization?.id_token;
      if (!idToken) throw new Error('apple_no_token');
      // Apple only returns the name on the FIRST authorization, via the client.
      const name = data?.user?.name;
      const fullName = name ? [name.firstName, name.lastName].filter(Boolean).join(' ').trim() : undefined;
      const { isNew } = await c.loginWithApple(idToken, { inviteCode: invite, locale: c.locale, fullName });
      remember('apple');
      c.onSuccess(isNew);
    } catch (err) {
      // User closing the Apple popup isn't an error worth surfacing.
      const appleErr = (err as { error?: string })?.error;
      if (appleErr !== 'popup_closed_by_user' && appleErr !== 'user_cancelled_authorize') {
        c.onError(mapError(err));
      }
    } finally {
      setBusy(false);
    }
  }, [mapError, t]);

  if (!GOOGLE_CLIENT_ID && !APPLE_READY) return null;

  const label = (provider: string) =>
    mode === 'signup' ? t('socialSignupWith', { provider }) : t('socialSigninWith', { provider });

  return (
    <div className="space-y-3 mb-6">
      {GOOGLE_CLIENT_ID && (
        <GoogleIdButton
          key={locale}
          clientId={GOOGLE_CLIENT_ID}
          label={label('Google')}
          badge={lastUsed === 'google' ? t('lastUsed') : undefined}
          onCredential={(cred) => { void handleGoogleCredential(cred); }}
          busy={busy}
        />
      )}
      {APPLE_READY && (
        <AppleActionButton
          label={label('Apple')}
          badge={lastUsed === 'apple' ? t('lastUsed') : undefined}
          onClick={() => { void handleApple(); }}
          busy={busy}
        />
      )}
    </div>
  );
}
