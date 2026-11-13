const test = require("node:test");
const assert = require("node:assert/strict");
const { createTracker, sanitise, buildView } = require("./track.js");

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => void m.set(k, String(v)), _m: m };
}
function setup(over = {}) {
  const sent = [];
  const t = createTracker({
    url: "https://script.example/exec", siteKey: "KEY", storage: memoryStorage(), session: memoryStorage(),
    now: () => 1000, send: (url, body) => sent.push({ url, body: JSON.parse(body) }), nav: {}, random: () => 0, ...over,
  });
  return { t, sent };
}

test("disabled with no url or no site key", () => {
  assert.equal(setup({ url: "" }).t.enabled, false);
  assert.equal(setup({ siteKey: "" }).t.enabled, false);
  assert.equal(setup().t.enabled, true);
});

test("Global Privacy Control and Do Not Track switch it off and nothing is sent", () => {
  for (const nav of [{ globalPrivacyControl: true }, { doNotTrack: "1" }]) {
    const { t, sent } = setup({ nav });
    assert.equal(t.enabled, false);
    t.track("view", { path: "/" }); t.flush();
    assert.equal(sent.length, 0);
  }
  assert.equal(setup({ nav: { doNotTrack: "1" }, respectDnt: false }).t.enabled, true);
});

test("sanitise drops unknown types and fields and cuts strings to 40", () => {
  assert.equal(sanitise("keylog", { a: 1 }), null);
  const s = sanitise("view", { path: "x".repeat(100), secret: "no", vn: 3.7 });
  assert.deepEqual(Object.keys(s.d).sort(), ["path", "vn"]);
  assert.equal(s.d.path.length, 40);
  assert.equal(s.d.vn, 4);
  assert.deepEqual(sanitise("cta", { form: "yes" }).d, { form: true });
});

test("visitor id is created once and reused; blocked storage still works", () => {
  const storage = memoryStorage();
  const a = setup({ storage }).t, b = setup({ storage }).t;
  assert.equal(a.visitorId, b.visitorId);
  const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  const c = setup({ storage: blocked, session: blocked }).t;
  assert.ok(c.visitorId.length >= 8);
  c.track("calc", { p: 20, h: 3 });
});

test("flush sends batches of at most 20 as one JSON body with ids", () => {
  const { t, sent } = setup();
  for (let i = 0; i < 45; i++) t.track("calc", { p: i, h: 3 });
  t.flush();
  assert.deepEqual(sent.map((s) => s.body.e.length), [20, 20, 5]);
  assert.equal(sent[0].body.k, "KEY");
  assert.equal(sent[0].body.v, t.visitorId);
  assert.equal(sent[0].body.s, t.sessionId);
  assert.equal(sent[0].url, "https://script.example/exec");
});

test("experiment variants are assigned once and reported on view", () => {
  const storage = memoryStorage();
  const exp = { headline: ["a", "b"] };
  const first = setup({ storage, experiments: exp, random: () => 0.9 }).t;
  const again = setup({ storage, experiments: exp, random: () => 0 }).t;
  assert.equal(first.variants.headline, "b");
  assert.equal(again.variants.headline, "b");
  assert.equal(first.viewData({}).x, "headline:b");
});

test("scroll depth fires each threshold once, in order", () => {
  const { t, sent } = setup();
  t.scroll(10); t.scroll(30); t.scroll(30); t.scroll(80); t.scroll(100); t.flush();
  assert.deepEqual(sent[0].body.e.map((e) => e.d.pct), [25, 50, 75, 100]);
});

test("buildView reads utm, referral code and referrer host only", () => {
  const d = buildView({ search: "?utm_source=ig&utm_medium=bio&utm_campaign=nov&ref=k7m2%20qxtp", referrer: "https://www.instagram.com/p/abc?x=1",
    lang: "en-AU", tzo: -660, hour: 9, width: 390, coarse: true, path: "/wander-booking/" });
  assert.equal(d.us, "ig"); assert.equal(d.um, "bio"); assert.equal(d.uc, "nov");
  assert.equal(d.rc, "K7M2-QXTP");
  assert.equal(d.ref, "www.instagram.com");
  assert.equal(d.dev, "m"); assert.equal(d.lh, 9); assert.equal(d.tzo, -660);
  assert.equal(buildView({ search: "?ref=nonsense", width: 1400, coarse: false }).rc, undefined);
  assert.equal(buildView({ search: "", width: 1400, coarse: false }).dev, "d");
});
