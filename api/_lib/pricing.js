/* ============================================================================
 * api/_lib/pricing.js — price-model enforcement (BUILD-SPEC §5.1)
 *
 * Pure, side-effect-free resolution of a release's price model against an
 * offered amount. Extracted from create-checkout so the rule is unit-testable
 * (test/pricing.test.js) and cannot drift from what the endpoint enforces:
 *
 *   free      : always the free path
 *   nyp       : amount >= 0; amount === 0 → free path
 *   nyp-floor : amount >= priceFloor, else error
 *   fixed     : amount === priceFloor exactly, else error
 * ========================================================================== */

/**
 * Resolve pricing for a release + offered amount (USD).
 * Returns { free: true } for the free path, { error: "..." } when the amount
 * violates the price model, or {} when the amount is valid for a paid checkout.
 * Assumes amount is already a validated finite number >= 0 (the endpoint
 * checks range/type before calling).
 */
export function resolvePricing(release, amount) {
  const model = release.priceModel; // "nyp-floor" | "nyp" | "fixed" | "free"
  const floor = Number(release.priceFloor) || 0;
  if (model === "free") return { free: true };
  if (model === "nyp") return amount === 0 ? { free: true } : {};
  if (model === "nyp-floor") {
    if (amount < floor) {
      return { error: "Minimum price for this release is $" + floor.toFixed(2) + "." };
    }
    return {};
  }
  if (model === "fixed") {
    if (amount !== floor) {
      return { error: "This release has a fixed price of $" + floor.toFixed(2) + "." };
    }
    return {};
  }
  return { error: "Release has an unknown price model." };
}
