'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { motion } from 'framer-motion';
import { useAuth } from '@/app/contexts/AuthContext';
import { ApiError } from '@/lib/apiClient';
import { AuthCardShell, AuthLoadingScreen, AuthSubmitButton } from '@/app/components/auth/AuthCardShell';
import { ArrowRight, ArrowLeft, Lock, ShieldCheck, AlertTriangle } from 'lucide-react';

type TFn = ReturnType<typeof useTranslations>;

// 400 错误码(见 server.mjs /v1/auth/reset-password + store.consumeEmailToken)。
const RESET_ERR_CODES = ['invalid_token', 'used_token', 'expired_token', 'weak_password'];

function mapResetErr(t: TFn, err: unknown): string {
  if (err instanceof ApiError) {
    const code = (err.body as { error?: string })?.error || err.message;
    if (typeof code === 'string' && RESET_ERR_CODES.includes(code)) return t(`reset.err.${code}`);
    if (err.status === 429) return t('forgot.errRateLimited');
  }
  if (err instanceof Error && /fetch|network/i.test(err.message)) return t('errNetwork');
  return t('reset.err.generic');
}

function ResetPasswordInner() {
  const t = useTranslations('auth');
  const router = useRouter();
  const { api } = useAuth();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') || '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password.length < 6) { setError(t('reset.err.weak_password')); return; }
    if (password !== confirm) { setError(t('reset.errMismatch')); return; }
    setIsSubmitting(true);
    try {
      await api.resetPassword(token, password);
      setDone(true);
      // Give the user a beat to read the confirmation, then send them to login.
      setTimeout(() => router.push('/auth/login'), 1800);
    } catch (err) {
      setError(mapResetErr(t, err));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Link arrived with no token at all — nothing to reset.
  if (!token) {
    return (
      <AuthCardShell subtitle={t('reset.subtitle')}>
        <div className="text-center py-1">
          <div
            className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full"
            style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}
          >
            <AlertTriangle size={22} className="text-red-400" />
          </div>
          <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--g-text)' }}>{t('reset.err.invalid_token')}</h2>
          <p className="text-[length:var(--g-text-base)] text-slate-400 mb-6 leading-relaxed">{t('reset.invalidBody')}</p>
          <Link
            href="/auth/forgot-password"
            className="inline-flex items-center gap-1.5 text-blue-400 hover:text-blue-300 font-medium transition-colors text-[length:var(--g-text-base)]"
          >
            {t('reset.requestNew')} <ArrowRight size={15} />
          </Link>
        </div>
      </AuthCardShell>
    );
  }

  if (done) {
    return (
      <AuthCardShell subtitle={t('reset.subtitle')}>
        <div className="text-center py-1">
          <div
            className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full"
            style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)' }}
          >
            <ShieldCheck size={22} className="text-emerald-400" />
          </div>
          <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--g-text)' }}>{t('reset.successTitle')}</h2>
          <p className="text-[length:var(--g-text-base)] text-slate-400 mb-6 leading-relaxed">{t('reset.successBody')}</p>
          <Link
            href="/auth/login"
            className="inline-flex items-center gap-1.5 text-blue-400 hover:text-blue-300 font-medium transition-colors text-[length:var(--g-text-base)]"
          >
            {t('reset.goToLogin')} <ArrowRight size={15} />
          </Link>
        </div>
      </AuthCardShell>
    );
  }

  return (
    <AuthCardShell subtitle={t('reset.subtitle')}>
      <div className="mb-6">
        <h2 className="text-lg font-semibold mb-1.5" style={{ color: 'var(--g-text)' }}>{t('reset.title')}</h2>
        <p className="text-[length:var(--g-text-sm)] text-slate-400 leading-relaxed">{t('reset.hint')}</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-[length:var(--g-text-base)]"
          >
            {error}
          </motion.div>
        )}

        <div>
          <label htmlFor="new-password" className="block text-[length:var(--g-text-base)] font-medium text-slate-300 mb-1.5">
            {t('reset.newPasswordLabel')}
          </label>
          <div className="relative">
            <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              autoFocus
              className="w-full pl-10 pr-4 py-3 rounded-xl bg-slate-800/60 border border-slate-700/60 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/50 transition-all text-[length:var(--g-text-base)]"
              placeholder={t('reset.newPasswordPlaceholder')}
            />
          </div>
        </div>

        <div>
          <label htmlFor="confirm-password" className="block text-[length:var(--g-text-base)] font-medium text-slate-300 mb-1.5">
            {t('reset.confirmLabel')}
          </label>
          <div className="relative">
            <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              minLength={6}
              className="w-full pl-10 pr-4 py-3 rounded-xl bg-slate-800/60 border border-slate-700/60 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/50 transition-all text-[length:var(--g-text-base)]"
              placeholder={t('reset.confirmPlaceholder')}
            />
          </div>
        </div>

        <AuthSubmitButton
          isSubmitting={isSubmitting}
          idleLabel={t('reset.submit')}
          busyLabel={t('reset.submitting')}
          icon={<ArrowRight size={16} />}
        />
      </form>

      <div className="mt-6 text-center text-[length:var(--g-text-base)]">
        <Link href="/auth/login" className="inline-flex items-center gap-1.5 text-slate-500 hover:text-slate-300 transition-colors">
          <ArrowLeft size={14} /> {t('forgot.backToLogin')}
        </Link>
      </div>
    </AuthCardShell>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<AuthLoadingScreen />}>
      <ResetPasswordInner />
    </Suspense>
  );
}
