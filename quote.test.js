const test = require("node:test");
const assert = require("node:assert/strict");
const { quote, packPrice, packBonus } = require("./quote.js");

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

test("bonus ladder for 20 people matches the approved table", () => {
  const rows = [[2, 3, 1.5, 241], [3, 4, 2, 322], [4, 5, 2.5, 402], [5, 6, 3, 482], [6, 7, 3.5, 563]];
  for (const [h, blocks, hours, value] of rows) {
    assert.deepEqual(packBonus(20, h), { blocks, hours, value }, `${h} hours`);
  }
});

test("the margin never falls below 43% for any headcount or length", () => {
  for (const n of [1, 5, 20, 100, 500]) {
    for (let h = 2; h <= 6; h++) {
      const { value } = packBonus(n, h);
      const margin = 0.5 - (0.5 * value) / packPrice(n, h);
      assert.ok(margin >= 0.43 - 0.002, `n=${n} h=${h} margin=${margin}`);
    }
  }
});

test("a higher floor shrinks the bonus, and 0.5 means none", () => {
  assert.equal(packBonus(20, 3, 0.5).blocks, 0);
  assert.ok(packBonus(20, 3, 0.45).blocks < packBonus(20, 3, 0.43).blocks);
});
