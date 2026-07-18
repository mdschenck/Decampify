/* ============================================================================
 * api/_lib/data.js — catalog access for the serverless store (BUILD-SPEC §5)
 *
 * Loads data/releases.json (the single source of truth for the catalog) and
 * exposes lookup helpers. Every endpoint validates input against THIS data —
 * nothing is signed or sold that is not declared in releases.json.
 *
 * Adding a release to the store = edit data/releases.json (see README.md).
 * No code changes needed here.
 * ========================================================================== */
import { readFileSync } from "node:fs";
import path from "node:path";

let cache = null; // parsed releases.json, cached for the lifetime of the lambda

/**
 * Load and cache data/releases.json.
 * Tries the module-relative path first (works locally and lets Vercel's file
 * tracer include the file in the deployed function), then process.cwd().
 */
export function loadData() {
  if (cache) return cache;
  const candidates = [
    new URL("../../data/releases.json", import.meta.url), // api/_lib/ -> project root
    path.join(process.cwd(), "data", "releases.json"),    // Vercel runtime cwd
  ];
  let lastErr;
  for (const p of candidates) {
    try {
      // Strip a UTF-8 BOM if present (Windows editors add one; JSON.parse rejects it).
      cache = JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, ""));
      return cache;
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error("Unable to load data/releases.json: " + (lastErr && lastErr.message));
}

/** Look up one release by id. Returns the release object or null. */
export function getRelease(id) {
  if (typeof id !== "string" || !id) return null;
  const data = loadData();
  return data.releases.find((r) => r.id === id) || null;
}

/**
 * Allowlist of every streamable R2 key: all release track streamKeys plus all
 * mix streamKeys. /api/stream-url refuses to sign anything not in this set.
 */
export function allStreamKeys() {
  const data = loadData();
  const keys = new Set();
  for (const rel of data.releases) {
    for (const t of rel.tracks || []) {
      if (t.streamKey) keys.add(t.streamKey);
    }
  }
  for (const mix of data.mixes || []) {
    if (mix.streamKey) keys.add(mix.streamKey);
  }
  return keys;
}
