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
import {
  cartLineKey,
  missingBalanceGroups,
  normalizeItemSelection,
  priceForSelection,
} from "../lib/menu-options.mjs";

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
      { itemId: "b", quantity: 1, unitPriceCent: 1000, selection: { capacity: "1.5L" } },
      { itemId: "a", quantity: 2, unitPriceCent: 800, selection: { spice_level: "中辣" } },
    ]),
    canonicalCart([
      { itemId: "a", quantity: 2, unitPriceCent: 800, selection: { spice_level: "中辣" } },
      { itemId: "b", quantity: 1, unitPriceCent: 1000, selection: { capacity: "1.5L" } },
    ]),
  );
});

test("menu option rules validate spice, discount larger beer sizes, and keep cart lines distinct", () => {
  assert.deepEqual(normalizeItemSelection("SKEWER", "FOOD", { spice_level: "特辣" }), { spice_level: "特辣" });
  assert.equal(normalizeItemSelection("SKEWER", "FOOD", { spice_level: "变态辣" }), null);
  const price500 = priceForSelection(1600, "BEER", { capacity: "500ML" });
  const price1500 = priceForSelection(1600, "BEER", { capacity: "1.5L" });
  const price3000 = priceForSelection(1600, "BEER", { capacity: "3L" });
  assert.equal(price500, 1600);
  assert.ok(price1500 / 3 < price500);
  assert.ok(price3000 / 6 < price1500 / 3);
  assert.notEqual(
    cartLineKey("lager", { capacity: "500ML" }),
    cartLineKey("lager", { capacity: "3L" }),
  );
});

test("pairing reminder is non-blocking and reports only missing groups", () => {
  assert.deepEqual(
    missingBalanceGroups([
      { category_code: "SKEWER", business_type: "FOOD" },
      { category_code: "VEGETABLE", business_type: "FOOD" },
      { category_code: "STAPLE", business_type: "FOOD" },
      { category_code: "BEER", business_type: "BEER" },
      { category_code: "DRINK", business_type: "DRINK" },
    ]),
    [],
  );
  assert.deepEqual(missingBalanceGroups([{ category_code: "SKEWER", business_type: "FOOD" }]), ["素菜", "主食", "啤酒", "饮料"]);
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
