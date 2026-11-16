const test = require("node:test");
const assert = require("node:assert/strict");
const { quote, packPrice } = require("./quote.js");

test("quote matches the rate card", () => {
  assert.equal(quote(20, 2), 458);
  assert.equal(quote(20, 3), 619);
  assert.equal(quote(50, 3), 1137);
});

test("pack price is four singles, no discount", () => {
  assert.equal(packPrice(20, 2), 1832);
  assert.equal(packPrice(20, 3), 2476);
  assert.equal(packPrice(20, 6), 4404);
});

test("the 4-Pack carries no bonus time (Sam, 16 Nov 2026: drop the bonus hours)", () => {
  const api = require("./quote.js");
  assert.equal(api.packBonus, undefined);
  assert.deepEqual(Object.keys(api).sort(), ["contractTerms", "packPrice", "quote"]);
});

test("the booking page never promises 4-Pack bonus time", () => {
  const fs = require("node:fs");
  const html = fs.readFileSync(__dirname + "/index.html", "utf8");
  for (const word of [/bonus/i, /thrown in/i, /coffee time/i, /free, worth/i, /30 minutes at a time/i]) {
    assert.doesNotMatch(html, word, String(word));
  }
  assert.match(html, /same price as four single mornings/i);
});

test("the booking page says the 4-Pack costs four singles and is used any time in 12 months", () => {
  const fs = require("node:fs");
  const html = fs.readFileSync(__dirname + "/index.html", "utf8");
  assert.match(html, /Price locked, 12 months/);
  assert.match(html, /any time in 12 months/);
});

test("contract terms: 20 people, 2 hours is 12, 24 and 48 mornings at $458 with 1, 2 and 4 bonus hours", () => {
  const { contractTerms } = require("./quote.js");
  const t = contractTerms(20, 2);
  assert.deepEqual(t.map((x) => [x.months, x.mornings, x.total, x.freeHours]), [[3, 12, 5496, 1], [6, 24, 10992, 2], [12, 48, 21984, 4]]);
  assert.equal(t[0].monthly, 1832);
  assert.deepEqual(t[0].methods, ["bank", "card"]);
  assert.deepEqual(t[1].methods, ["bank"]);
  assert.deepEqual(t[2].methods, ["bank"]);
});

test("contract bonus hours hold 43% on both bases for any group size and length", () => {
  const { contractTerms, quote } = require("./quote.js");
  for (const people of [1, 5, 20, 50, 200]) {
    for (const h of [1, 2, 3, 4, 5, 6]) {
      for (const t of contractTerms(people, h)) {
        const price = t.total;
        const cost = t.mornings * 0.5 * quote(people, h) + t.freeHours * 0.5 * (people * 4.62 + 68.41);
        assert.ok((price - cost) / price >= 0.43 - 1e-9, `card ${people}/${h}/${t.months}`);
        assert.ok((price / 1.1 - cost) / (price / 1.1) >= 0.43 - 1e-9, `ex-GST ${people}/${h}/${t.months}`);
      }
    }
  }
});

test("the booking page offers paying ahead as an enquiry: three terms, bank transfer on 6 and 12, nothing charged online", () => {
  const fs = require("node:fs");
  const html = fs.readFileSync(__dirname + "/index.html", "utf8");
  assert.match(html, /value="Prepaid contract"/);
  assert.match(html, /paid by bank transfer/i);
  assert.doesNotMatch(html, /Sam will ring/i); // client copy says "we"
  assert.match(html, /Nothing is charged online/);
  assert.match(html, /pause for up to 6 weeks/);
  assert.match(html, /"Prepaid contract " \+ field\("contract-term"\)\.value \+ " months"/);
  // the contract wording follows the same rule as the 4-Pack: no "bonus" word, no thrown-in extras
  assert.doesNotMatch(html, /bonus/i);
});
