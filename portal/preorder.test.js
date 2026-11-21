const test = require("node:test");
const assert = require("node:assert/strict");
globalThis.window = {};
const P = require("./preorder.js");

test("a #p= link is a pre-order page and anything else is not", () => {
  assert.equal(P.active("#p=ABC"), true);
  assert.equal(P.active("p=ABC"), true);
  assert.equal(P.active("#k=ABC&v=home"), false);
  assert.equal(P.active(""), false);
  assert.equal(P.active("#p="), false);
  assert.equal(P.keyFrom("#p=ABC%20D"), "ABC D");
});

test("the day and time read in plain words", () => {
  assert.equal(P.dayLabel("2026-12-05"), "Saturday 5 December");
  assert.equal(P.dayLabel("nope"), "");
  assert.equal(P.clock("09:00"), "9 am");
  assert.equal(P.clock("12:30"), "12:30 pm");
  assert.equal(P.clock("00:00"), "12 am");
});
