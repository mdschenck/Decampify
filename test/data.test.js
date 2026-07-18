/* test/data.test.js — catalog allowlist (api/_lib/data.js) */
import { test } from "node:test";
import assert from "node:assert/strict";
import { allStreamKeys, getRelease } from "../api/_lib/data.js";

test("allStreamKeys() contains a known release track streamKey", () => {
  const keys = allStreamKeys();
  assert.ok(keys.has("stream/first-light-ep/01-dawn-chorus.mp3"));
});

test("allStreamKeys() only contains stream/ keys — never downloads/", () => {
  const keys = allStreamKeys();
  assert.ok(keys.size > 0, "allowlist should not be empty");
  for (const key of keys) {
    assert.ok(key.startsWith("stream/"), "unexpected non-stream key: " + key);
    assert.ok(!key.startsWith("downloads/"), "purchase-gated key leaked: " + key);
  }
});

test("allStreamKeys() excludes a known downloads/ key", () => {
  assert.equal(allStreamKeys().has("downloads/first-light-ep/01-dawn-chorus.wav"), false);
});

test("getRelease() finds a known release and rejects bad ids", () => {
  const rel = getRelease("first-light-ep");
  assert.ok(rel);
  assert.equal(rel.id, "first-light-ep");
  assert.equal(getRelease("no-such-release"), null);
  assert.equal(getRelease(""), null);
  assert.equal(getRelease(null), null);
});
