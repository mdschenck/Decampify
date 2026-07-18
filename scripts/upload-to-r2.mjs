#!/usr/bin/env node
/* ============================================================================
 * upload-to-r2.mjs — bulk-upload your staged audio to the R2 bucket.
 *
 * Why this exists: the Cloudflare dashboard uploader caps at 300 MB per file,
 * and whole-release WAV bundles are routinely larger than that. The S3 API has
 * no such cap — @aws-sdk/lib-storage switches to multipart automatically.
 *
 * Every object key comes from data/releases.json, so what gets uploaded can
 * never drift from what the site asks for. R2 keys are case-sensitive, so
 * "my-ep" and "My-EP" are two different objects — this removes that whole
 * class of "why won't it play" bug.
 *
 * Staging folder: put your files in _uploads/ mirroring the exact key paths,
 * e.g.  _uploads/stream/My-EP/Artist_Name-Track_One.mp3
 * Override with R2_STAGING_DIR if you keep them elsewhere.
 *
 * Run:  npm run upload:check    # dry run — lists what is missing, writes nothing
 *       npm run upload         # actually upload
 *
 * Safe to re-run: objects already in R2 at a matching byte size are skipped, so
 * an interrupted run resumes where it stopped. Pass --force to re-upload all.
 * ========================================================================== */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const STAGING = path.resolve(ROOT, process.env.R2_STAGING_DIR || "_uploads");

const GO = process.argv.includes("--go");
const FORCE = process.argv.includes("--force");

/* Parallelism. The defaults move ~12 simultaneous TLS streams (3 files x 4
 * parts). On a flaky connection that can corrupt a stream outright, surfacing
 * as "ssl3_read_bytes: bad record mac" rather than a clean retryable error.
 * Drop both to 1 to upload gently:  UPLOAD_CONCURRENCY=1 UPLOAD_QUEUE_SIZE=1 */
const CONCURRENCY = Number(process.env.UPLOAD_CONCURRENCY) || 3;
const QUEUE_SIZE = Number(process.env.UPLOAD_QUEUE_SIZE) || 4;

/* The site's own R2 token is deliberately read-only — it only ever signs GET
 * requests (see SETUP.md). Uploading needs write, so this script prefers a
 * separate R2_UPLOAD_* credential when one is provided. Keep the write token
 * OUT of .env and Vercel; put it in .env.upload, which is git-ignored.
 * Delete that token in the Cloudflare dashboard once the upload is done. */
const ACCESS_KEY = process.env.R2_UPLOAD_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY_ID;
const SECRET_KEY = process.env.R2_UPLOAD_SECRET_ACCESS_KEY || process.env.R2_SECRET_ACCESS_KEY;
const USING_UPLOAD_TOKEN = Boolean(process.env.R2_UPLOAD_ACCESS_KEY_ID);

if (!ACCESS_KEY || !SECRET_KEY || !process.env.R2_BUCKET || !process.env.R2_ENDPOINT) {
  console.error("Missing R2 credentials / bucket / endpoint.");
  console.error("Run with:  npm run upload:check");
  process.exit(1);
}

if (!fs.existsSync(STAGING)) {
  console.error(`Staging folder not found: ${STAGING}`);
  console.error("Create it and mirror your R2 key paths inside, or set R2_STAGING_DIR.");
  process.exit(1);
}

/* maxAttempts covers the *part* level: lib-storage buffers each 16 MB part
 * before sending, so a part killed mid-flight is retried on its own rather
 * than failing the whole object. That is what makes ~1 GB uploads survivable
 * on a link that corrupts a record every few hundred MB — the job-level retry
 * below is the outer net, this is the cheap inner one. */
const makeClient = () =>
  new S3Client({
    region: "auto",
    endpoint: process.env.R2_ENDPOINT,
    credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
    maxAttempts: Number(process.env.UPLOAD_PART_ATTEMPTS) || 8,
  });

/* Long-lived client, used only for the cheap HEAD probes. Uploads deliberately
 * build their own (see putOnce) — a client whose pooled socket has gone bad
 * stays bad, so reusing this one for retries would just replay the failure. */
const client = makeClient();
const BUCKET = process.env.R2_BUCKET;

const ATTEMPTS = Number(process.env.UPLOAD_ATTEMPTS) || 4;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CONTENT_TYPE = { ".wav": "audio/wav", ".mp3": "audio/mpeg", ".zip": "application/zip" };
const mb = (b) => (b / 1024 / 1024).toFixed(0).padStart(5);

/** Every key the site expects, straight from the catalog. */
function collectKeys() {
  // Strip a UTF-8 BOM if present (some Windows editors add one; JSON.parse rejects it).
  const data = JSON.parse(
    fs.readFileSync(path.join(ROOT, "data", "releases.json"), "utf8").replace(/^﻿/, "")
  );
  const keys = [];
  for (const rel of data.releases || []) {
    for (const t of rel.tracks || []) {
      if (t.streamKey) keys.push(t.streamKey);
      if (t.downloadKeys?.wav) keys.push(t.downloadKeys.wav);
      if (t.downloadKeys?.mp3) keys.push(t.downloadKeys.mp3);
    }
    if (rel.downloadBundle?.wav) keys.push(rel.downloadBundle.wav);
    if (rel.downloadBundle?.mp3) keys.push(rel.downloadBundle.mp3);
  }
  for (const m of data.mixes || []) {
    if (m.streamKey) keys.push(m.streamKey);
  }
  return keys;
}

/** Present in R2 at the same byte size? Then there's nothing to do.
 *
 * Only a genuine 404 means "not uploaded yet". Any other failure — expired or
 * revoked token, wrong bucket, network — means we simply cannot tell, and must
 * not guess "missing": that would report a full bucket as empty and invite a
 * pointless multi-GB re-upload. Bail out loudly instead. */
async function alreadyUploaded(key, size) {
  if (FORCE) return false;
  try {
    const head = await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return head.ContentLength === size;
  } catch (err) {
    const status = err?.$metadata?.httpStatusCode;
    if (status === 404 || err?.name === "NotFound") return false; // genuinely absent
    console.error(`\nCannot read the bucket — aborting rather than guessing what is missing.`);
    console.error(`  HEAD ${key}`);
    console.error(`  ${err?.name || "Error"}: ${err?.message || err}`);
    if (status === 401 || status === 403) {
      console.error(`\n  That is an auth failure. Your R2 upload token is probably expired, revoked,`);
      console.error(`  or missing the Object Read permission. See SETUP.md for how to mint a new one.`);
    }
    process.exit(1);
  }
}

/* One attempt, on a throwaway client and a throwaway read stream. Both matter:
 * a half-consumed stream cannot be replayed, and a poisoned socket pool cannot
 * be recovered — so a retry has to start from scratch on both counts. */
async function putOnce(key, localPath) {
  const attemptClient = makeClient();
  try {
    const upload = new Upload({
      client: attemptClient,
      params: {
        Bucket: BUCKET,
        Key: key,
        Body: fs.createReadStream(localPath),
        ContentType: CONTENT_TYPE[path.extname(key).toLowerCase()] || "application/octet-stream",
      },
      queueSize: QUEUE_SIZE,        // parallel parts within one file
      partSize: 16 * 1024 * 1024,   // 16 MB parts; well under R2 limits
      leavePartsOnError: false,     // clean up failed multipart uploads
    });
    await upload.done();
  } finally {
    attemptClient.destroy();
  }
}

/** Retry with exponential backoff. Throws the last error if every try fails. */
async function putObject(key, localPath, onRetry) {
  let lastErr;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      await putOnce(key, localPath);
      return attempt;
    } catch (err) {
      lastErr = err;
      if (attempt < ATTEMPTS) {
        const backoff = 2000 * 2 ** (attempt - 1); // 2s, 4s, 8s, ...
        onRetry?.(attempt, err, backoff);
        await sleep(backoff);
      }
    }
  }
  throw lastErr;
}

const keys = collectKeys();
const jobs = [];
const missingLocal = [];

for (const key of keys) {
  const local = path.join(STAGING, key);
  if (!fs.existsSync(local)) { missingLocal.push(key); continue; }
  jobs.push({ key, local, size: fs.statSync(local).size });
}

if (missingLocal.length) {
  console.error(`\n${missingLocal.length} file(s) referenced by releases.json are not in staging:`);
  missingLocal.forEach((k) => console.error("  " + k));
  console.error(`\nExpected them under ${STAGING}, mirroring the key path exactly.`);
  console.error("Refusing to run — the catalog and the staging folder disagree.\n");
  process.exit(1);
}

if (!jobs.length) {
  console.error("data/releases.json lists no files to upload. Nothing to do.");
  process.exit(1);
}

const totalBytes = jobs.reduce((s, j) => s + j.size, 0);
console.log(`Bucket:   ${BUCKET}`);
console.log(`Endpoint: ${process.env.R2_ENDPOINT}`);
console.log(`Staging:  ${STAGING}`);
console.log(`Token:    ${USING_UPLOAD_TOKEN ? "R2_UPLOAD_* (write)" : "R2_* (the site's read-only token)"}`);
if (GO && !USING_UPLOAD_TOKEN) {
  console.log("\n  Note: no R2_UPLOAD_* credential found, so this will use the site's token.");
  console.log("  If that token is Object Read only, every PUT will fail with AccessDenied.");
}
console.log(`Catalog:  ${jobs.length} objects, ${(totalBytes / 1073741824).toFixed(2)} GB total`);
console.log(`Mode:     ${GO ? (FORCE ? "UPLOAD (forced re-upload)" : "UPLOAD") : "DRY RUN — nothing will be written"}\n`);

let done = 0, skipped = 0, uploaded = 0, failed = 0, sentBytes = 0;

async function handle(job) {
  const n = String(++done).padStart(3);
  const oversize = job.size > 300 * 1024 * 1024 ? " [>300MB: multipart]" : "";
  if (await alreadyUploaded(job.key, job.size)) {
    skipped++;
    console.log(`${n}/${jobs.length} skip  ${mb(job.size)} MB  ${job.key}`);
    return;
  }
  if (!GO) {
    console.log(`${n}/${jobs.length} TODO  ${mb(job.size)} MB  ${job.key}${oversize}`);
    return;
  }
  try {
    const tries = await putObject(job.key, job.local, (attempt, err, backoff) => {
      console.warn(
        `${n}/${jobs.length} retry ${attempt}/${ATTEMPTS - 1} in ${backoff / 1000}s  ${job.key}\n      ${err.message}`
      );
    });
    uploaded++; sentBytes += job.size;
    const note = tries > 1 ? ` (after ${tries} attempts)` : "";
    console.log(`${n}/${jobs.length} sent  ${mb(job.size)} MB  ${job.key}${oversize}${note}`);
  } catch (err) {
    failed++;
    console.error(
      `${n}/${jobs.length} FAIL  ${mb(job.size)} MB  ${job.key}  (${ATTEMPTS} attempts)\n      ${err.message}`
    );
  }
}

// simple worker pool
const queue = [...jobs];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) await handle(queue.shift());
  })
);

console.log(`\n${"-".repeat(60)}`);
if (GO) {
  console.log(`Uploaded: ${uploaded}   Skipped (already present): ${skipped}   Failed: ${failed}`);
  console.log(`Transferred: ${(sentBytes / 1073741824).toFixed(2)} GB`);
  if (failed) {
    console.log("\nRe-run to retry the failures — completed objects are skipped.");
    console.log("On a flaky link try:  UPLOAD_CONCURRENCY=1 UPLOAD_QUEUE_SIZE=1 UPLOAD_ATTEMPTS=8 npm run upload");
    process.exit(1);
  } else {
    console.log("\nAll catalog objects are present in R2.");
  }
} else {
  const todo = jobs.length - skipped;
  console.log(`Already in R2: ${skipped}   Still to upload: ${todo}`);
  console.log(`\nDry run only. Run 'npm run upload' to upload.`);
}
