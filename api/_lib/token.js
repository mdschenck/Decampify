/* ============================================================================
 * api/_lib/token.js — HMAC-signed, short-lived tokens (BUILD-SPEC §5)
 *
 * Used for the FREE download path (nyp at $0 / free releases): create-checkout
 * issues a token instead of a Stripe session, verify-download redeems it.
 * Also reusable for streaming tokens if that is ever needed.
 *
 * SECRET: env MR_TOKEN_SECRET (see .env.example). Set it to a long random
 * string in Vercel Project Settings → Environment Variables. Rotating the
 * secret instantly invalidates all outstanding tokens (they only live minutes,
 * so rotation is harmless).
 *
 * Token format: base64url(payloadJSON) + "." + base64url(hmacSha256)
 * Payload always includes `exp` (unix seconds).
 * ========================================================================== */
import { createHmac, timingSafeEqual } from "node:crypto";

/** True when the signing secret is configured (used for graceful 501s). */
export function tokenReady() {
  return Boolean(process.env.MR_TOKEN_SECRET);
}

function b64url(buf) {
  return Buffer.from(buf).toString("base64url");
}

function hmac(data) {
  return createHmac("sha256", process.env.MR_TOKEN_SECRET).update(data).digest();
}

/**
 * Sign a payload object into a token string. ttlSec controls expiry.
 * Throws if MR_TOKEN_SECRET is not set — callers check tokenReady() first.
 */
export function signToken(payload, ttlSec = 900) {
  if (!tokenReady()) throw new Error("MR_TOKEN_SECRET is not set");
  const body = { ...payload, exp: Math.floor(Date.now() / 1000) + ttlSec };
  const encoded = b64url(JSON.stringify(body));
  return encoded + "." + b64url(hmac(encoded));
}

/**
 * Verify a token string. Returns the payload object on success, or null on
 * any failure (bad format, bad signature, expired). Never throws on bad input.
 */
export function verifyToken(token) {
  if (!tokenReady() || typeof token !== "string") return null;
  const dot = token.indexOf(".");
  if (dot < 1) return null;
  const encoded = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let expected, given;
  try {
    expected = hmac(encoded);
    given = Buffer.from(sig, "base64url");
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!payload || typeof payload.exp !== "number") return null;
  if (payload.exp < Math.floor(Date.now() / 1000)) return null; // expired
  return payload;
}
