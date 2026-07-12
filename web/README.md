This is a [Next.js](https://nextjs.org) project bootstrapped with `[create-next-app](https://nextjs.org/docs/app/api-reference/cli/create-next-app)`.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses `[next/font](https://nextjs.org/docs/app/building-your-application/optimizing/fonts)` to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

---

## Stripe Integration

The `/pricing` page is wired to Stripe Checkout for subscription sign-up and to
the Stripe Customer Portal for self-service management.

### Architecture

```
Browser ──► /api/stripe/checkout   (POST)  → creates Checkout Session
        ──► /api/stripe/portal     (POST)  → creates Billing Portal Session
        ──► /api/stripe/session    (GET)   → verifies a completed session

Stripe  ──► /api/stripe/webhook    (POST)  → receives subscription lifecycle events
```

### Pro / Ultra: one active paid tier, no mid-subscription upgrades

There is **no** `subscription.update` / proration path. To switch plans (including
Pro → Ultra), users **cancel** in the [Customer Portal](https://dashboard.stripe.com/settings/billing/portal),
wait until the current period ends, then subscribe again.

When the request includes the user’s **email** (logged-in users), `POST /api/stripe/checkout`:

1. Looks up the Stripe Customer by email.
2. If there are **multiple** active/trialing subscriptions, keeps the **highest**
   tier (Ultra over Pro) and **cancels** the others.
3. If there is **one** active subscription and the chosen Price **differs** from
   the current line item (any change: tier, interval, etc.), the API returns
   **`403`** with code **`SUBSCRIPTION_CHANGE_REQUIRES_CANCEL`** — no Checkout URL.
4. If there is **no** active subscription, creates a normal **Checkout** session
   (reusing the same Customer when one exists).

If the user already has the **exact** Price selected, the API returns `409` with
code `ALREADY_SUBSCRIBED`. Anonymous checkout (no email) still uses Checkout only
and cannot detect an existing subscription by account.

Shared helpers live in `lib/stripe.ts`:

- `getStripe()` — cached Node Stripe client
- `resolvePriceId(tier, interval)` — maps `(pro|ultra) × (monthly|yearly)` to
a Price ID via env vars
- `parseTierAndIntervalFromPriceId(priceId)` — reverse lookup when deduplicating subs
- `tierRank(tier)` — Ultra over Pro when deduplicating subscriptions
- `resolveSiteUrl(origin)` — builds absolute URLs for success / cancel / return

### Sandbox (test mode) Price IDs

Authoritative list: `web/.env.example` (sync with
[Dashboard → Test mode](https://dashboard.stripe.com/test/products)).

| Tier  | Interval | USD     | SGD      | Stripe Price ID (test)          |
| ----- | -------- | ------- | -------- | -------------------------------- |
| Pro   | Monthly  | $9.90   | S$12.00  | `price_1TNTmQFCej72GJUNwAs1JdUg` |
| Pro   | Yearly   | $99.00  | S$120.00 | `price_1TNTmQFCej72GJUN9aeHhElA` |
| Ultra | Monthly  | $29.90  | — | `STRIPE_PRICE_ULTRA_MONTHLY` |
| Ultra | Yearly   | $299.00 | — | `STRIPE_PRICE_ULTRA_YEARLY` |

> USD is the default display currency. SGD is served automatically via Stripe's
> multi-currency pricing — no code or Price ID changes needed. **Live mode** uses
> different Price IDs; create matching products under **Live** and update env vars.

### Environment variables

Copy `.env.example` → `.env.local` and fill in the values. For **sandbox / test mode**
(Dashboard top-left: **Test data**), use keys and Price IDs from
[test mode](https://dashboard.stripe.com/test/dashboard) — they start with `sk_test_` /
`pk_test_`. Production uses `sk_live_` / `pk_live_` and separate Price IDs.

```bash
STRIPE_SECRET_KEY=sk_test_...          # sandbox; use sk_live_ in production
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...        # distinct secret per environment

# Optional: set true only after Stripe Tax is configured in Dashboard → Tax
# STRIPE_TAX_ENABLED=true

# Price IDs (values above)
STRIPE_PRICE_MONTHLY=price_...
STRIPE_PRICE_YEARLY=price_...
STRIPE_PRICE_ULTRA_MONTHLY=price_...
STRIPE_PRICE_ULTRA_YEARLY=price_...

NEXT_PUBLIC_SITE_URL=https://gedo.ai   # production recommended

# Optional: forward webhook events to your own backend for persistence
STRIPE_WEBHOOK_FORWARD_URL=https://api.gedo.ai/billing/stripe-events
STRIPE_WEBHOOK_FORWARD_TOKEN=your-shared-secret
```

### Local development with Stripe CLI

1. Install [Stripe CLI](https://docs.stripe.com/stripe-cli).
2. Sign in: `stripe login`.
3. Forward webhooks to your dev server:
  ```bash
   stripe listen --forward-to localhost:3000/api/stripe/webhook
  ```
   The CLI prints a `whsec_…` signing secret — copy it into
   `STRIPE_WEBHOOK_SECRET` in `.env.local` (this secret is different from the
   production webhook secret).
4. In another terminal, start the app:
  ```bash
   npm run dev
  ```
5. Trigger a test subscription from `/pricing`. Use the test card
  `4242 4242 4242 4242`, any future expiry, any CVC, any ZIP.
6. Trigger lifecycle events manually:
  ```bash
   stripe trigger checkout.session.completed
   stripe trigger customer.subscription.updated
   stripe trigger customer.subscription.deleted
   stripe trigger invoice.paid
   stripe trigger invoice.payment_failed
  ```

### Production webhook setup

1. In the [Stripe Dashboard → Developers → Webhooks](https://dashboard.stripe.com/webhooks),
  add an endpoint: `https://<your-domain>/api/stripe/webhook`.
2. Subscribe to these events (minimum set required by the handler):
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.paid`
  - `invoice.payment_failed`
3. Copy the endpoint's **Signing secret** into `STRIPE_WEBHOOK_SECRET`.

### Subscription persistence (TODO)

`app/api/stripe/webhook/route.ts::forwardToBackend` normalizes each event into
`SubscriptionPayload` and POSTs it to `STRIPE_WEBHOOK_FORWARD_URL` when that env
var is set. When it's unset, the webhook only logs — keeping the route
functional while the backend side is still being built.

The payload shape sent to your backend:

```ts
{
  stripeEventId: string;
  stripeEventType: string;
  customerId: string | null;
  customerEmail: string | null;
  subscriptionId: string | null;
  status: 'active' | 'trialing' | 'past_due' | 'canceled' | ...;
  tier: 'pro' | 'ultra' | null;
  plan: 'monthly' | 'yearly' | null;
  userId: string | null;          // from client_reference_id / metadata
  currentPeriodEnd: number | null; // unix seconds
  priceId: string | null;
  cancelAtPeriodEnd: boolean | null;
}
```

Wire this into your users table / subscriptions table on the backend side to
unlock gated features in `/app`.

### Deployment checklists

**Vercel**

1. Push to the connected repo.
2. Set all env vars from `.env.example` in Project Settings → Environment
  Variables (Production + Preview, as needed).
3. Add the webhook endpoint pointing to `https://<vercel-domain>/api/stripe/webhook`.

**Docker** (see `Dockerfile` in this folder)

```bash
docker build -t gedo-web .
docker run --rm -p 3000:3000 \
  --env-file .env.local \
  gedo-web
```

Make sure the public ingress forwards `/api/stripe/webhook` with the raw body
intact (no body rewriting / JSON mangling).