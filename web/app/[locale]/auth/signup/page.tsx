'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import type { Locale } from '@/i18n/routing';
import { motion } from 'framer-motion';
import { useAuth } from '@/app/contexts/AuthContext';
import { ArrowRight, Mail, Lock } from 'lucide-react';
import { sanitizeReturnPath } from '@/lib/sanitizeReturnPath';
import { ApiError, fetchAuthConfig, type AuthConfig } from '@/lib/apiClient';
import { isOSS } from '@/lib/edition';
import { SocialAuthButtons } from '../SocialAuthButtons';

function SignupPageLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--g-bg)' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.png" alt="GEDO" width={40} height={40} className="animate-pulse opacity-60" style={{ objectFit: 'contain' }} />
    </div>
  );
}

function SignupPageInner() {
  const t = useTranslations('auth');
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = sanitizeReturnPath(searchParams.get('returnTo'));
  const { signup, isLoading: authLoading, api, setPreferredLocale } = useAuth();

  const loginHref = returnTo
    ? `/auth/login?returnTo=${encodeURIComponent(returnTo)}`
    : '/auth/login';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 注册模式：默认按开放注册处理（config 未回或失败也可注册），后端为唯一权威。
  const [regConfig, setRegConfig] = useState<AuthConfig | null>(null);
  useEffect(() => {
    let alive = true;
    fetchAuthConfig().then((c) => { if (alive) setRegConfig(c); }).catch(() => { /* 兜底：开放注册 */ });
    return () => { alive = false; };
  }, []);
  const inviteRequired = regConfig?.invite_required ?? false;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError(t('errPasswordMismatch'));
      return;
    }
    if (password.length < 6) {
      setError(t('errPasswordTooShort'));
      return;
    }

    setIsSubmitting(true);
    try {
      await signup(email, password, inviteCode || undefined);
      // New account: adopt the locale it was created in as the account language.
      setPreferredLocale(locale as Locale);
      api.updateSettings({ language: locale }).catch(() => { /* ignore */ });
      goAfterAuth();
    } catch (err) {
      if (err instanceof ApiError && (err.status === 409 || (err.body as { error?: string })?.error === 'email_taken')) {
        setError(t('errEmailTaken'));
      } else if (err instanceof ApiError && err.status === 403) {
        setError(t('errInvalidInvite'));
        // 达量瞬间（加载时开放、提交时已满）：刷新配置让邀请字段与横幅出现。
        fetchAuthConfig().then(setRegConfig).catch(() => { /* 保持原状 */ });
      } else {
        setError(err instanceof Error ? err.message : t('errSignupFailed'));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Shared post-auth routing for both email and social sign-up.
  const goAfterAuth = () => {
    router.push(returnTo ?? '/app');
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
    <div className="relative min-h-screen flex items-center justify-center px-4 overflow-hidden py-10" style={{ background: 'var(--g-bg)' }}>
      {/* Background — matches landing page */}
      <div className="absolute inset-0 z-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[900px] bg-blue-900/20 rounded-full blur-[140px] opacity-40" />
        <div className="absolute bottom-0 right-0 w-[500px] h-[500px] bg-purple-900/15 rounded-full blur-[100px] opacity-30" />
        <div className="absolute top-1/2 left-0 w-[400px] h-[400px] bg-emerald-900/15 rounded-full blur-[80px] opacity-25" />
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
            {t('signupSubtitle')}
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
          {/* 限量开放注册提示：limited 时展示剩余名额；名额已满转为「需邀请码」 */}
          {regConfig?.limited && (
            <div
              className="mb-5 p-3.5 rounded-xl text-center text-[length:var(--g-text-sm)]"
              style={{
                background: inviteRequired ? 'rgba(245,158,11,0.10)' : 'rgba(16,185,129,0.10)',
                border: `1px solid ${inviteRequired ? 'rgba(245,158,11,0.25)' : 'rgba(16,185,129,0.25)'}`,
                color: inviteRequired ? '#fbbf24' : '#34d399',
              }}
            >
              {inviteRequired
                ? t('openRegFull')
                : t('openRegRemaining', { count: regConfig.remaining ?? 0, capacity: regConfig.capacity ?? 0 })}
            </div>
          )}

          {/* Social Login */}
          <SocialAuthButtons
            mode="signup"
            inviteRequired={inviteRequired}
            getInviteCode={() => inviteCode}
            onSuccess={goAfterAuth}
            onError={setError}
          />

          {/* Divider */}
          <div className="flex items-center gap-3 mb-6">
            <div className="flex-1 h-px bg-slate-700/60" />
            <span className="text-[length:var(--g-text-sm)] text-slate-500 px-1">{t('orEmailSignup')}</span>
            <div className="flex-1 h-px bg-slate-700/60" />
          </div>

          {/* Email Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
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

            {/* 邀请码字段仅在需要时出现（开放注册期隐藏）。 */}
            {inviteRequired && (
              <div>
                <label htmlFor="inviteCode" className="block text-[length:var(--g-text-base)] font-medium text-slate-300 mb-1.5">
                  {t('inviteLabel')}
                </label>
                <div className="relative">
                  <input
                    id="inviteCode"
                    type="text"
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value)}
                    required
                    className="w-full px-4 py-3 rounded-xl bg-slate-800/60 border border-slate-700/60 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/50 transition-all text-[length:var(--g-text-base)]"
                    placeholder={t('invitePlaceholder')}
                  />
                </div>
                <p className="mt-1 text-[length:var(--g-text-sm)] text-slate-500">
                  {t('inviteHint')}
                </p>
              </div>
            )}

            <div>
              <label htmlFor="password" className="block text-[length:var(--g-text-base)] font-medium text-slate-300 mb-1.5">
                {t('passwordLabel')}
              </label>
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
                  placeholder={t('passwordPlaceholderSignup')}
                />
              </div>
            </div>

            <div>
              <label htmlFor="confirmPassword" className="block text-[length:var(--g-text-base)] font-medium text-slate-300 mb-1.5">
                {t('confirmPasswordLabel')}
              </label>
              <div className="relative">
                <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  minLength={6}
                  className="w-full pl-10 pr-4 py-3 rounded-xl bg-slate-800/60 border border-slate-700/60 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/50 transition-all text-[length:var(--g-text-base)]"
                  placeholder={t('confirmPasswordPlaceholder')}
                />
              </div>
            </div>

            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3.5 rounded-xl bg-gradient-to-r from-blue-600 to-emerald-600 hover:from-blue-500 hover:to-emerald-500 text-white font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500/50 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-900/30 mt-2"
            >
              {isSubmitting ? (
                <>
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  {t('signupSubmitting')}
                </>
              ) : (
                <>
                  {t('signupSubmit')}
                  <ArrowRight size={16} />
                </>
              )}
            </motion.button>

            <p className="text-[length:var(--g-text-sm)] text-slate-500 text-center pt-1">
              {t('termsAgree')}{' '}
              <Link href="/terms" className="text-slate-400 hover:text-slate-300 underline underline-offset-2">{t('termsOfService')}</Link>
              {' '}{t('and')}{' '}
              <Link href="/privacy" className="text-slate-400 hover:text-slate-300 underline underline-offset-2">{t('privacyPolicy')}</Link>
            </p>
          </form>

          <div className="mt-5 text-center text-[length:var(--g-text-base)]">
            <span className="text-slate-500">{t('haveAccount')}</span>
            <Link href={loginHref} className="ml-1.5 text-blue-400 hover:text-blue-300 font-medium transition-colors">
              {t('loginCta')}
            </Link>
          </div>
        </motion.div>

        {/* Footer（营销页链接仅 cloud：OSS 下这些路由会被重定向回登录页，纯噪音） */}
        {!isOSS() && (
          <div className="mt-6 flex items-center justify-center gap-6 text-[length:var(--g-text-sm)] text-slate-600">
            <Link href="/" className="hover:text-slate-400 transition-colors">{t('backHome')}</Link>
            <span>·</span>
            <Link href="/pricing" className="hover:text-slate-400 transition-colors">{t('pricing')}</Link>
            <span>·</span>
            <Link href="/help" className="hover:text-slate-400 transition-colors">{t('helpCenter')}</Link>
          </div>
        )}
      </motion.div>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={<SignupPageLoading />}>
      <SignupPageInner />
    </Suspense>
  );
}
