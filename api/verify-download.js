/* ============================================================================
 * GET /api/verify-download?session_id=cs_...   (paid — Stripe Checkout)
 * GET /api/verify-download?token=...           (free — HMAC token)
 *
 * Verifies proof of purchase (Stripe session payment_status === "paid") or a
 * valid unexpired free-download token, then returns presigned R2 URLs
 * (~10 min expiry) for the chosen format:
 *
 *   { ok:true, release:{id,title}, format,
 *     files:[{label,url}, ...],            // one per track
 *     bundleUrl }                          // whole-release zip (null if none)
 *
 * URLs are NEVER returned without valid payment / a valid token (§5.2).
 * Graceful degradation: missing env vars → clear JSON 501, never a 500.
 * ========================================================================== */
import { getRelease } from "./_lib/data.js";
import { getStripe, stripeReady } from "./_lib/stripe.js";
import { verifyToken, tokenReady } from "./_lib/token.js";
import { signGet, r2Ready } from "./_lib/r2.js";

const URL_EXPIRY_SEC = 600; // presigned URL lifetime (~10 minutes)

/** Sign every track URL + bundle for one release/format. */
async function buildFileResponse(release, format) {
  const files = [];
  for (const track of release.tracks || []) {
    const key = track.downloadKeys && track.downloadKeys[format];
    if (!key) continue; // release without this format declared — skip cleanly
    files.push({
      label: track.n + ". " + track.title + " (" + format.toUpperCase() + ")",
      url: await signGet(key, URL_EXPIRY_SEC),
    });
  }
  const bundleKey = release.downloadBundle && release.downloadBundle[format];
  const bundleUrl = bundleKey ? await signGet(bundleKey, URL_EXPIRY_SEC) : null;
  return {
    ok: true,
    release: { id: release.id, title: release.title },
    format,
    files,
    bundleUrl,
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed. Use GET." });
  }

  const sessionId = typeof req.query.session_id === "string" ? req.query.session_id : "";
  const token = typeof req.query.token === "string" ? req.query.token : "";
  if (!sessionId && !token) {
    return res.status(400).json({ error: "Provide session_id (paid) or token (free)." });
  }

  // Signed URLs require R2 no matter which path we take.
  if (!r2Ready()) {
    return res.status(501).json({
      error: "Store not configured: R2 environment variables are not set. See README.md.",
    });
  }

  let releaseId, format;

  if (token) {
    // ---- FREE path: verify HMAC token + expiry --------------------------
    if (!tokenReady()) {
      return res.status(501).json({
        error: "Store not configured: MR_TOKEN_SECRET is not set. See README.md.",
      });
    }
    const payload = verifyToken(token);
    if (!payload || payload.t !== "dl") {
      return res.status(403).json({ error: "Invalid or expired download token." });
    }
    releaseId = payload.releaseId;
    format = payload.format;
  } else {
    // ---- PAID path: verify the Stripe session is actually paid ----------
    if (!stripeReady()) {
      return res.status(501).json({
        error: "Store not configured: STRIPE_SECRET_KEY is not set. See README.md.",
      });
    }
    let session;
    try {
      session = await getStripe().checkout.sessions.retrieve(sessionId);
    } catch {
      return res.status(403).json({ error: "Unknown checkout session." });
    }
    if (!session || session.payment_status !== "paid") {
      return res.status(403).json({ error: "Payment not completed for this session." });
    }
    releaseId = session.metadata && session.metadata.releaseId;
    format = session.metadata && session.metadata.format;
  }

  // ---- Resolve the purchase against the catalog and sign URLs -----------
  const release = getRelease(releaseId);
  if (!release) return res.status(400).json({ error: "Release not found for this purchase." });
  if (format !== "wav" && format !== "mp3") {
    return res.status(400).json({ error: "Unknown download format for this purchase." });
  }

  try {
    const payloadOut = await buildFileResponse(release, format);
    return res.status(200).json(payloadOut);
  } catch (err) {
    // R2 signing failure — log the details server-side, return a generic
    // message (never echo err.message to the client).
    console.error("verify-download: signing download URLs failed:", err);
    return res.status(502).json({
      error: "Could not prepare your download. Please try again.",
    });
  }
}
