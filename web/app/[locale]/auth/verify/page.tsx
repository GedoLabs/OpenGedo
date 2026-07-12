'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { useAuth } from '@/app/contexts/AuthContext';
import { ApiError } from '@/lib/apiClient';
import { AuthCardShell, AuthLoadingScreen } from '@/app/components/auth/AuthCardShell';
import { ArrowRight, CheckCircle2, MailWarning, Loader2, RefreshCw } from 'lucide-react';

// verify-email 的 400 错误码(server.mjs + store.consumeEmailToken)。其余归为 generic。
const VERIFY_ERR_CODES = ['expired_token', 'used_token', 'invalid_token'];

// 用字面量 key 取错误文案(next-intl 是强类型 key,动态拼 `${code}Title` 会报类型错)。
function verifyErrorCopy(t: ReturnType<typeof useTranslations>, code: string): { title: string; body: string } {
  switch (code) {
    case 'expired_token':
      return { title: t('verify.err.expired_tokenTitle'), body: t('verify.err.expired_tokenBody') };
    case 'used_token':
      return { title: t('verify.err.used_tokenTitle'), body: t('verify.err.used_tokenBody') };
    case 'invalid_token':
      return { title: t('verify.err.invalid_tokenTitle'), body: t('verify.err.invalid_tokenBody') };
    default:
      return { title: t('verify.err.genericTitle'), body: t('verify.err.genericBody') };
  }
}

type VerifyState =
  | { phase: 'verifying' }
  | { phase: 'success'; email?: string }
  | { phase: 'error'; code: string };

function ResendButton() {
  const t = useTranslations('auth');
  const { api, isAuthenticated } = useAuth();
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'already' | 'failed'>('idle');

  // Resend requires an authenticated session (the endpoint identifies the user
  // from their token, not the email). Signed-out visitors get a sign-in nudge.
  if (!isAuthenticated) {
    return (
      <Link
        href="/auth/login"
        className="inline-flex items-center gap-1.5 text-blue-400 hover:text-blue-300 font-medium transition-colors text-[length:var(--g-text-base)]"
      >
        {t('verify.resendSignInHint')} <ArrowRight size={15} />
      </Link>
    );
  }

  if (status === 'sent') {
    return <p className="text-[length:var(--g-text-base)] text-emerald-400">{t('verify.resent')}</p>;
  }
  if (status === 'already') {
    return <p className="text-[length:var(--g-text-base)] text-emerald-400">{t('verify.alreadyVerified')}</p>;
  }

  const resend = async () => {
    setStatus('sending');
    try {
      const res = await api.resendVerification();
      setStatus(res?.already_verified ? 'already' : 'sent');
    } catch {
      setStatus('failed');
    }
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={resend}
        disabled={status === 'sending'}
        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-[length:var(--g-text-base)] font-medium transition-all disabled:opacity-60"
        style={{ background: 'var(--g-surface-2)', border: '1px solid var(--g-border)', color: 'var(--g-text-mid)' }}
      >
        {status === 'sending' ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
        {status === 'sending' ? t('verify.resending') : t('verify.resend')}
      </button>
      {status === 'failed' && <p className="text-[length:var(--g-text-sm)] text-red-400">{t('verify.resendFailed')}</p>}
    </div>
  );
}

function VerifyEmailInner() {
  const t = useTranslations('auth');
  const { api, isAuthenticated } = useAuth();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') || '';
  // No token in the link → nothing to verify; seed the error state up front so the
  // effect never has to setState synchronously (avoids a cascading re-render).
  const [state, setState] = useState<VerifyState>(
    token ? { phase: 'verifying' } : { phase: 'error', code: 'invalid_token' },
  );

  // Guard against React StrictMode's double-mount: the token is single-use, so a
  // second POST would consume it and wrongly report `used_token`. Fire exactly once.
  const firedRef = useRef(false);

  useEffect(() => {
    if (!token || firedRef.current) return;
    firedRef.current = true;
    let alive = true;
    api.verifyEmail(token)
      .then((res) => { if (alive) setState({ phase: 'success', email: res?.email }); })
      .catch((err) => {
        if (!alive) return;
        const raw = err instanceof ApiError ? ((err.body as { error?: string })?.error || err.message) : 'generic';
        const code = typeof raw === 'string' && VERIFY_ERR_CODES.includes(raw) ? raw : 'generic';
        setState({ phase: 'error', code });
      });
    return () => { alive = false; };
  }, [api, token]);

  if (state.phase === 'verifying') {
    return (
      <AuthCardShell subtitle={t('verify.subtitle')}>
        <div className="text-center py-4">
          <Loader2 size={28} className="mx-auto mb-4 animate-spin text-slate-400" />
          <h2 className="text-lg font-semibold mb-1.5" style={{ color: 'var(--g-text)' }}>{t('verify.verifyingTitle')}</h2>
          <p className="text-[length:var(--g-text-base)] text-slate-400">{t('verify.verifyingBody')}</p>
        </div>
      </AuthCardShell>
    );
  }

  if (state.phase === 'success') {
    return (
      <AuthCardShell subtitle={t('verify.subtitle')}>
        <div className="text-center py-1">
          <div
            className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full"
            style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)' }}
          >
            <CheckCircle2 size={24} className="text-emerald-400" />
          </div>
          <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--g-text)' }}>{t('verify.successTitle')}</h2>
          <p className="text-[length:var(--g-text-base)] text-slate-400 mb-6 leading-relaxed">
            {state.email ? t('verify.successBodyEmail', { email: state.email }) : t('verify.successBody')}
          </p>
          <Link
            href={isAuthenticated ? '/app' : '/auth/login'}
            className="inline-flex items-center gap-1.5 text-blue-400 hover:text-blue-300 font-medium transition-colors text-[length:var(--g-text-base)]"
          >
            {isAuthenticated ? t('verify.goToApp') : t('verify.goToLogin')} <ArrowRight size={15} />
          </Link>
        </div>
      </AuthCardShell>
    );
  }

  // error
  const code = VERIFY_ERR_CODES.includes(state.code) ? state.code : 'generic';
  // used_token most often means "already verified" — treat it as a soft, reassuring state.
  const isReassuring = code === 'used_token';
  const errCopy = verifyErrorCopy(t, code);
  return (
    <AuthCardShell subtitle={t('verify.subtitle')}>
      <div className="text-center py-1">
        <div
          className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full"
          style={
            isReassuring
              ? { background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)' }
              : { background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.2)' }
          }
        >
          {isReassuring
            ? <CheckCircle2 size={24} className="text-emerald-400" />
            : <MailWarning size={22} className="text-yellow-400" />}
        </div>
        <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--g-text)' }}>{errCopy.title}</h2>
        <p className="text-[length:var(--g-text-base)] text-slate-400 mb-6 leading-relaxed">{errCopy.body}</p>

        {isReassuring ? (
          <Link
            href={isAuthenticated ? '/app' : '/auth/login'}
            className="inline-flex items-center gap-1.5 text-blue-400 hover:text-blue-300 font-medium transition-colors text-[length:var(--g-text-base)]"
          >
            {isAuthenticated ? t('verify.goToApp') : t('verify.goToLogin')} <ArrowRight size={15} />
          </Link>
        ) : (
          <ResendButton />
        )}
      </div>
    </AuthCardShell>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<AuthLoadingScreen />}>
      <VerifyEmailInner />
    </Suspense>
  );
}
