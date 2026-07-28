import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assertMockConfiguration,
  businessDate,
  canonicalCart,
  inSalePeriods,
  normalizePhone,
  transitionAllowed,
  validPassword,
} from "../lib/rules.mjs";

test("password hashing stays within the Cloudflare WebCrypto PBKDF2 limit", () => {
  const source = readFileSync(new URL("../lib/security.ts", import.meta.url), "utf8");
  assert.match(source, /PASSWORD_PBKDF2_ITERATIONS = 100_000/);
  assert.doesNotMatch(source, /iterations:\s*120_000/);
});

test("production refuses to run with Mock SMS enabled", () => {
  assert.throws(() => assertMockConfiguration("production", "true"), /Refusing to start/);
  assert.doesNotThrow(() => assertMockConfiguration("production", "false"));
  assert.doesNotThrow(() => assertMockConfiguration("development", "true"));
});

test("phone normalization follows the frozen +86 rule", () => {
  assert.equal(normalizePhone(" +86 138-0013-8000 "), "13800138000");
  assert.equal(normalizePhone("8613900139000"), "13900139000");
  assert.equal(normalizePhone("12800138000"), null);
  assert.equal(normalizePhone("+971501234567"), null);
});

test("password and cart canonicalization are deterministic", () => {
  assert.equal(validPassword("grill1234"), true);
  assert.equal(validPassword("abcdefgh"), false);
  assert.equal(validPassword("12345678"), false);
  assert.equal(
    canonicalCart([
      { itemId: "b", quantity: 1, unitPriceCent: 1000 },
      { itemId: "a", quantity: 2, unitPriceCent: 800 },
    ]),
    canonicalCart([
      { itemId: "a", quantity: 2, unitPriceCent: 800 },
      { itemId: "b", quantity: 1, unitPriceCent: 1000 },
    ]),
  );
});

test("state machine allows only the four frozen transitions", () => {
  assert.equal(transitionAllowed("PENDING_CONFIRM", "CONFIRMED"), true);
  assert.equal(transitionAllowed("PENDING_CONFIRM", "REJECTED"), true);
  assert.equal(transitionAllowed("PENDING_CONFIRM", "CANCELLED"), true);
  assert.equal(transitionAllowed("CONFIRMED", "VOIDED"), true);
  assert.equal(transitionAllowed("CONFIRMED", "CANCELLED"), false);
  assert.equal(transitionAllowed("VOIDED", "CONFIRMED"), false);
});

test("sale periods are half-open and support crossing midnight", () => {
  const period = [{ days: [1], start: "22:00", end: "02:00" }];
  assert.equal(inSalePeriods(period, new Date("2026-07-27T15:00:00Z")), true);
  assert.equal(inSalePeriods(period, new Date("2026-07-27T17:59:00Z")), true);
  assert.equal(inSalePeriods(period, new Date("2026-07-27T18:00:00Z")), false);
  assert.equal(businessDate(new Date("2026-07-27T16:30:00Z")), "2026-07-28");
});
