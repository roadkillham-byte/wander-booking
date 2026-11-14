const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("./rules.js");
globalThis.WanderRules = R;

test("sydneyEpoch uses AEDT (+11) in December and AEST (+10) in July", () => {
  assert.equal(new Date(R.sydneyEpoch("2026-12-05", "09:00")).toISOString(), "2026-12-04T22:00:00.000Z");
  assert.equal(new Date(R.sydneyEpoch("2026-07-05", "09:00")).toISOString(), "2026-07-04T23:00:00.000Z");
});

test("sydneyEpoch is right on both sides of the April and October daylight saving changes", () => {
  // Sydney's clocks went back at 3:00 am on 5 April 2026 and forward at 2:00 am on 4 October 2026.
  assert.equal(new Date(R.sydneyEpoch("2026-04-04", "12:00")).toISOString(), "2026-04-04T01:00:00.000Z");
  assert.equal(new Date(R.sydneyEpoch("2026-04-06", "12:00")).toISOString(), "2026-04-06T02:00:00.000Z");
  assert.equal(new Date(R.sydneyEpoch("2026-10-03", "12:00")).toISOString(), "2026-10-03T02:00:00.000Z");
  assert.equal(new Date(R.sydneyEpoch("2026-10-05", "12:00")).toISOString(), "2026-10-05T01:00:00.000Z");
});

test("sydneyEpoch returns NaN for a bad date or time rather than throwing", () => {
  assert.ok(Number.isNaN(R.sydneyEpoch("", "09:00")));
  assert.ok(Number.isNaN(R.sydneyEpoch("2026-12-05", "9am")));
});

test("instantOf reads a time with no offset as Sydney time, and honours an explicit offset", () => {
  assert.equal(new Date(R.instantOf("2026-12-01T06:00:00")).toISOString(), "2026-11-30T19:00:00.000Z");
  assert.equal(new Date(R.instantOf("2026-12-01T06:00:00+11:00")).toISOString(), "2026-11-30T19:00:00.000Z");
  assert.equal(new Date(R.instantOf("2026-12-01T19:00:00Z")).toISOString(), "2026-12-01T19:00:00.000Z");
});

test("noticeHours counts from Sydney's clock, across the daylight saving change", () => {
  // 7 am on 4 April is AEDT (+11); 9 am on 5 April is AEST (+10), after the clocks went back. Elapsed time is 27 hours.
  const hours = R.noticeHours("2026-04-04T07:00:00", "2026-04-05", "09:00");
  assert.equal(Math.round(hours * 10) / 10, 27);
});

test("replyWithinHours is 24 normally and 2 inside 48 hours of the event", () => {
  assert.equal(R.replyWithinHours("2026-11-13T09:00:00", "2026-12-05", "09:00"), 24);
  assert.equal(R.replyWithinHours("2026-11-13T09:00:00", "2026-11-14", "09:00"), 2);
});

test("slotIsFree keeps an hour between bookings for travel", () => {
  const day = [{ date: "2026-12-05", startTime: "09:00", endTime: "12:00" }];
  assert.equal(R.slotIsFree("2026-12-05", "13:00", 2, day), true);
  assert.equal(R.slotIsFree("2026-12-05", "12:30", 2, day), false);
  assert.equal(R.slotIsFree("2026-12-05", "06:00", 2, day), true); // ends 08:00, an hour before 09:00
  assert.equal(R.slotIsFree("2026-12-05", "06:30", 2, day), false); // ends 08:30, no gap before 09:00
  assert.equal(R.slotIsFree("2026-12-06", "09:00", 3, day), true);
  assert.equal(R.slotIsFree("2026-12-05", "09:00", 0, day), false);
});

test("isStale is true after six hours, measured in Sydney time", () => {
  assert.equal(R.isStale("2026-12-01T06:00:00", "2026-12-01T11:59:00"), false);
  assert.equal(R.isStale("2026-12-01T06:00:00", "2026-12-01T12:01:00"), true);
  assert.equal(R.isStale("", "2026-12-01T12:01:00"), true);
});

test("decideHold holds a free, fresh, 24-hour-notice slot, and otherwise asks Sam without an error", () => {
  const req = { date: "2026-12-12", startTime: "09:00", hours: 3, travelKm: 20 };
  assert.deepEqual(R.decideHold(req, [], "2026-12-01T06:00:00", "2026-12-01T07:00:00"), { decision: "held", reasons: [] });

  const taken = R.decideHold(req, [{ date: "2026-12-12", startTime: "09:00", endTime: "12:00" }], "2026-12-01T06:00:00", "2026-12-01T07:00:00");
  assert.equal(taken.decision, "requested");
  assert.deepEqual(taken.reasons, ["the time is not free on the van"]);

  const stale = R.decideHold(req, [], "2026-12-01T06:00:00", "2026-12-01T13:00:00");
  assert.equal(stale.decision, "requested");
  assert.ok(stale.reasons.includes("availability is out of date"));
});

test("decideChange applies a change that is free, in range and on 24 hours' notice, and asks Sam otherwise", () => {
  const booking = { date: "2026-12-05", startTime: "09:00" };
  const others = [{ date: "2026-12-05", startTime: "14:00", endTime: "16:00" }];
  const change = { date: "2026-12-05", startTime: "10:00", hours: 3, travelKm: 20 };
  assert.deepEqual(R.decideChange(booking, change, others, "2026-12-01T06:00:00", "2026-12-01T07:00:00").decision, "applied");

  const late = R.decideChange({ date: "2026-11-14", startTime: "09:00" }, { date: "2026-11-14", startTime: "10:00", hours: 2, travelKm: 0 }, [],
    "2026-11-13T12:00:00", "2026-11-13T12:00:00");
  assert.equal(late.decision, "requested");
  assert.ok(late.reasons.includes("less than 24 hours' notice"));

  const far = R.decideChange(booking, { date: "2026-12-05", startTime: "09:00", hours: 2, travelKm: 80 }, [], "2026-12-01T06:00:00", "2026-12-01T07:00:00");
  assert.deepEqual(far.reasons, ["the address is beyond free travel"]);
});

test("decideCancel always asks Sam to confirm the credit, and records whether the notice was 24 hours or more", () => {
  assert.deepEqual(R.decideCancel({ date: "2026-12-05", startTime: "09:00" }, "2026-12-01T07:00:00"), { decision: "requested", reasons: [] });
  assert.deepEqual(R.decideCancel({ date: "2026-12-01", startTime: "18:00" }, "2026-12-01T09:00:00"), {
    decision: "requested",
    reasons: ["less than 24 hours' notice"],
  });
});

test("sameAgainDate adds 28 days to a recent date", () => {
  assert.equal(R.sameAgainDate("2026-10-10", "2026-10-12"), "2026-11-07");
});

test("sameAgainDate moves forward a week at a time until at least 3 days after today", () => {
  assert.equal(R.sameAgainDate("2026-10-10", "2026-11-13"), "2026-11-21");
  assert.equal(R.sameAgainDate("2026-10-10", "2026-11-04"), "2026-11-07"); // exactly 3 days after today stands
  assert.equal(R.sameAgainDate("2026-10-10", "2026-11-05"), "2026-11-14");
});

test("sameAgainDate keeps the weekday of the last morning", () => {
  const weekday = (iso) => new Date(iso + "T12:00:00Z").getUTCDay();
  for (const today of ["2026-10-12", "2026-11-13", "2027-01-02"]) {
    assert.equal(weekday(R.sameAgainDate("2026-10-10", today)), weekday("2026-10-10"));
  }
});

test("sameAgainDate returns an empty string for a bad date", () => {
  assert.equal(R.sameAgainDate("", "2026-11-13"), "");
  assert.equal(R.sameAgainDate("2026-10-10", "soon"), "");
});

test("sydneyDate gives the Sydney calendar date of an instant, either side of midnight and the daylight saving change", () => {
  assert.equal(R.sydneyDate("2026-12-01T07:00:00+11:00"), "2026-12-01");
  assert.equal(R.sydneyDate("2026-12-01T13:30:00Z"), "2026-12-02"); // 00:30 next day in Sydney
  assert.equal(R.sydneyDate("2026-12-01T12:30:00Z"), "2026-12-01"); // 23:30 in Sydney
  assert.equal(R.sydneyDate("2026-04-04T15:30:00Z"), "2026-04-05"); // 02:30 AEDT, the day daylight saving ends
  assert.equal(R.sydneyDate("nonsense"), "");
});

test("addDays steps a calendar date by whole days across month, year and leap ends", () => {
  assert.equal(R.addDays("2026-12-30", 3), "2027-01-02");
  assert.equal(R.addDays("2028-02-28", 1), "2028-02-29");
  assert.equal(R.addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(R.addDays("bad", 1), "");
});

test("decideChange asks Sam when the NEW time is under 24 hours away, even if the booking itself is a week off", () => {
  const booking = { date: "2026-12-08", startTime: "09:00" };
  const soon = R.decideChange(booking, { date: "2026-12-02", startTime: "06:00", hours: 3, travelKm: 0 }, [], "2026-12-01T06:00:00", "2026-12-01T07:00:00");
  assert.equal(soon.decision, "requested");
  assert.ok(soon.reasons.includes("the new time is less than 24 hours away"));
  const fine = R.decideChange(booking, { date: "2026-12-02", startTime: "07:00", hours: 3, travelKm: 0 }, [], "2026-12-01T06:00:00", "2026-12-01T07:00:00");
  assert.equal(fine.decision, "applied", "exactly 24 hours stands");
});

test("trading hours are every day, 07:00 to 16:00, and the whole booking must fit inside them", () => {
  assert.equal(R.withinTradingHours("07:00", 3), true);
  assert.equal(R.withinTradingHours("13:00", 3), true, "ends exactly at 16:00");
  assert.equal(R.withinTradingHours("13:30", 3), false);
  assert.equal(R.withinTradingHours("06:30", 2), false);
  assert.equal(R.withinTradingHours("07:00", 10), false);
  assert.equal(R.withinTradingHours("", 3), false);
});

test("a hold outside the trading hours is asked of Sam, with a plain reason", () => {
  const req = { date: "2026-12-12", startTime: "14:00", hours: 3, travelKm: 0 };
  const out = R.decideHold(req, [], "2026-12-01T06:00:00", "2026-12-01T07:00:00");
  assert.equal(out.decision, "requested");
  assert.deepEqual(out.reasons, ["outside our usual hours (7 am to 4 pm)"]);
  const inside = R.decideHold({ ...req, startTime: "09:00" }, [], "2026-12-01T06:00:00", "2026-12-01T07:00:00");
  assert.equal(inside.decision, "held");
});

test("a change to a time outside the trading hours is asked of Sam", () => {
  const out = R.decideChange({ date: "2026-12-08", startTime: "09:00" }, { date: "2026-12-09", startTime: "14:30", hours: 3, travelKm: 0 }, [],
    "2026-12-01T06:00:00", "2026-12-01T07:00:00");
  assert.equal(out.decision, "requested");
  assert.ok(out.reasons.includes("the new time is outside our usual hours (7 am to 4 pm)"));
});

test("travelKmFor reads the picked suburb first, then the suburb named in the address, and is unknown otherwise", () => {
  assert.equal(R.travelKmFor("tea-gardens", ""), 7);
  assert.equal(R.travelKmFor("", "3 Lake Road, Tea Gardens"), 7);
  assert.equal(R.travelKmFor("hawks-nest", "9 Somewhere, Forster"), 3, "an explicit pick wins over the typed address");
  assert.equal(R.travelKmFor("", "12 Forster Way, Tea Gardens"), 80, "a street named after a far suburb counts as far: the farthest match wins");
  assert.equal(R.travelKmFor("other", "3 Lake Road, Tea Gardens"), null, "somewhere else is never guessed from the address");
  assert.equal(R.travelKmFor("", "7 Nowhere Lane, Wyong"), null);
  assert.equal(R.travelKmFor("", ""), null);
});

test("a hold or change with no known distance is asked of Sam, never held", () => {
  const req = { date: "2026-12-12", startTime: "09:00", hours: 3 };
  for (const km of [undefined, null, NaN]) {
    const out = R.decideHold({ ...req, travelKm: km }, [], "2026-12-01T06:00:00", "2026-12-01T07:00:00");
    assert.equal(out.decision, "requested");
    assert.deepEqual(out.reasons, ["the address has not been checked for travel distance"]);
  }
  assert.equal(R.decideHold({ ...req, travelKm: 0 }, [], "2026-12-01T06:00:00", "2026-12-01T07:00:00").decision, "held");
  const change = R.decideChange({ date: "2026-12-12", startTime: "09:00" }, { ...req, date: "2026-12-13" }, [], "2026-12-01T06:00:00", "2026-12-01T07:00:00");
  assert.equal(change.decision, "requested");
  assert.ok(change.reasons.includes("the address has not been checked for travel distance"));
});

test("suburbKeyFor names the suburb in an address, the farthest if several, and empty when none", () => {
  assert.equal(R.suburbKeyFor("3 Lake Road, Tea Gardens"), "tea-gardens");
  assert.equal(R.suburbKeyFor("12 Forster Way, Tea Gardens"), "forster");
  assert.equal(R.suburbKeyFor("7 Nowhere Lane, Wyong"), "");
  assert.equal(R.suburbKeyFor(""), "");
});
