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
  assert.deepEqual(Object.keys(api).sort(), ["packPrice", "quote"]);
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
