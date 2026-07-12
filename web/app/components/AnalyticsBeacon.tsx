'use client';

import { useEffect } from 'react';
import { usePathname, useParams } from 'next/navigation';
import { trackPageview } from '@/lib/analytics';

/** Mounted once in the locale root layout — covers every page (marketing, product app, /sim). */
export function AnalyticsBeacon() {
  const pathname = usePathname();
  const params = useParams();

  useEffect(() => {
    const locale = typeof params?.locale === 'string' ? params.locale : undefined;
    trackPageview(pathname, locale);
  }, [pathname, params]);

  return null;
}
