const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveLink, resolveTap, TAP_QUESTIONS } = require("./links.js");

const table = { page: "https://x.test/", form: "https://docs.google.com/forms/d/e/abc/viewform", call: "tel:0492801058", compare: "https://x.test/#pack" };

test("resolveLink returns the allowlisted url for a known key", () => {
  assert.equal(resolveLink("call", table), "tel:0492801058");
  assert.equal(resolveLink("page", table), "https://x.test/");
});

test("resolveLink refuses unknown keys, urls and odd characters", () => {
  for (const bad of ["evil", "https://evil.test", "page/../x", "PAGE", "", null, undefined, "page&to=x", "__proto__", "constructor"]) {
    assert.equal(resolveLink(bad, table), null, String(bad));
  }
});

test("resolveLink refuses a table entry that is not https, tel or mailto", () => {
  assert.equal(resolveLink("page", { page: "javascript:alert(1)" }), null);
  assert.equal(resolveLink("page", { page: "http://insecure.test" }), null);
});

test("resolveTap accepts only known question and answer pairs", () => {
  assert.deepEqual(resolveTap("industry", "office"), { q: "industry", a: "office" });
  assert.equal(resolveTap("industry", "nonsense"), null);
  assert.equal(resolveTap("zodiac", "office"), null);
  assert.equal(resolveTap("heard", "__proto__"), null);
});

test("every tap question has a prompt and chips", () => {
  for (const q of Object.values(TAP_QUESTIONS)) {
    assert.ok(q.prompt.length > 5);
    assert.ok(Object.keys(q.answers).length >= 3);
  }
});
