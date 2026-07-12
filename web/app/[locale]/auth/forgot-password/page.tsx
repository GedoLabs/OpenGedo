'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { motion } from 'framer-motion';
import { useAuth } from '@/app/contexts/AuthContext';
import { ApiError } from '@/lib/apiClient';
import { AuthCardShell, AuthSubmitButton } from '@/app/components/auth/AuthCardShell';
import { ArrowRight, ArrowLeft, Mail, MailCheck } from 'lucide-react';

export default function ForgotPasswordPage() {
  const t = useTranslations('auth');
  const { api } = useAuth();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);
    try {
      await api.forgotPassword(email.trim());
      // The endpoint returns 200 for both existing and unknown emails — never
      // reveal which. Show the same neutral confirmation regardless.
      setSent(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setError(t('forgot.errRateLimited'));
      } else if (err instanceof Error && /fetch|network/i.test(err.message)) {
        setError(t('errNetwork'));
      } else {
        setError(t('forgot.errGeneric'));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthCardShell subtitle={t('forgot.subtitle')}>
      {sent ? (
        <div className="text-center py-1">
          <div
            className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full"
            style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)' }}
          >
            <MailCheck size={22} className="text-emerald-400" />
          </div>
          <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--g-text)' }}>{t('forgot.sentTitle')}</h2>
          <p className="text-[length:var(--g-text-base)] text-slate-400 mb-6 leading-relaxed">
            {t('forgot.sentBody', { email: email.trim() })}
          </p>
          <Link
            href="/auth/login"
            className="inline-flex items-center gap-1.5 text-blue-400 hover:text-blue-300 font-medium transition-colors text-[length:var(--g-text-base)]"
          >
            <ArrowLeft size={15} /> {t('forgot.backToLogin')}
          </Link>
        </div>
      ) : (
        <>
          <div className="mb-6">
            <h2 className="text-lg font-semibold mb-1.5" style={{ color: 'var(--g-text)' }}>{t('forgot.title')}</h2>
            <p className="text-[length:var(--g-text-sm)] text-slate-400 leading-relaxed">{t('forgot.hint')}</p>
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
                  autoFocus
                  className="w-full pl-10 pr-4 py-3 rounded-xl bg-slate-800/60 border border-slate-700/60 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500/50 transition-all text-[length:var(--g-text-base)]"
                  placeholder="your@email.com"
                />
              </div>
            </div>

            <AuthSubmitButton
              isSubmitting={isSubmitting}
              idleLabel={t('forgot.submit')}
              busyLabel={t('forgot.submitting')}
              icon={<ArrowRight size={16} />}
            />
          </form>

          <div className="mt-6 text-center text-[length:var(--g-text-base)]">
            <Link href="/auth/login" className="inline-flex items-center gap-1.5 text-slate-500 hover:text-slate-300 transition-colors">
              <ArrowLeft size={14} /> {t('forgot.backToLogin')}
            </Link>
          </div>
        </>
      )}
    </AuthCardShell>
  );
}
