'use client';

import { cn } from '@/lib/utils';
import type { MembershipTier } from '@/lib/membershipDisplay';
import { membershipTierLabel } from '@/lib/membershipDisplay';

type Props = {
  tier: MembershipTier;
  className?: string;
  compact?: boolean;
  /** Defaults to Chinese labels (sidebar / settings). Pass the active locale to localize. */
  language?: 'zh' | 'en' | 'ja';
};

export function MembershipBadge({ tier, className, compact, language = 'zh' }: Props) {
  const label = membershipTierLabel(tier, language);
  const styles =
    tier === 'ultra'
      ? 'bg-violet-500/15 text-violet-300 border-violet-500/30'
      : tier === 'pro'
        ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
        : 'bg-slate-700/50 text-slate-400 border-slate-600/50';

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border font-medium whitespace-nowrap',
        compact ? 'text-[length:var(--g-text-2xs)] px-1.5 py-0.5' : 'text-[length:var(--g-text-sm)] px-2 py-0.5',
        styles,
        className
      )}
      title={label}
    >
      {label}
    </span>
  );
}
