/* ============================================================================
 * api/_lib/stripe.js — Stripe client from env
 *
 * KEY: env STRIPE_SECRET_KEY (see .env.example).
 *   - Building/testing: use a TEST key (sk_test_...) — test-mode Checkout
 *     accepts card 4242 4242 4242 4242 with any future expiry/CVC.
 *   - Production: swap in the LIVE key (sk_live_...) in Vercel env settings.
 * No other code change is needed to go live.
 * ========================================================================== */
import Stripe from "stripe";

let client = null; // lazy singleton

/** True when STRIPE_SECRET_KEY is configured (used for graceful 501s). */
export function stripeReady() {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

/** Lazily construct the Stripe client. Callers check stripeReady() first. */
export function getStripe() {
  if (!stripeReady()) throw new Error("STRIPE_SECRET_KEY is not set");
  if (!client) {
    // No apiVersion pin: the stripe npm package pins its own tested version.
    client = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return client;
}
