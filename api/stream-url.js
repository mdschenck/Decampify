/* ============================================================================
 * GET /api/stream-url?key=stream/...   (BUILD-SPEC §5.3)
 *
 * Called by the player (js/player.js) when MR_CONFIG.mock is false. Exchanges
 * a known streamKey for a presigned short-expiry R2 URL: { url }.
 *
 * SECURITY: `key` must be in the allowlist built from data/releases.json
 * (every release track streamKey + every mix streamKey). Anything else — a
 * downloads/ key, ../ tricks, arbitrary object names — is rejected with 403.
 * This endpoint can therefore never leak purchase-gated files.
 *
 * Graceful degradation: missing env vars → clear JSON 501, never a 500.
 * ========================================================================== */
import { allStreamKeys } from "./_lib/data.js";
import { signGet, r2Ready } from "./_lib/r2.js";

const URL_EXPIRY_SEC = 3600; // 1h — long enough to play a full mix through

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed. Use GET." });
  }

  const key = typeof req.query.key === "string" ? req.query.key : "";
  if (!key) return res.status(400).json({ error: "Missing key parameter." });

  // Allowlist check — only keys declared in data/releases.json are signable.
  if (!allStreamKeys().has(key)) {
    return res.status(403).json({ error: "Unknown stream key." });
  }

  if (!r2Ready()) {
    return res.status(501).json({
      error: "Streaming not configured: R2 environment variables are not set. See README.md.",
    });
  }

  try {
    const url = await signGet(key, URL_EXPIRY_SEC);
    return res.status(200).json({ url });
  } catch (err) {
    // R2 signing failure — log the details server-side, return a generic
    // message (never echo err.message to the client).
    console.error("stream-url: signing stream URL failed:", err);
    return res.status(502).json({
      error: "Could not prepare the stream. Please try again.",
    });
  }
}
