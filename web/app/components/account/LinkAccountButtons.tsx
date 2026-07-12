'use client';

// Connect Google / Apple to the ALREADY-signed-in account (settings → sign-in
// methods). Same ID-token acquisition as the login page (shared SocialAuthKit
// visuals), but the token is POSTed to /v1/me/auth-identities/{google|apple} to
// link — no new session. A provider's button only renders when its public env is
// configured AND it isn't already linked, so the section is empty once everything
// is connected.

import { useCallback, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { fontVars } from '@/app/components/gedo/typography';
import { useAuth } from '@/app/contexts/AuthContext';
import { ApiError, type AuthIdentity } from '@/lib/apiClient';
import { AppleActionButton, GoogleIdButton, APPLE_SRC, loadSocialScript } from '@/app/components/auth/SocialAuthKit';

declare global {
  interface Window {
    google?: any;
    AppleID?: any;
  }
}

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '';
const APPLE_SERVICES_ID = process.env.NEXT_PUBLIC_APPLE_SERVICES_ID || '';
const APPLE_REDIRECT_URI = process.env.NEXT_PUBLIC_APPLE_REDIRECT_URI || '';
const APPLE_READY = !!APPLE_SERVICES_ID && !!APPLE_REDIRECT_URI;

interface LinkAccountButtonsProps {
  /** Providers already connected (e.g. new Set(['password','google'])). */
  linked: Set<string>;
  onLinked: (identities: AuthIdentity[]) => void;
  onError: (message: string) => void;
}

export function LinkAccountButtons({ linked, onLinked, onError }: LinkAccountButtonsProps) {
  const t = useTranslations('app');
  const { api } = useAuth();
  const [busy, setBusy] = useState(false);

  const showGoogle = !!GOOGLE_CLIENT_ID && !linked.has('google');
  const showApple = APPLE_READY && !linked.has('apple');

  const ctx = useRef({ onLinked, onError, api });
  ctx.current = { onLinked, onError, api };

  const mapError = useCallback(
    (err: unknown): string => {
      if (err instanceof ApiError) {
        const code = (err.body as { error?: string })?.error || '';
        if (err.status === 409 || code === 'identity_linked_elsewhere') return t('settings.account.errLinkedElsewhere');
        if (err.status === 503) return t('settings.account.errProviderUnavailable');
      }
      return t('settings.account.errLinkFailed');
    },
    [t],
  );

  const handleGoogleCredential = useCallback(
    async (credential: string) => {
      if (!credential) return;
      setBusy(true);
      try {
        const res = await ctx.current.api.linkGoogle(credential);
        ctx.current.onLinked(res.identities || []);
      } catch (err) {
        ctx.current.onError(mapError(err));
      } finally {
        setBusy(false);
      }
    },
    [mapError],
  );

  const handleApple = useCallback(async () => {
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
      const res = await ctx.current.api.linkApple(idToken);
      ctx.current.onLinked(res.identities || []);
    } catch (err) {
      // Closing the Apple popup isn't an error worth surfacing.
      const appleErr = (err as { error?: string })?.error;
      if (appleErr !== 'popup_closed_by_user' && appleErr !== 'user_cancelled_authorize') {
        ctx.current.onError(mapError(err));
      }
    } finally {
      setBusy(false);
    }
  }, [mapError]);

  if (!showGoogle && !showApple) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
      <p style={{ margin: 0, fontSize: fontVars.xs, color: 'var(--g-text-faint)' }}>
        {t('settings.account.linkHint')}
      </p>
      {showGoogle && (
        <GoogleIdButton
          clientId={GOOGLE_CLIENT_ID}
          label={t('settings.account.connectGoogle')}
          onCredential={(cred) => { void handleGoogleCredential(cred); }}
          busy={busy}
        />
      )}
      {showApple && (
        <AppleActionButton
          label={t('settings.account.connectApple')}
          onClick={() => { void handleApple(); }}
          busy={busy}
        />
      )}
    </div>
  );
}
