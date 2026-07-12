import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';

export default async function AuthPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const locale = await getLocale();
  const params = await searchParams;
  if (params.mode === 'signup') {
    redirect({ href: '/auth/signup', locale });
  }
  redirect({ href: '/auth/login', locale });
}
