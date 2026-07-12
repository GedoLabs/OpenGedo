import { isOSS } from '../lib/edition.mjs';
import { normalizeTier, getEntitlementsForTier, formatUsageDisplay } from '../lib/entitlements.mjs';
import { creditsForFeature } from '../lib/usage-credits.mjs';
import { listEpisodes } from '../memory/memory-file.service.mjs';

/**
 * @param {ReturnType<import('../lib/store.mjs').Store>} store
 */
export function createBillingService(store) {
  const DONE_GOAL = new Set(['completed', 'archived', 'cancelled', 'abandoned']);

  function resolveUserTier(userId) {
    const bc = store.getBillingCustomer(userId);
    if (!bc) return 'free';
    const status = String(bc.status || '').toLowerCase();
    if (status === 'active' || status === 'trialing') {
      return normalizeTier(bc.tier);
    }
    return 'free';
  }

  function getBillingStatus(userId) {
    const bc = store.getBillingCustomer(userId);
    if (!bc) {
      return {
        tier: 'free',
        interval: null,
        status: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: null,
      };
    }
    const tier = resolveUserTier(userId);
    return {
      tier,
      interval: bc.interval || null,
      status: bc.status || null,
      currentPeriodEnd: bc.current_period_end || null,
      cancelAtPeriodEnd: bc.cancel_at_period_end ?? null,
      provider: bc.provider || 'stripe',
    };
  }

  function upsertFromStripePayload(payload) {
    const userId = payload.userId;
    if (!userId) return null;
    const tier = normalizeTier(payload.tier || 'free');
    const status = payload.status || (payload.stripeEventType?.includes('deleted') ? 'canceled' : null);
    const active = status === 'active' || status === 'trialing';
    let interval = null;
    const plan = String(payload.plan || '').toLowerCase();
    if (plan.includes('year')) interval = 'yearly';
    else if (plan.includes('month')) interval = 'monthly';

    return store.upsertBillingCustomer({
      user_id: userId,
      stripe_customer_id: payload.customerId || null,
      stripe_subscription_id: payload.subscriptionId || null,
      provider: 'stripe',
      tier: active ? tier : 'free',
      interval,
      status: status || 'canceled',
      current_period_end: payload.currentPeriodEnd || null,
      cancel_at_period_end: payload.cancelAtPeriodEnd ?? false,
    });
  }

  // ── RevenueCat(跨渠道 entitlement 中枢)──────────────────────────────────
  // 商品 ID 三端对齐:ai.gedo.{pro|ultra}.{monthly|yearly};tier 优先取 RC
  // entitlement_ids(跨渠道稳定,Stripe 汇入后 product_id 是 price_xxx 也不受影响)。
  const RC_STORE_PROVIDERS = {
    APP_STORE: 'app_store',
    MAC_APP_STORE: 'app_store',
    PLAY_STORE: 'play_store',
    STRIPE: 'stripe',
    PROMOTIONAL: 'promo',
  };

  function rcTierOf(event) {
    const ids = Array.isArray(event.entitlement_ids) ? event.entitlement_ids : [];
    if (ids.includes('ultra')) return 'ultra';
    if (ids.includes('pro')) return 'pro';
    const product = String(event.new_product_id || event.product_id || '');
    if (product.includes('.ultra.')) return 'ultra';
    if (product.includes('.pro.')) return 'pro';
    return null;
  }

  function rcIntervalOf(event) {
    const product = String(event.new_product_id || event.product_id || '').toLowerCase();
    if (product.includes('year') || product.includes('annual')) return 'yearly';
    if (product.includes('month')) return 'monthly';
    return null;
  }

  /**
   * RC webhook 事件 → billing_customers upsert。
   * 返回 null = 事件与 entitlement 无关(TEST/未知类型),调用方仍应回 200。
   * 生命周期语义:CANCELLATION 只是关自动续订(权益保留到期);EXPIRATION 才收回。
   */
  function upsertFromRevenueCatEvent(event) {
    if (!event || typeof event !== 'object') return null;
    const type = String(event.type || '').toUpperCase();
    const userId = event.app_user_id;
    if (!userId || type === 'TEST') return null;
    const user = store.getUserById(userId);
    if (!user) {
      console.warn('[billing] RC event for unknown app_user_id:', userId, type);
      return null;
    }

    const tier = rcTierOf(event);
    const interval = rcIntervalOf(event);
    const provider = RC_STORE_PROVIDERS[String(event.store || '').toUpperCase()] || 'app_store';
    const periodEnd = event.expiration_at_ms ? Math.floor(event.expiration_at_ms / 1000) : null;
    const prev = store.getBillingCustomer(userId);

    const base = {
      user_id: userId,
      provider,
      interval: interval || prev?.interval || null,
      current_period_end: periodEnd ?? prev?.current_period_end ?? null,
    };

    switch (type) {
      case 'INITIAL_PURCHASE':
      case 'RENEWAL':
      case 'PRODUCT_CHANGE':
      case 'UNCANCELLATION':
        if (!tier) return null;
        return store.upsertBillingCustomer({ ...base, tier, status: 'active', cancel_at_period_end: false });
      case 'CANCELLATION':
        // 关自动续订:权益保留到 current_period_end,不降 tier
        return store.upsertBillingCustomer({
          ...base,
          tier: tier || prev?.tier || 'free',
          status: prev?.status || 'active',
          cancel_at_period_end: true,
        });
      case 'BILLING_ISSUE':
        // 宽限期内保留权益;真正收回统一由 EXPIRATION 触发
        return store.upsertBillingCustomer({
          ...base,
          tier: tier || prev?.tier || 'free',
          status: prev?.status || 'active',
          cancel_at_period_end: prev?.cancel_at_period_end ?? false,
        });
      case 'EXPIRATION':
        return store.upsertBillingCustomer({ ...base, tier: 'free', status: 'expired', cancel_at_period_end: false });
      default:
        return null;
    }
  }

  function countActiveGoals(userId) {
    return store.listGoals(userId).filter(
      (g) => !g.parent_id && !DONE_GOAL.has(g.status)
    ).length;
  }

  function getMonthlyUsage(userId) {
    const period = currentBillingPeriod();
    const events = store.listUsageEvents(userId, { billingPeriod: period });
    let smart = 0;
    let visitor = 0;
    let images = 0;
    let profileRefresh = 0;
    let importSources = 0;
    for (const e of events) {
      smart += e.credits_deducted || 0;
      visitor += e.visitor_credits_deducted || 0;
      images += e.image_count || 0;
      if (e.feature === 'profile.deep_refresh') profileRefresh += 1;
      // 来源中心：来源创建按 0 积分事件计数（删除不返还——防"删了再导"绕配额）
      if (e.feature === 'memory.import_source') importSources += 1;
    }
    return { smart, visitor, images, profileRefresh, importSources, billingPeriod: period };
  }

  function getEntitlementsSummary(userId) {
    const tier = resolveUserTier(userId);
    const ent = getEntitlementsForTier(tier);
    const usage = getMonthlyUsage(userId);
    const activeGoals = countActiveGoals(userId);
    const memoryCount = listEpisodes(userId, { limit: 100000, includeExcluded: true }).length;

    const smartDisplay = formatUsageDisplay(tier, usage.smart, ent.smartCreditsMonthly);
    // 分身额度对所有有额度的付费档展示（Pro 体验级 + Ultra 基础使用）；Free 无分身额度→null。
    const visitorDisplay = ent.personaVisitorRepliesMonthly > 0
      ? { kind: 'percent', percent: Math.min(100, Math.round((usage.visitor / ent.personaVisitorRepliesMonthly) * 100)),
          level: usageLevel(usage.visitor, ent.personaVisitorRepliesMonthly) }
      : null;

    return {
      tier,
      entitlements: ent,
      usage: {
        smart: { used: usage.smart, limit: ent.smartCreditsMonthly, ...smartDisplay },
        visitor: visitorDisplay
          ? { used: usage.visitor, limit: ent.personaVisitorRepliesMonthly, ...visitorDisplay }
          : null,
        images: { used: usage.images, limit: ent.imagesMonthly },
        profileRefresh: { used: usage.profileRefresh, limit: ent.profileRefreshMonthly },
        activeGoals: { used: activeGoals, limit: ent.activeGoalsLimit },
        memoryItems: { used: memoryCount, limit: ent.memoryItemsLimit },
        importSources: { used: usage.importSources, limit: ent.importSourcesMonthly },
      },
    };
  }

  /**
   * @param {string} userId
   * @param {'goals'|'memory'|'persona_publish'|'smart'|'visitor'|'images'|'profile_refresh'|'import_sources'} kind
   * @param {{ feature?: string, credits?: number, imageCount?: number, complex?: boolean }} [opts]
   */
  function checkEntitlement(userId, kind, opts = {}) {
    if (isOSS()) return null;
    const tier = resolveUserTier(userId);
    const ent = getEntitlementsForTier(tier);
    const usage = getMonthlyUsage(userId);

    if (kind === 'import_sources' && ent.importSourcesMonthly != null) {
      if (usage.importSources >= ent.importSourcesMonthly) {
        return quotaError('import_sources', tier === 'free' ? 'pro' : 'ultra', tier);
      }
    }

    if (kind === 'goals' && ent.activeGoalsLimit != null) {
      const active = countActiveGoals(userId);
      if (active >= ent.activeGoalsLimit) {
        return quotaError('active_goals', 'pro', tier);
      }
    }
    if (kind === 'memory' && ent.memoryItemsLimit != null) {
      const count = listEpisodes(userId, { limit: 100000, includeExcluded: true }).length;
      if (count >= ent.memoryItemsLimit) {
        return quotaError('memory_items', 'pro', tier);
      }
    }
    if (kind === 'persona_publish') {
      if (ent.personaPublishLimit < 1) {
        return quotaError('persona_publish', 'pro', tier);
      }
    }
    if (kind === 'smart') {
      const feature = opts.feature || 'chat.normal';
      const { smart } = opts.credits != null
        ? { smart: opts.credits }
        : creditsForFeature(feature, opts);
      if (smart > 0 && usage.smart + smart > ent.smartCreditsMonthly) {
        return quotaError('smart_credits', tier === 'free' ? 'pro' : 'ultra', tier);
      }
    }
    if (kind === 'visitor') {
      const { visitor } = creditsForFeature(opts.feature || 'persona.visitor_reply', opts);
      if (visitor > 0 && usage.visitor + visitor > ent.personaVisitorRepliesMonthly) {
        return quotaError('visitor_replies', 'ultra', tier);
      }
    }
    if (kind === 'profile_refresh' && ent.profileRefreshMonthly <= 0) {
      return quotaError('profile_refresh', 'pro', tier);
    }
    if (kind === 'profile_refresh' && usage.profileRefresh >= ent.profileRefreshMonthly) {
      return quotaError('profile_refresh', tier === 'pro' ? 'ultra' : 'ultra', tier);
    }
    return null;
  }

  function recordUsage(userId, feature, opts = {}) {
    const { smart, visitor } = opts.credits != null
      ? { smart: opts.credits, visitor: 0 }
      : creditsForFeature(feature, opts);
    if (smart === 0 && visitor === 0 && !opts.force) return null;

    const err = checkEntitlement(userId, visitor > 0 ? 'visitor' : 'smart', { feature, ...opts });
    if (err && process.env.ENTITLEMENT_MODE !== 'warn') return err;

    const event = store.addUsageEvent({
      user_id: userId,
      feature,
      model: opts.model || null,
      input_tokens: opts.inputTokens || 0,
      output_tokens: opts.outputTokens || 0,
      image_count: opts.imageCount || 0,
      estimated_cost_usd: opts.estimatedCostUsd || 0,
      credits_deducted: smart,
      visitor_credits_deducted: visitor,
      billing_period: currentBillingPeriod(),
    });
    return { event, warned: !!err };
  }

  return {
    resolveUserTier,
    getBillingStatus,
    upsertFromStripePayload,
    upsertFromRevenueCatEvent,
    getEntitlementsSummary,
    checkEntitlement,
    recordUsage,
    countActiveGoals,
    getMonthlyUsage,
  };
}

function currentBillingPeriod() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function usageLevel(used, limit) {
  if (limit == null || limit <= 0) return 'normal';
  const pct = used / limit;
  if (pct >= 0.85) return 'near_limit';
  if (pct >= 0.6) return 'high';
  return 'normal';
}

function quotaError(resource, upgradeTier, currentTier) {
  return {
    error: 'quota_exceeded',
    resource,
    upgrade_tier: upgradeTier,
    current_tier: currentTier,
  };
}
