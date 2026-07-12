import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';

export default async function AppHome() {
  const locale = await getLocale();
  // /app is the chat-first home — redirect to the redesigned 智伴 module.
  redirect({ href: '/app/companion', locale });
}
