/* ============================================================================
 * api/_lib/r2.js — Cloudflare R2 client (S3-compatible) + URL signer
 *
 * R2 credentials come from env (see .env.example):
 *   R2_ACCOUNT_ID        — Cloudflare account id (only used to build endpoint
 *                          if R2_ENDPOINT is not set explicitly)
 *   R2_ENDPOINT          — https://<accountid>.r2.cloudflarestorage.com
 *   R2_ACCESS_KEY_ID     — R2 API token access key
 *   R2_SECRET_ACCESS_KEY — R2 API token secret
 *   R2_BUCKET            — bucket name (e.g. my-artist-store)
 *
 * All audio lives in ONE private bucket, two prefixes (BUILD-SPEC §2 / §9):
 *   stream/<release-id>/NN-track-slug.mp3      — free streaming copies
 *   downloads/<release-id>/NN-track-slug.wav   — purchased downloads
 *   downloads/<release-id>/NN-track-slug.mp3
 *   downloads/<release-id>/<release-id>-wav.zip — whole-release bundles
 * The exact keys are declared per release in data/releases.json; the store
 * only ever signs keys that appear there.
 * ========================================================================== */
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

let client = null; // lazy singleton — created on first signGet()

/** True when all required R2 env vars are present (used for graceful 501s). */
export function r2Ready() {
  return Boolean(
    (process.env.R2_ENDPOINT || process.env.R2_ACCOUNT_ID) &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET
  );
}

function getClient() {
  if (client) return client;
  const endpoint =
    process.env.R2_ENDPOINT ||
    `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  client = new S3Client({
    region: "auto", // R2 is region-less; "auto" is Cloudflare's documented value
    endpoint,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
  return client;
}

/**
 * Return a presigned GET URL for an object key, valid expiresSec seconds
 * (default 10 minutes — long enough to start a download, short enough that
 * shared links die quickly). Callers check r2Ready() first.
 */
export function signGet(key, expiresSec = 600) {
  if (!r2Ready()) throw new Error("R2 environment variables are not set");
  const cmd = new GetObjectCommand({ Bucket: process.env.R2_BUCKET, Key: key });
  return getSignedUrl(getClient(), cmd, { expiresIn: expiresSec });
}
