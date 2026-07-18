/* test/pricing.test.js — price-model enforcement (api/_lib/pricing.js) */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolvePricing } from "../api/_lib/pricing.js";

const nypFloor = { priceModel: "nyp-floor", priceFloor: 7 };
const fixed = { priceModel: "fixed", priceFloor: 5 };
const nyp = { priceModel: "nyp", priceFloor: 0 };
const free = { priceModel: "free" };

test("nyp-floor: below floor is rejected", () => {
  const out = resolvePricing(nypFloor, 6.99);
  assert.equal(out.error, "Minimum price for this release is $7.00.");
});

test("nyp-floor: at and above floor is a paid checkout", () => {
  assert.deepEqual(resolvePricing(nypFloor, 7), {});
  assert.deepEqual(resolvePricing(nypFloor, 25), {});
});

test("fixed: wrong amount is rejected (under AND over)", () => {
  const under = resolvePricing(fixed, 4.99);
  assert.equal(under.error, "This release has a fixed price of $5.00.");
  const over = resolvePricing(fixed, 5.01);
  assert.equal(over.error, "This release has a fixed price of $5.00.");
});

test("fixed: exact amount is a paid checkout", () => {
  assert.deepEqual(resolvePricing(fixed, 5), {});
});

test("nyp: $0 takes the free path", () => {
  assert.deepEqual(resolvePricing(nyp, 0), { free: true });
});

test("nyp: any positive amount is a paid checkout", () => {
  assert.deepEqual(resolvePricing(nyp, 0.01), {});
  assert.deepEqual(resolvePricing(nyp, 100), {});
});

test("free: always the free path, regardless of amount", () => {
  assert.deepEqual(resolvePricing(free, 0), { free: true });
  assert.deepEqual(resolvePricing(free, 10), { free: true });
});

test("unknown price model is rejected", () => {
  const out = resolvePricing({ priceModel: "subscription", priceFloor: 5 }, 5);
  assert.equal(out.error, "Release has an unknown price model.");
});
