# One-Time Pro Billing

**Status:** Implemented runtime, service deployment pending

Outflow Pro is a lifetime account entitlement purchased once through Stripe-hosted Checkout. The Checkout Session always uses `mode=payment`; Outflow does not create a recurring Stripe subscription or collect card data in the application.

## Trust Boundary

- `create-pro-checkout` requires a valid Supabase user session and a strict allowed origin.
- The function retrieves `STRIPE_PRO_PRICE_ID` and refuses inactive, recurring, tiered, or zero-value prices.
- Checkout metadata binds the fixed Outflow product identifier to the authenticated user. A server reservation limits each account to ten new checkout operations per hour, and the operation UUID becomes the Stripe idempotency key.
- The success redirect only opens the account panel and polls the entitlement. It never grants Pro.
- `stripe-webhook` has Supabase JWT verification disabled because Stripe has no Supabase token. The function authenticates Stripe with the raw request body and `Stripe-Signature` before using the service role.
- Fulfillment verifies payment status, user metadata, payment mode, livemode, the configured price, and a quantity of one before calling a server-only database function.

## Entitlement Lifecycle

1. A paid `checkout.session.completed` or `checkout.session.async_payment_succeeded` event creates a minimal purchase mapping and activates `outflow_pro_lifetime` transactionally.
2. Stripe event IDs are retained as non-user event tombstones so retries are idempotent. Raw event payloads, card data, addresses, and customer details are not stored in Outflow tables.
3. A full `charge.refunded` event resolves its PaymentIntent, verifies Outflow metadata, marks the matching purchase refunded, and revokes only the entitlement that still points to that purchase.
4. Provider event timestamps prevent an older delayed success event from reactivating access after a newer refund.
5. A later valid purchase activates Pro again. Signing in and choosing **Restore access** reads the durable entitlement; it does not create a charge.
6. Account deletion removes entitlement, checkout reservations, and every purchase-to-user link. Minimal Stripe session, PaymentIntent, and event identifiers remain de-identified for webhook reconciliation and idempotency; raw payment data is never stored.

## Upgrade Surface

The Account / Pro dialog always shows a service-independent comparison before any purchase action. Free core covers local tracking, forecasts, the billing calendar, one preset device or trial lead time per record, and CSV, backup, and calendar exports. Free users create new records in USD, while every existing currency and advanced reminder value remains visible and editable after an entitlement or account change. Lifetime Pro adds reviewed CSV import, new non-USD records, multiple and custom lead times, cross-device synchronization, household and team access, durable email reminders, and hosted calendar subscriptions.

An unconfigured build says **Paid once** instead of inventing a price and does not render sign-in, checkout, or restore actions. A verified one-time Stripe Price is shown only after sign-in, and only then can the user open hosted Checkout. Cancelled returns preserve the Free entitlement and explicitly state that no product subscription or recurring charge was created.

## Automated Browser Contract

`npm run test:account-service` runs the signed-in billing flow against a stateful configured-service fixture at desktop and narrow mobile widths. It verifies that:

- A server-verified fixed offer displays its exact currency and one-time amount before the user chooses checkout.
- Checkout receives a fresh version-4 operation UUID and hands off to an HTTPS Stripe-hosted URL without writing or activating an entitlement in the browser.
- A `pro=success` return with no server entitlement remains Free through all confirmation attempts, clears the transient URL parameter, and explains that fulfillment is pending.
- **Restore access** adopts an active durable account entitlement without creating a checkout request and recovers it again after reload.
- Free guests receive contextual gates for CSV import, new non-USD records, and a second reminder lead time without changing the serialized local workspace.
- A verified entitlement unlocks the reviewed CSV import, multiple currencies, and bounded custom/multiple lead times without creating another checkout request.
- Entitlement loss keeps existing Pro-shaped records editable but prevents expanding their currency or reminder rules.
- The signed-in offer, checkout, and Pro-only CSV state pass the automated WCAG A/AA ruleset in both viewport profiles.

The PostgreSQL contract independently verifies checkout reservation idempotency and limits, service-only fulfillment, duplicate and out-of-order webhook handling, refund revocation, repurchase, and de-identified post-deletion reconciliation.

## Staging Billing Contract

`npm run test:staging-billing-plane` validates the protected acceptance harness without network access. After the staging project and Stripe test account are configured, manually dispatch **Staging Billing Plane** to verify the deployed contract. The run:

- Creates one synthetic account and requests a real open test-mode Checkout Session through `create-pro-checkout`.
- Retrieves the canonical Stripe session and verifies one-time mode, fixed Price, quantity, redirects, test mode, and authenticated identity metadata.
- Sends correctly signed synthetic purchase and full-refund events to the deployed webhook, then proves duplicate handling, account-based restore, and entitlement revocation.
- Expires the unpaid Checkout Session, cancels its unconfirmed acceptance PaymentIntent, deletes exact synthetic database rows, and removes the test identity.

This contract makes no card charge and cannot prove that Stripe is configured to deliver outbound events. Complete an actual Stripe-hosted test payment, cancellation, delayed-payment case, refund, and endpoint-delivery inspection before promotion.

## Required Secrets

Configure these only as Supabase Edge Function secrets:

```text
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_PRO_PRICE_ID
```

The shared function configuration also requires the Supabase server values, `OUTFLOW_ALLOWED_ORIGINS`, and `OUTFLOW_APP_URL` documented in `supabase/functions/.env.example`. No Stripe value belongs in a `VITE_*` variable.

## Deployment Gate

1. Create an active fixed one-time Stripe Price and set its `price_...` ID as `STRIPE_PRO_PRICE_ID`.
2. Deploy `create-pro-checkout` with normal Supabase JWT verification.
3. Deploy `stripe-webhook` using `supabase/config.toml`, which disables Supabase JWT verification only for that function.
4. Register the webhook endpoint for `checkout.session.completed`, `checkout.session.async_payment_succeeded`, and `charge.refunded`, then save its signing secret.
5. Configure the protected GitHub staging entries in the service runbook and pass **Staging Billing Plane**.
6. In Stripe test mode, verify an actual successful payment, cancelled Checkout, delayed payment success, Stripe-originated endpoint delivery, out-of-order delivery, restore on a second browser, and account deletion.
7. Confirm that test-mode events cannot alter live-mode purchase mappings before enabling the production Price.

## Current Boundary

The schema, functions, browser flow, isolated database tests, and protected signed-event acceptance workflow are implemented. No Stripe or Supabase project is provisioned in the repository, so the default build cannot sell or restore Pro yet.

The service-independent comparison, contextual Free gates, guest behavior, and cancelled-return behavior are enforced at desktop and mobile widths by `npm run test:e2e`. The configured feature unlocks, entitlement-loss data preservation, offer, checkout, pending-success, and restore states are enforced by `npm run test:account-service`. Pure policy invariants are covered by `npm run test:feature-access`.

References: [Stripe Checkout fulfillment](https://docs.stripe.com/checkout/fulfillment), [Stripe webhook signatures](https://docs.stripe.com/webhooks/signature), [Stripe refund events](https://docs.stripe.com/refunds), and [Supabase signed webhook functions](https://supabase.com/docs/guides/functions/examples/stripe-webhooks).
