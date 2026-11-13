const test = require("node:test");
const assert = require("node:assert/strict");
const { normalise, captureReferral, buildFormUrl } = require("./referral.js");

function memoryStore() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, String(v)) };
}
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 10, 13);

test("captureReferral stores a valid code from ?ref= and returns it", () => {
  const store = memoryStore();
  assert.equal(captureReferral("?ref=k7m2-qxtp", store, NOW), "K7M2-QXTP");
  assert.equal(captureReferral("", store, NOW + DAY), "K7M2-QXTP");
});

test("ignores an invalid code", () => {
  const store = memoryStore();
  assert.equal(captureReferral("?ref=K7M2-QXT0", store, NOW), null);
  assert.equal(captureReferral("?ref=", store, NOW), null);
  assert.equal(captureReferral("", store, NOW), null);
});

test("returns the stored code until 30 days pass, then null", () => {
  const store = memoryStore();
  captureReferral("?ref=K7M2QXTP", store, NOW);
  assert.equal(captureReferral("", store, NOW + 29 * DAY), "K7M2-QXTP");
  assert.equal(captureReferral("", store, NOW + 31 * DAY), null);
});

test("a fresh link replaces the stored code and restarts the 30 days", () => {
  const store = memoryStore();
  captureReferral("?ref=K7M2-QXTP", store, NOW);
  assert.equal(captureReferral("?ref=H4BC-7WDR", store, NOW + 20 * DAY), "H4BC-7WDR");
  assert.equal(captureReferral("", store, NOW + 45 * DAY), "H4BC-7WDR");
});

test("a blocked or missing storage never throws", () => {
  const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("full"); } };
  assert.equal(captureReferral("?ref=K7M2-QXTP", broken, NOW), "K7M2-QXTP");
  assert.equal(captureReferral("", broken, NOW), null);
  assert.equal(captureReferral("?ref=K7M2-QXTP", null, NOW), "K7M2-QXTP");
});

test("buildFormUrl leaves the base unchanged with no code", () => {
  const base = "https://docs.google.com/forms/d/e/abc/viewform";
  assert.equal(buildFormUrl(base, "123456", null), base);
  assert.equal(buildFormUrl(base, "123456", "not a code"), base);
});

test("buildFormUrl leaves the base unchanged when the question's entry id is not set yet", () => {
  const base = "https://docs.google.com/forms/d/e/abc/viewform";
  assert.equal(buildFormUrl(base, "", "K7M2-QXTP"), base);
});

test("buildFormUrl adds the prefilled entry for a code", () => {
  const base = "https://docs.google.com/forms/d/e/abc/viewform";
  assert.equal(buildFormUrl(base, "123456", "k7m2 qxtp"), base + "?usp=pp_url&entry.123456=K7M2-QXTP");
  assert.equal(buildFormUrl(base + "?x=1", "123456", "K7M2-QXTP"), base + "?x=1&usp=pp_url&entry.123456=K7M2-QXTP");
});

test("normalise gives the canonical form or null, and never throws", () => {
  assert.equal(normalise("k7m2qxtp"), "K7M2-QXTP");
  assert.equal(normalise(undefined), null);
  assert.equal(normalise("K7M2-QXTPX"), null);
});

test("the friend's note tells them about their 10% and starts hidden", () => {
  const html = require("node:fs").readFileSync(require("node:path").join(__dirname, "index.html"), "utf8");
  const note = /<p class="ref-note" id="ref-note"([^>]*)>([^<]*)<\/p>/.exec(html);
  assert.ok(note, "the note is on the page");
  assert.match(note[1], /\bhidden\b/, "it is hidden until the form's referral question is set up");
  assert.equal(note[2], "A friend sent you, so your first morning is 10% off. Send your details and we will thank them.");
});
