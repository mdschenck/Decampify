#!/usr/bin/env node
/*
 * check-staging.mjs — compare your staging folder against the catalog.
 *
 * The single most common reason a track will not play on a live Decampify site
 * is a filename that does not match the key in data/releases.json. R2 keys are
 * case-sensitive, and a signed URL for a key that does not exist still returns
 * a valid-looking URL — the browser just gets a 404 and the player says
 * "track unavailable", with nothing in the API logs to explain it.
 *
 * This catches that BEFORE you upload, by answering three questions:
 *   - which catalog keys have no file staged yet          (MISSING)
 *   - which staged files match no catalog key             (ORPHAN — usually a typo)
 *   - do the catalog keys follow the naming convention    (CONVENTION)
 *
 * For every orphan it looks for the closest missing key and suggests the rename.
 *
 * Run:  npm run manifest:check
 * Read-only — it never renames, moves, or deletes anything.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, relative, extname, basename, sep } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// resolve(), not join() — R2_STAGING_DIR may be an absolute path.
const STAGING = resolve(root, process.env.R2_STAGING_DIR || "_uploads");

/* ---------- catalog ------------------------------------------------------ */

// Strip a UTF-8 BOM if present (some Windows editors add one; JSON.parse rejects it).
const data = JSON.parse(
  readFileSync(join(root, "data", "releases.json"), "utf8").replace(/^﻿/, "")
);

function catalogKeys() {
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
  for (const m of data.mixes || []) if (m.streamKey) keys.push(m.streamKey);
  return keys;
}

/* ---------- naming convention -------------------------------------------- */

/* Default convention (see README "Audio file naming"):
 *   stream/<Album-Dir>/<Artist_Name>-<Song_Title>.mp3
 *   downloads/<Album-Dir>/<Artist_Name>-<Song_Title>.wav|.mp3
 *   downloads/<Album-Dir>/<Album-Dir>-WAV.zip | -MP3.zip
 *   stream/mixes/<lowercase-slug>.mp3        (mixes are exempt by design)
 *
 * These are warnings, not errors — a project that deliberately uses another
 * convention is fine, as long as files and catalog agree. */
const ALLOWED = /^[A-Za-z0-9_&()-]+$/;

function conventionIssues(key) {
  const issues = [];
  const parts = key.split("/");
  const file = parts[parts.length - 1];
  const stem = basename(file, extname(file));

  if (key.startsWith("stream/mixes/")) return issues; // exempt by design

  if (/\s/.test(file)) issues.push("contains a space");
  if (/^\d{1,2}[-_]/.test(stem)) {
    issues.push("uses the old NN-track-slug format (expected Artist_Name-Song_Title)");
  } else if (!stem.includes("-")) {
    issues.push("no '-' separating artist from title (expected Artist_Name-Song_Title)");
  }
  if (!ALLOWED.test(stem)) {
    const bad = [...new Set(stem.split("").filter((c) => !ALLOWED.test(c)))].join(" ");
    issues.push(`unsupported character(s): ${bad}`);
  }
  return issues;
}

/* ---------- staging scan -------------------------------------------------- */

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

/* ---------- fuzzy pairing ------------------------------------------------- */

/** Collapse to lowercase alphanumerics so "01-b-side" and "Artist-B_Side" compare. */
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function levenshtein(a, b) {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Best missing key for an orphan file: same extension, prefer the same folder. */
function suggestFor(orphanKey, missing) {
  const oExt = extname(orphanKey).toLowerCase();
  const oDir = dirname(orphanKey);
  const oStem = norm(basename(orphanKey, extname(orphanKey)));

  let best = null;
  let bestScore = Infinity;
  for (const key of missing) {
    if (extname(key).toLowerCase() !== oExt) continue;
    const stem = norm(basename(key, extname(key)));
    const dist = levenshtein(oStem, stem);
    const longer = Math.max(oStem.length, stem.length) || 1;
    // Same-folder candidates get a small edge; ties then break on raw distance.
    const score = dist / longer + (dirname(key) === oDir ? 0 : 0.15);
    if (score < bestScore) { bestScore = score; best = key; }
  }
  // Only suggest when it is a genuinely close match, not the least-bad of a bad lot.
  return bestScore <= 0.45 ? best : null;
}

/* ---------- run ----------------------------------------------------------- */

const keys = catalogKeys();

if (!keys.length) {
  console.error("data/releases.json lists no audio files. Nothing to check.");
  process.exit(1);
}

console.log(`\nCatalog:  data/releases.json — ${keys.length} files expected`);
console.log(`Staging:  ${STAGING}\n`);

// Convention pass runs even with no staging folder — it only reads the catalog.
const flagged = keys
  .map((k) => ({ key: k, issues: conventionIssues(k) }))
  .filter((r) => r.issues.length);

let missing = [];
let orphans = [];

if (!existsSync(STAGING)) {
  console.log(`  Staging folder not found — skipping the file comparison.`);
  console.log(`  Create ${relative(root, STAGING)}/ and mirror the key paths inside,`);
  console.log(`  or point R2_STAGING_DIR at wherever your files live.\n`);
} else {
  const staged = walk(STAGING).map((f) => relative(STAGING, f).split(sep).join("/"));
  const stagedSet = new Set(staged);
  const keySet = new Set(keys);

  const matched = keys.filter((k) => stagedSet.has(k));
  missing = keys.filter((k) => !stagedSet.has(k));
  orphans = staged.filter((f) => !keySet.has(f));

  console.log(`  OK        ${String(matched.length).padStart(3)} file(s) match the catalog`);

  if (missing.length) {
    console.log(`  MISSING   ${String(missing.length).padStart(3)} catalog key(s) have no file staged`);
    for (const k of missing) console.log(`              ${k}`);
  }

  if (orphans.length) {
    console.log(`  ORPHAN    ${String(orphans.length).padStart(3)} staged file(s) match no catalog key`);
    for (const f of orphans) {
      console.log(`              ${f}`);
      const hit = suggestFor(f, missing);
      if (hit) console.log(`                -> likely rename to: ${basename(hit)}`);
    }
  }

  if (!missing.length && !orphans.length) {
    console.log(`\n  Staging matches the catalog exactly — ready to upload.`);
  }
}

if (flagged.length) {
  console.log(`\n  CONVENTION  ${flagged.length} catalog key(s) differ from the default naming convention:`);
  for (const { key, issues } of flagged.slice(0, 20)) {
    console.log(`              ${key}`);
    console.log(`                ${issues.join("; ")}`);
  }
  if (flagged.length > 20) console.log(`              ...and ${flagged.length - 20} more`);
  console.log(`\n  Expected  Artist_Name-Song_Title.ext  (see README "Audio file naming").`);
  console.log(`  This is only a warning — another convention is fine, as long as your`);
  console.log(`  files and data/releases.json agree exactly.`);
}

console.log("");

/* Non-zero when files and catalog disagree, so the check can gate an upload.
 * Convention warnings alone do not fail the run — an intentional alternative
 * convention is legitimate; a file the site cannot find is not. */
process.exit(missing.length || orphans.length ? 1 : 0);
