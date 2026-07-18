/* ============================================================================
 * POST /api/create-checkout  (BUILD-SPEC §5.1)
 *
 * body: { releaseId, amount, format }   format = "wav" | "mp3", amount in USD
 *
 * Validates the release against data/releases.json and enforces its price
 * model server-side (the client also enforces it, but the server is the
 * authority — a hand-crafted request cannot underpay):
 *   nyp-floor / fixed : amount >= priceFloor, else 400
 *   nyp               : amount >= 0; amount === 0 → free path
 *   free              : always free path
 *
 * Paid → Stripe Checkout Session (mode: payment), responds { url }.
 *        Success returns the buyer to the home page with
 *        ?purchase=success&session_id=... where js/store.js auto-opens the
 *        download panel (documented choice: success section on index, no
 *        separate download.html page).
 * Free → responds { free:true, token } — a short-lived HMAC token that
 *        /api/verify-download redeems for signed download URLs. No Stripe.
 *
 * Graceful degradation: missing env vars → clear JSON 501, never a 500.
 * ========================================================================== */
import { getRelease } from "./_lib/data.js";
import { getStripe, stripeReady } from "./_lib/stripe.js";
import { signToken, tokenReady } from "./_lib/token.js";

const VALID_FORMATS = ["wav", "mp3"];
const MAX_AMOUNT_USD = 999; // sanity cap on name-your-price generosity
const FREE_TOKEN_TTL_SEC = 15 * 60; // free-download token lifetime

/** Read the JSON body whether or not Vercel pre-parsed it. */
async function readJsonBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === "object") return req.body;
    if (typeof req.body === "string") {
      try { return JSON.parse(req.body); } catch { return null; }
    }
  }
  // Fallback: raw stream (e.g. missing content-type header)
  let raw = "";
  for await (const chunk of req) raw += chunk;
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  const body = await readJsonBody(req);
  if (!body) return res.status(400).json({ error: "Invalid JSON body." });

  const { releaseId, format } = body;
  const amount = Number(body.amount);

  // --- Validate inputs against the catalog -------------------------------
  const release = getRelease(releaseId);
  if (!release) return res.status(400).json({ error: "Unknown releaseId." });
  if (!VALID_FORMATS.includes(format)) {
    return res.status(400).json({ error: 'format must be "wav" or "mp3".' });
  }
  if (!Number.isFinite(amount) || amount < 0 || amount > MAX_AMOUNT_USD) {
    return res.status(400).json({ error: "amount must be a number between 0 and " + MAX_AMOUNT_USD + "." });
  }

  // --- Enforce the release's price model ---------------------------------
  const model = release.priceModel; // "nyp-floor" | "nyp" | "fixed" | "free"
  const floor = Number(release.priceFloor) || 0;
  let isFree = false;
  if (model === "free") {
    isFree = true;
  } else if (model === "nyp") {
    isFree = amount === 0;
  } else if (model === "nyp-floor" || model === "fixed") {
    if (amount < floor) {
      return res.status(400).json({
        error: "Minimum price for this release is $" + floor.toFixed(2) + ".",
      });
    }
  } else {
    return res.status(400).json({ error: "Release has an unknown price model." });
  }

  // --- FREE path: HMAC token, no Stripe ----------------------------------
  if (isFree) {
    if (!tokenReady()) {
      return res.status(501).json({
        error: "Store not configured: MR_TOKEN_SECRET is not set. See README.md.",
      });
    }
    const token = signToken(
      { t: "dl", releaseId: release.id, format },
      FREE_TOKEN_TTL_SEC
    );
    return res.status(200).json({ free: true, token });
  }

  // --- PAID path: Stripe Checkout Session --------------------------------
  if (!stripeReady()) {
    return res.status(501).json({
      error: "Store not configured: STRIPE_SECRET_KEY is not set. See README.md.",
    });
  }
  const siteUrl = process.env.SITE_URL;
  if (!siteUrl) {
    return res.status(501).json({
      error: "Store not configured: SITE_URL is not set. See README.md.",
    });
  }

  try {
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: (release.currency || "USD").toLowerCase(),
            unit_amount: Math.round(amount * 100), // dollars → cents
            product_data: {
              name: release.title + " — " + format.toUpperCase() + " download",
              description: "Digital release download",
            },
          },
        },
      ],
      // What was bought — verify-download reads these to pick the right files.
      metadata: { releaseId: release.id, format },
      // {CHECKOUT_SESSION_ID} is substituted by Stripe on redirect.
      success_url: siteUrl + "/?purchase=success&session_id={CHECKOUT_SESSION_ID}",
      cancel_url: siteUrl + "/",
    });
    return res.status(200).json({ url: session.url });
  } catch (err) {
    // Stripe/API failure — surface a clean JSON error, not a 500 stack dump.
    return res.status(502).json({
      error: "Could not create checkout session: " + (err && err.message ? err.message : "unknown error"),
    });
  }
}
