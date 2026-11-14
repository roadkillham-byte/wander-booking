const test = require("node:test");
const assert = require("node:assert/strict");
const { captureSource, NINETY_DAYS } = require("./source.js");

function memoryStore() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, String(v)) };
}
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 14);

test("reads utm_source, utm_medium and utm_campaign from the link and keeps them", () => {
  const store = memoryStore();
  assert.deepEqual(captureSource("?utm_source=instagram&utm_medium=social&utm_campaign=bio", store, NOW),
    { source: "instagram", medium: "social", campaign: "bio" });
  assert.deepEqual(captureSource("", store, NOW + DAY), { source: "instagram", medium: "social", campaign: "bio" });
});

test("first touch wins for 90 days, then a new tag replaces it", () => {
  const store = memoryStore();
  captureSource("?utm_source=instagram&utm_medium=social", store, NOW);
  assert.equal(captureSource("?utm_source=tiktok&utm_medium=social", store, NOW + 89 * DAY).source, "instagram");
  assert.equal(captureSource("?utm_source=tiktok&utm_medium=social", store, NOW + 91 * DAY).source, "tiktok");
  assert.equal(NINETY_DAYS, 90 * DAY);
});

test("with no tag it returns null when nothing is stored", () => {
  assert.equal(captureSource("", memoryStore(), NOW), null);
  assert.equal(captureSource("?foo=bar", memoryStore(), NOW), null);
});

test("cleans values: lowercase, only a-z 0-9 _ -, at most 40 characters", () => {
  const cleaned = captureSource("?utm_source=Insta%20Gram!%3Dcmd&utm_medium=Social", memoryStore(), NOW);
  assert.equal(cleaned.source, "instagramcmd");
  assert.equal(cleaned.medium, "social");
  const long = captureSource("?utm_source=" + "a".repeat(500), memoryStore(), NOW);
  assert.equal(long.source.length, 40);
});

test("?ref= with no utm tag counts as source referral, medium referral", () => {
  assert.deepEqual(captureSource("?ref=ABCD-EFGH", memoryStore(), NOW), { source: "referral", medium: "referral", campaign: "" });
});

test("a store that throws still returns what the link says, and null otherwise", () => {
  const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  assert.equal(captureSource("?utm_source=youtube&utm_medium=social", broken, NOW).source, "youtube");
  assert.equal(captureSource("", broken, NOW), null);
  assert.equal(captureSource("?utm_source=x", null, NOW).source, "x");
});
