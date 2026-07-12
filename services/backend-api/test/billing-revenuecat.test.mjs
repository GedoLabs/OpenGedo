/**
 * RevenueCat webhook → entitlement 生命周期契约测试。
 *
 * 锁定 M1 语义(docs/EXTERNAL_INTEGRATIONS_PLAN.md):
 *   - INITIAL_PURCHASE/RENEWAL/PRODUCT_CHANGE → active + tier 生效
 *   - CANCELLATION 只关自动续订,权益保留(tier 不降)
 *   - EXPIRATION 才收回 → free
 *   - tier 优先取 entitlement_ids(跨渠道稳定),product_id 兜底
 *   - provider 按 RC store 字段映射;Stripe 直写路径 provider='stripe'
 *
 * Run: npx vitest run test/billing-revenuecat.test.mjs
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Store } from '../src/lib/store.mjs';
import { createBillingService } from '../src/services/billing.service.mjs';

const store = Store();
const billing = createBillingService(store);

let user;

beforeAll(() => {
  user = store.createUser({ email: 'rc-test@example.com' });
});

afterAll(() => { store.wipeUser(user.id); });

function rcEvent(type, overrides = {}) {
  return {
    id: `evt_${type}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    app_user_id: user.id,
    product_id: 'ai.gedo.pro.monthly',
    entitlement_ids: ['pro'],
    store: 'APP_STORE',
    expiration_at_ms: Date.now() + 30 * 24 * 3600 * 1000,
    ...overrides,
  };
}

describe('upsertFromRevenueCatEvent', () => {
  it('INITIAL_PURCHASE activates the tier with store-mapped provider', () => {
    const row = billing.upsertFromRevenueCatEvent(rcEvent('INITIAL_PURCHASE'));
    expect(row).toMatchObject({ tier: 'pro', status: 'active', provider: 'app_store', interval: 'monthly' });
    expect(billing.resolveUserTier(user.id)).toBe('pro');
    expect(billing.getBillingStatus(user.id).provider).toBe('app_store');
  });

  it('prefers entitlement_ids over product_id for tier (Stripe 汇入后 product 是 price_xxx)', () => {
    const row = billing.upsertFromRevenueCatEvent(rcEvent('RENEWAL', {
      product_id: 'price_1TNBypFCej72GJUNIE5aGRSs',
      entitlement_ids: ['ultra'],
      store: 'STRIPE',
    }));
    expect(row).toMatchObject({ tier: 'ultra', provider: 'stripe' });
  });

  it('PRODUCT_CHANGE moves tier by new_product_id when entitlements absent', () => {
    const row = billing.upsertFromRevenueCatEvent(rcEvent('PRODUCT_CHANGE', {
      entitlement_ids: [],
      new_product_id: 'ai.gedo.ultra.yearly',
    }));
    expect(row).toMatchObject({ tier: 'ultra', interval: 'yearly', status: 'active' });
  });

  it('CANCELLATION keeps the tier and only flips cancel_at_period_end', () => {
    const row = billing.upsertFromRevenueCatEvent(rcEvent('CANCELLATION', { entitlement_ids: ['ultra'] }));
    expect(row).toMatchObject({ tier: 'ultra', status: 'active', cancel_at_period_end: true });
    expect(billing.resolveUserTier(user.id)).toBe('ultra');
  });

  it('BILLING_ISSUE keeps access during grace period', () => {
    const row = billing.upsertFromRevenueCatEvent(rcEvent('BILLING_ISSUE', { entitlement_ids: ['ultra'] }));
    expect(row.status).toBe('active');
    expect(billing.resolveUserTier(user.id)).toBe('ultra');
  });

  it('EXPIRATION revokes to free', () => {
    const row = billing.upsertFromRevenueCatEvent(rcEvent('EXPIRATION'));
    expect(row).toMatchObject({ tier: 'free', status: 'expired' });
    expect(billing.resolveUserTier(user.id)).toBe('free');
  });

  it('ignores TEST events and unknown users without writing', () => {
    expect(billing.upsertFromRevenueCatEvent(rcEvent('TEST'))).toBeNull();
    expect(billing.upsertFromRevenueCatEvent(rcEvent('RENEWAL', { app_user_id: 'nope-user' }))).toBeNull();
  });

  it('Stripe direct path stamps provider=stripe (迁移开关期间共存)', () => {
    const row = billing.upsertFromStripePayload({
      userId: user.id,
      tier: 'pro',
      status: 'active',
      plan: 'monthly',
      customerId: 'cus_x',
      subscriptionId: 'sub_x',
    });
    expect(row).toMatchObject({ tier: 'pro', provider: 'stripe' });
  });
});
