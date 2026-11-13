const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("./rules.js");

test("outOfHoursFee is nothing inside 7:00 to 4:00", () => {
  assert.deepEqual(R.outOfHoursFee("09:00", 3), { fee: 0, startedHours: 0 });
  assert.deepEqual(R.outOfHoursFee("07:00", 9), { fee: 0, startedHours: 0 });
});

test("outOfHoursFee charges $35 per started hour outside the window", () => {
  assert.deepEqual(R.outOfHoursFee("06:00", 3), { fee: 35, startedHours: 1 });
  assert.deepEqual(R.outOfHoursFee("06:30", 2), { fee: 35, startedHours: 1 });
  assert.deepEqual(R.outOfHoursFee("15:00", 3), { fee: 70, startedHours: 2 });
  assert.deepEqual(R.outOfHoursFee("05:00", 4), { fee: 70, startedHours: 2 });
});

test("outOfHoursFee never throws on a bad time or length", () => {
  assert.deepEqual(R.outOfHoursFee("", 3), { fee: 0, startedHours: 0 });
  assert.deepEqual(R.outOfHoursFee("09:00", 0), { fee: 0, startedHours: 0 });
  assert.deepEqual(R.outOfHoursFee(undefined, undefined), { fee: 0, startedHours: 0 });
});

test("replyWithinHours is 24 normally and 2 inside 48 hours of the event", () => {
  assert.equal(R.replyWithinHours("2026-11-13T09:00:00Z", "2026-12-05T09:00:00Z"), 24);
  assert.equal(R.replyWithinHours("2026-11-13T09:00:00Z", "2026-11-14T09:00:00Z"), 2);
  assert.equal(R.replyWithinHours("bad", "2026-11-14T09:00:00Z"), 24);
});

test("slotIsFree keeps an hour between bookings for travel", () => {
  const day = [{ date: "2026-12-05", startTime: "09:00", endTime: "12:00" }];
  assert.equal(R.slotIsFree("2026-12-05", "13:00", 2, day), true);
  assert.equal(R.slotIsFree("2026-12-05", "12:30", 2, day), false);
  assert.equal(R.slotIsFree("2026-12-05", "06:00", 2, day), true); // ends 08:00, an hour before the 09:00 booking
  assert.equal(R.slotIsFree("2026-12-05", "06:30", 2, day), false); // ends 08:30, no gap before 09:00
  assert.equal(R.slotIsFree("2026-12-06", "09:00", 3, day), true);
});

test("decideChange applies a change that is free, in range and on 24 hours' notice", () => {
  const booking = { date: "2026-12-05", startTime: "09:00" };
  const others = [{ date: "2026-12-05", startTime: "14:00", endTime: "16:00" }];
  const change = { date: "2026-12-05", startTime: "09:00", hours: 3, travelKm: 20 };
  assert.deepEqual(R.decideChange(booking, change, others, "2026-11-13T09:00:00"), { decision: "apply", reasons: [] });
});

test("decideChange asks Sam when the notice is short, the slot is taken or travel is too far", () => {
  const booking = { date: "2026-11-14", startTime: "09:00" };
  const shortNotice = R.decideChange(booking, { date: "2026-11-14", startTime: "10:00", hours: 2, travelKm: 0 }, [], "2026-11-13T12:00:00");
  assert.equal(shortNotice.decision, "request");
  assert.ok(shortNotice.reasons.includes("less than 24 hours' notice"));

  const far = R.decideChange({ date: "2026-12-05", startTime: "09:00" }, { date: "2026-12-05", startTime: "09:00", hours: 2, travelKm: 80 }, [], "2026-11-13T09:00:00");
  assert.equal(far.decision, "request");
  assert.deepEqual(far.reasons, ["the address is beyond free travel"]);

  const taken = R.decideChange({ date: "2026-12-05", startTime: "09:00" }, { date: "2026-12-05", startTime: "09:00", hours: 2, travelKm: 0 },
    [{ date: "2026-12-05", startTime: "10:00", endTime: "12:00" }], "2026-11-13T09:00:00");
  assert.deepEqual(taken.reasons, ["the new time is not free on the van"]);
});

test("decideCancel gives a credit at 24 hours or more, and asks Sam inside that", () => {
  assert.deepEqual(R.decideCancel({ date: "2026-12-05", startTime: "09:00" }, "2026-11-13T09:00:00"), { decision: "credit", reasons: [] });
  assert.equal(R.decideCancel({ date: "2026-11-13", startTime: "18:00" }, "2026-11-13T09:00:00").decision, "request");
});
