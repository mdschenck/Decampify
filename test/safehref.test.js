/* test/safehref.test.js — href scheme sanitizer (js/config.js → window.MRUtil) */
import { test } from "node:test";
import assert from "node:assert/strict";

// js/config.js is a browser script that assigns onto `window` — stub it so the
// real file (not a copy of the logic) is what gets tested.
globalThis.window = {};
await import("../js/config.js");
const safeHref = globalThis.window.MRUtil.safeHref;

test("http(s) and mailto URLs pass through unchanged", () => {
  assert.equal(safeHref("https://example.com/page"), "https://example.com/page");
  assert.equal(safeHref("http://example.com"), "http://example.com");
  assert.equal(safeHref("mailto:hello@example.com"), "mailto:hello@example.com");
  assert.equal(safeHref("HTTPS://EXAMPLE.COM"), "HTTPS://EXAMPLE.COM"); // case-insensitive scheme
});

test("dangerous schemes are neutralized to '#'", () => {
  assert.equal(safeHref("javascript:alert(1)"), "#");
  assert.equal(safeHref("data:text/html,<script>alert(1)</script>"), "#");
  assert.equal(safeHref("vbscript:msgbox(1)"), "#");
  assert.equal(safeHref("JaVaScRiPt:alert(1)"), "#");
});

test("leading whitespace does not smuggle a scheme through", () => {
  assert.equal(safeHref("   javascript:alert(1)"), "#");
  assert.equal(safeHref("  https://example.com"), "https://example.com"); // trimmed, then passes
});

test("non-strings and empty values become '#'", () => {
  assert.equal(safeHref(""), "#");
  assert.equal(safeHref(null), "#");
  assert.equal(safeHref(undefined), "#");
  assert.equal(safeHref(42), "#");
  assert.equal(safeHref("//protocol-relative.example.com"), "#");
  assert.equal(safeHref("/relative/path"), "#");
});
