'use client';

import { useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { motion } from 'framer-motion';
import { useAuth } from '@/app/contexts/AuthContext';
import { ArrowRight, Mail, Lock } from 'lucide-react';
import { SocialAuthButtons } from '../SocialAuthButtons';

function LoginPageContent() {
  const t = useTranslations('auth');
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login, isLoading: authLoading } = useAuth();
  const [email, setEmail] = useState(
    process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_DEMO_EMAIL
      ? process.env.NEXT_PUBLIC_DEMO_EMAIL
      : ''
  );
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);

    try {
      const accountLoc = await login(email, password);
      // Enter the app in the account's own language (falls back to the current
      // URL locale if the setting couldn't be read).
      goAfterAuth(accountLoc);
    } catch (err) {
      let errorMessage = t('errLoginFailed');
      if (err instanceof Error) {
        const message = err.message.toLowerCase();
        if (message.includes('failed to fetch') || message.includes('networkerror') || message.includes('network error')) {
          errorMessage = t('errNetwork');
        } else if (message.includes('401') || message.includes('bad_credentials')) {
          errorMessage = t('errBadCredentials');
        } else if (message.includes('400')) {
          errorMessage = t('errBadRequest');
        } else {
          errorMessage = err.message || errorMessage;
        }
      }
      setError(errorMessage);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Shared post-auth routing for both email and social sign-in.
  const goAfterAuth = (loc?: Locale) => {
    const next = searchParams.get('return') || searchParams.get('redirect');
    const dest = next && next.startsWith('/') && !next.startsWith('//') ? next : '/app';
    if (loc) router.push(dest, { locale: loc });
    else router.push(dest);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--g-bg)' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="GEDO" width={40} height={40} className="animate-pulse opacity-60" style={{ objectFit: 'contain' }} />
      </div>
    );
  }

  return (
    <div className="relative min-h-screen flex items-center justify-center px-4 overflow-hidden" style={{ background: 'var(--g-bg)' }}>
      {/* Background — matches landing page */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[900px] bg-blue-900/20 rounded-full blur-[140px] opacity-40" />
        <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-purple-900/15 rounded-full blur-[100px] opacity-30" />
        <div className="absolute top-1/3 right-0 w-[400px] h-[400px] bg-emerald-900/15 rounded-full blur-[80px] opacity-25" />
        <div className="absolute inset-0 bg-grid-pattern opacity-10" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="relative z-10 w-full max-w-md"
      >
        {/* Logo */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex flex-col items-center gap-3 group">
            <motion.div
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 200, damping: 15, delay: 0.1 }}
              className="flex items-center gap-3"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.png" alt="GEDO" width={40} height={40} style={{ objectFit: 'contain', flexShrink: 0 }} />
              <span className="text-3xl font-semibold tracking-tight" style={{ color: 'var(--g-text)' }}>
                GEDO
              </span>
            </motion.div>
          </Link>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6, duration: 0.4 }}
            className="mt-3 text-slate-400 text-[length:var(--g-text-base)]"
          >
            {t('loginSubtitle')}
          </motion.p>
        </div>

        {/* Card */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25, duration: 0.5 }}
          className="backdrop-blur-xl rounded-2xl p-8 shadow-2xl"
          style={{ background: 'var(--g-bg-raised)', border: '1px solid var(--g-border)', boxShadow: 'var(--g-shadow-card)' }}
        >
          {/* Social Login */}
          <SocialAuthButtons mode="login" onSuccess={() => goAfterAuth()} onError={setError} />

          {/* Divider */}
          <div className="flex items-center gap-3 mb-6">
            <div className="flex-1 h-px bg-slate-700/60" />
            <span className="text-[length:var(--g-text-sm)] text-slate-500 px-1">{t('orEmail')}</span>
            <div className="flex-1 h-px bg-slate-700/60" />
          </div>

          {/* Email Form */}
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
              <label htmlFor="email" className="block text-[length:var(--g-text-base)] font-medium text-slate-300 mb-1.5">
                {t('emailLabel')}
              </label>
              <div className="relative">
                <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="w-full pl-10 pr-4 py-3 rounded-xl bg-slate-800/60 border border-slate-700/60 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/50 transition-all text-[length:var(--g-text-base)]"
                  placeholder="your@email.com"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="password" className="block text-[length:var(--g-text-base)] font-medium text-slate-300">
                  {t('passwordLabel')}
                </label>
                <Link href="/auth/forgot-password" className="text-[length:var(--g-text-sm)] text-blue-400 hover:text-blue-300 transition-colors">
                  {t('forgotPassword')}
                </Link>
              </div>
              <div className="relative">
                <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                  className="w-full pl-10 pr-4 py-3 rounded-xl bg-slate-800/60 border border-slate-700/60 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/50 transition-all text-[length:var(--g-text-base)]"
                  placeholder="••••••••"
                />
              </div>
            </div>

            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3.5 rounded-xl bg-gradient-to-r from-blue-600 to-emerald-600 hover:from-blue-500 hover:to-emerald-500 text-white font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500/50 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-900/30"
            >
              {isSubmitting ? (
                <>
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  {t('loginSubmitting')}
                </>
              ) : (
                <>
                  {t('loginSubmit')}
                  <ArrowRight size={16} />
                </>
              )}
            </motion.button>
          </form>

          <div className="mt-6 text-center text-[length:var(--g-text-base)]">
            <span className="text-slate-500">{t('noAccount')}</span>
            <Link href="/auth/signup" className="ml-1.5 text-blue-400 hover:text-blue-300 font-medium transition-colors">
              {t('signupCta')}
            </Link>
          </div>

          {process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_DEMO_EMAIL && (
            <div className="mt-5 pt-5 border-t border-slate-700/50 text-center space-y-1">
              <p className="text-[length:var(--g-text-sm)] text-yellow-500/60">{t('devNotice')}</p>
            </div>
          )}
        </motion.div>

        {/* Footer */}
        <div className="mt-6 flex items-center justify-center gap-6 text-[length:var(--g-text-sm)] text-slate-600">
          <Link href="/" className="hover:text-slate-400 transition-colors">{t('backHome')}</Link>
          <span>·</span>
          <Link href="/pricing" className="hover:text-slate-400 transition-colors">{t('pricing')}</Link>
          <span>·</span>
          <Link href="/help" className="hover:text-slate-400 transition-colors">{t('helpCenter')}</Link>
        </div>
      </motion.div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--g-bg)' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="GEDO" width={40} height={40} className="animate-pulse opacity-60" style={{ objectFit: 'contain' }} />
        </div>
      }
    >
      <LoginPageContent />
    </Suspense>
  );
}
