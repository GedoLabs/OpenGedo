'use client';

import type { ReactNode } from 'react';
import { Link } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import { motion } from 'framer-motion';

/**
 * Shared visual shell for the transactional-email auth pages
 * (forgot-password / reset-password / verify). Mirrors the login/signup
 * scaffold — landing-style background, GEDO wordmark, glass card, footer links —
 * so these pages sit visually alongside the existing auth flow.
 */
export function AuthCardShell({ subtitle, children }: { subtitle: string; children: ReactNode }) {
  const t = useTranslations('auth');
  return (
    <div className="relative min-h-screen flex items-center justify-center px-4 overflow-hidden" style={{ background: 'var(--g-bg)' }}>
      {/* Background — matches login/signup */}
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
            {subtitle}
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
          {children}
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

/** Full-screen loading state used as the Suspense fallback (matches login/signup). */
export function AuthLoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--g-bg)' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.png" alt="GEDO" width={40} height={40} className="animate-pulse opacity-60" style={{ objectFit: 'contain' }} />
    </div>
  );
}

/** Gradient submit button used across the email-flow forms (matches login/signup). */
export function AuthSubmitButton({
  isSubmitting,
  idleLabel,
  busyLabel,
  icon,
}: {
  isSubmitting: boolean;
  idleLabel: string;
  busyLabel: string;
  icon?: ReactNode;
}) {
  return (
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
          {busyLabel}
        </>
      ) : (
        <>
          {idleLabel}
          {icon}
        </>
      )}
    </motion.button>
  );
}
