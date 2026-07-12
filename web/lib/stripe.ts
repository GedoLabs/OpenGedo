import Stripe from 'stripe';

export type PlanTier = 'pro' | 'ultra';
export type BillingInterval = 'monthly' | 'yearly';

let cachedClient: Stripe | null = null;

export function getStripe(): Stripe {
  if (cachedClient) return cachedClient;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error('STRIPE_SECRET_KEY is not configured');
  }
  cachedClient = new Stripe(key, {
    apiVersion: '2026-02-25.clover',
    typescript: true,
    appInfo: {
      name: 'GEDO AI Web',
      version: '0.1.0',
    },
  });
  return cachedClient;
}

/**
 * Resolve a Stripe Price ID from the current tier + billing interval combination.
 * Returns null when the matching env var is not configured.
 */
export function resolvePriceId(
  tier: PlanTier,
  interval: BillingInterval
): string | null {
  const table: Record<PlanTier, Record<BillingInterval, string | undefined>> = {
    pro: {
      monthly: process.env.STRIPE_PRICE_MONTHLY,
      yearly: process.env.STRIPE_PRICE_YEARLY,
    },
    ultra: {
      monthly: process.env.STRIPE_PRICE_ULTRA_MONTHLY,
      yearly: process.env.STRIPE_PRICE_ULTRA_YEARLY,
    },
  };
  return table[tier][interval] ?? null;
}

/** Ultra > Pro for resolving duplicate subscriptions. */
export function tierRank(tier: PlanTier): number {
  return tier === 'ultra' ? 2 : 1;
}

/** Map a configured Price ID back to tier + billing interval. */
export function parseTierAndIntervalFromPriceId(
  priceId: string
): { tier: PlanTier; interval: BillingInterval } | null {
  const pairs: [PlanTier, BillingInterval][] = [
    ['pro', 'monthly'],
    ['pro', 'yearly'],
    ['ultra', 'monthly'],
    ['ultra', 'yearly'],
  ];
  for (const [tier, interval] of pairs) {
    const id = resolvePriceId(tier, interval);
    if (id && id === priceId) {
      return { tier, interval };
    }
  }
  return null;
}

/**
 * Build a canonical site URL for Checkout success / cancel / portal return URLs.
 * Priority: NEXT_PUBLIC_SITE_URL → request origin → localhost fallback.
 */
export function resolveSiteUrl(originFallback?: string | null): string {
  const envUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (envUrl) return envUrl.replace(/\/$/, '');
  if (originFallback) return originFallback.replace(/\/$/, '');
  return 'http://localhost:3000';
}

/** Active or trialing subscriptions only (same semantics as checkout route). */
export function getActiveLikeSubscriptions(
  subs: Stripe.Subscription[]
): Stripe.Subscription[] {
  return subs.filter((s) => s.status === 'active' || s.status === 'trialing');
}

/** Highest tier first, then most recently created. */
export function sortSubsByTierThenRecency(
  subs: Stripe.Subscription[]
): Stripe.Subscription[] {
  return [...subs].sort((a, b) => {
    const pa = a.items.data[0]?.price?.id;
    const pb = b.items.data[0]?.price?.id;
    const ta = pa ? parseTierAndIntervalFromPriceId(pa) : null;
    const tb = pb ? parseTierAndIntervalFromPriceId(pb) : null;
    const ra = ta ? tierRank(ta.tier) : 0;
    const rb = tb ? tierRank(tb.tier) : 0;
    if (rb !== ra) return rb - ra;
    return b.created - a.created;
  });
}

export type BillingSummary = {
  tier: 'free' | PlanTier;
  interval: BillingInterval | null;
  status: string | null;
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean | null;
};

/**
 * Resolve the user's effective paid tier from Stripe by account email.
 * Returns free tier when Stripe is unavailable or there is no matching customer/subscription.
 */
export async function getBillingSummaryForEmail(
  email: string
): Promise<BillingSummary> {
  const empty: BillingSummary = {
    tier: 'free',
    interval: null,
    status: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: null,
  };
  if (!email?.trim()) return empty;
  try {
    const stripe = getStripe();
    const customers = await stripe.customers.list({
      email: email.trim(),
      limit: 1,
    });
    const customer = customers.data[0];
    if (!customer) return empty;

    const allSubs = await stripe.subscriptions.list({
      customer: customer.id,
      status: 'all',
      limit: 100,
    });
    const active = getActiveLikeSubscriptions(allSubs.data);
    const sorted = sortSubsByTierThenRecency(active);
    const primary = sorted[0];
    if (!primary) return empty;

    const firstItem = primary.items.data[0];
    const priceId = firstItem?.price?.id;
    const parsed = priceId ? parseTierAndIntervalFromPriceId(priceId) : null;
    const periodEnd =
      (firstItem?.current_period_end as number | undefined) ??
      (primary as unknown as { current_period_end?: number }).current_period_end ??
      null;
    const cancelEnd =
      (primary as unknown as { cancel_at_period_end?: boolean | null })
        .cancel_at_period_end ?? null;
    return {
      tier: parsed?.tier ?? 'free',
      interval: parsed?.interval ?? null,
      status: primary.status,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: cancelEnd,
    };
  } catch {
    return empty;
  }
}
