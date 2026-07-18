/* test/token.test.js — HMAC token sign/verify (api/_lib/token.js) */
import { test } from "node:test";
import assert from "node:assert/strict";

// token.js reads MR_TOKEN_SECRET at call time — set it before any calls.
process.env.MR_TOKEN_SECRET = "test-secret-for-node-test-only";

const { signToken, verifyToken, tokenReady } = await import("../api/_lib/token.js");

test("tokenReady() is true when MR_TOKEN_SECRET is set", () => {
  assert.equal(tokenReady(), true);
});

test("roundtrip: signToken → verifyToken returns the payload", () => {
  const token = signToken({ t: "dl", releaseId: "first-light-ep", format: "wav" }, 60);
  const payload = verifyToken(token);
  assert.ok(payload, "expected a payload, got null");
  assert.equal(payload.t, "dl");
  assert.equal(payload.releaseId, "first-light-ep");
  assert.equal(payload.format, "wav");
  assert.equal(typeof payload.exp, "number");
});

test("tampered signature is rejected", () => {
  const token = signToken({ t: "dl", releaseId: "first-light-ep", format: "wav" }, 60);
  const dot = token.indexOf(".");
  const sig = token.slice(dot + 1);
  // Flip the first character of the signature to something different.
  const flipped = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
  assert.equal(verifyToken(token.slice(0, dot + 1) + flipped), null);
});

test("tampered payload is rejected", () => {
  const token = signToken({ t: "dl", releaseId: "first-light-ep", format: "mp3" }, 60);
  const dot = token.indexOf(".");
  const forged = Buffer.from(
    JSON.stringify({ t: "dl", releaseId: "night-signals", format: "wav", exp: 9999999999 })
  ).toString("base64url");
  assert.equal(verifyToken(forged + token.slice(dot)), null);
});

test("expired token is rejected", () => {
  const token = signToken({ t: "dl", releaseId: "first-light-ep", format: "wav" }, -10);
  assert.equal(verifyToken(token), null);
});

test("garbage input never throws, returns null", () => {
  assert.equal(verifyToken(null), null);
  assert.equal(verifyToken(""), null);
  assert.equal(verifyToken("no-dot-here"), null);
  assert.equal(verifyToken(".only-a-sig"), null);
  assert.equal(verifyToken("not-base64!!.also-not!!"), null);
});
