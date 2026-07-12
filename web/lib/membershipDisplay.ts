/** Mirrors server `BillingSummary` / Stripe tier names — keep in sync with `lib/stripe.ts`. */
export type PlanTier = 'pro' | 'ultra';
export type BillingInterval = 'monthly' | 'yearly';
export type MembershipTier = 'free' | PlanTier;

export interface MembershipInfo {
  tier: MembershipTier;
  interval: BillingInterval | null;
  status: string | null;
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean | null;
}

export interface UsageSlot {
  used: number;
  limit: number | null;
  kind?: 'percent' | 'status';
  percent?: number | null;
  level?: 'normal' | 'high' | 'near_limit' | null;
}

export interface EntitlementsSummary {
  tier: MembershipTier;
  usage?: {
    smart?: UsageSlot;
    visitor?: UsageSlot | null;
    images?: { used: number; limit: number | null };
    profileRefresh?: { used: number; limit: number | null };
    activeGoals?: { used: number; limit: number | null };
    memoryItems?: { used: number; limit: number | null };
  };
}

export function membershipTierLabelZh(tier: MembershipTier): string {
  switch (tier) {
    case 'free':
      return '免费版';
    case 'pro':
      return 'Pro 会员';
    case 'ultra':
      return 'Ultra 会员';
    default:
      return '免费版';
  }
}

export function membershipTierLabel(
  tier: MembershipTier,
  lang: 'zh' | 'en' | 'ja'
): string {
  if (lang === 'zh') return membershipTierLabelZh(tier);
  if (lang === 'ja') {
    switch (tier) {
      case 'pro':
        return 'Pro 会員';
      case 'ultra':
        return 'Ultra 会員';
      default:
        return '無料版';
    }
  }
  switch (tier) {
    case 'free':
      return 'Free';
    case 'pro':
      return 'Pro';
    case 'ultra':
      return 'Ultra';
    default:
      return 'Free';
  }
}

export function billingIntervalLabelZh(interval: BillingInterval | null): string {
  if (interval === 'monthly') return '月付';
  if (interval === 'yearly') return '年付';
  return '—';
}

export function formatPeriodEndTs(ts: number | null, locale = 'zh-CN'): string {
  if (ts == null) return '—';
  try {
    return new Date(ts * 1000).toLocaleDateString(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '—';
  }
}
