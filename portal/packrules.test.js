const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("./packrules.js");

test("notice: a pack holder gets 12 hours, a single keeps 24, bad input is a request", () => {
  assert.equal(R.noticeAllowed({ hoursAhead: 24, isPackHolder: false }).outcome, "hold");
  assert.equal(R.noticeAllowed({ hoursAhead: 23, isPackHolder: false }).outcome, "request");
  assert.equal(R.noticeAllowed({ hoursAhead: 12, isPackHolder: true }).outcome, "hold");
  assert.equal(R.noticeAllowed({ hoursAhead: 12, isPackHolder: true }).shortNotice, true);
  assert.equal(R.noticeAllowed({ hoursAhead: 11.9, isPackHolder: true }).outcome, "request");
  assert.equal(R.noticeAllowed({ hoursAhead: 18, isPackHolder: true, urgentThisWeek: 2 }).outcome, "request");
  assert.equal(R.noticeAllowed({ hoursAhead: 30, isPackHolder: true, urgentThisWeek: 5 }).outcome, "hold");
  assert.equal(R.noticeAllowed({ hoursAhead: NaN, isPackHolder: true }).outcome, "request");
});

test("pause: up to 42 days a term, 7 days' notice, whole-term total counted", () => {
  assert.equal(R.pauseAllowed({ pausedDaysSoFar: 0, requestDays: 14, noticeDays: 7 }).ok, true);
  assert.equal(R.pauseAllowed({ pausedDaysSoFar: 35, requestDays: 14, noticeDays: 7 }).code, "too-long");
  assert.equal(R.pauseAllowed({ pausedDaysSoFar: 0, requestDays: 7, noticeDays: 6 }).code, "notice");
  assert.equal(R.pauseAllowed({ pausedDaysSoFar: 0, requestDays: 42, noticeDays: 7 }).remainingDays, 0);
});

test("standing capacity: 4 a week, 2 a weekday, 40% of the planned mornings", () => {
  const two = [{ weekday: 2 }, { weekday: 2 }];
  assert.equal(R.standingCapacity(two, { weekday: 2 }, 10).code, "weekday-full");
  assert.equal(R.standingCapacity([{ weekday: 1 }, { weekday: 2 }, { weekday: 3 }, { weekday: 4 }], { weekday: 5 }, 10).code, "week-full");
  assert.equal(R.standingCapacity([{ weekday: 1 }], { weekday: 2 }, 10).ok, true);
  assert.equal(R.standingCapacity([{ weekday: 1 }, { weekday: 2 }], { weekday: 3 }, 5).code, "share");
  assert.equal(R.standingCapacity([], { weekday: 3 }, 0).code, "no-mornings");
});

test("a standing morning is confirmed up to the day 7 days out, then due for release", () => {
  assert.equal(R.standingReleaseDue({ date: "2026-12-22", confirmed: false }, "2026-12-15").due, false);
  assert.equal(R.standingReleaseDue({ date: "2026-12-22", confirmed: false }, "2026-12-16").due, true);
  assert.equal(R.standingReleaseDue({ date: "2026-12-22", confirmed: true }, "2026-12-20").due, false);
});

test("first pick opens at Sydney midnight three calendar days before the public (71 hours across the October clock change)", () => {
  assert.equal(R.firstPickOpenDay("2026-12-10"), "2026-12-07");
  assert.equal(R.firstPickOpensAt("2026-12-10"), "2026-12-06T13:00:00.000Z");
  assert.equal(R.isFirstPickOpen("2026-12-10", "2026-12-06T13:00:00.000Z"), true);
  assert.equal(R.isFirstPickOpen("2026-12-10", "2026-12-06T12:59:59.000Z"), false);
  assert.equal(R.firstPickOpensAt("2026-10-07"), "2026-10-03T14:00:00.000Z"); // 4 Oct 00:00 is still +10; the clock change is at 2 am that day
  assert.equal(R.firstPickOpensAt("nonsense"), null);
});

// When PACKRULES_SOURCE points at the app's server/packRules.mjs, every export must answer the same on a battery of inputs.
test("same answers as the app's server/packRules.mjs (set PACKRULES_SOURCE to its path)", async (t) => {
  if (!process.env.PACKRULES_SOURCE) return t.skip("PACKRULES_SOURCE not set");
  const A = await import(process.env.PACKRULES_SOURCE);
  const mine = Object.keys(R).sort();
  assert.deepEqual(mine, Object.keys(A).filter((k) => !/^default$/.test(k)).sort());
  for (const h of [0, 5, 11.9, 12, 12.1, 18, 23.99, 24, 48, NaN, -1]) for (const p of [true, false]) for (const u of [0, 1, 2, 3, undefined]) {
    assert.deepEqual(R.noticeAllowed({ hoursAhead: h, isPackHolder: p, urgentThisWeek: u }), A.noticeAllowed({ hoursAhead: h, isPackHolder: p, urgentThisWeek: u }));
  }
  for (const so of [0, 7, 35, 41, 42]) for (const rd of [0, 1, 7, 14, 42, 43]) for (const nd of [0, 6, 7, 30]) {
    assert.deepEqual(R.pauseAllowed({ pausedDaysSoFar: so, requestDays: rd, noticeDays: nd }), A.pauseAllowed({ pausedDaysSoFar: so, requestDays: rd, noticeDays: nd }));
  }
  for (const day of ["2026-10-07", "2026-12-10", "2027-04-07", "bad"]) {
    assert.equal(R.firstPickOpensAt(day), A.firstPickOpensAt(day));
    assert.equal(R.firstPickOpenDay(day), A.firstPickOpenDay(day));
  }
  for (const d of ["2026-12-15", "2026-12-16", "2026-12-22"]) for (const c of [true, false]) {
    assert.deepEqual(R.standingReleaseDue({ date: "2026-12-22", confirmed: c }, d), A.standingReleaseDue({ date: "2026-12-22", confirmed: c }, d));
  }
  for (let n = 0; n <= 5; n++) for (let wd = 0; wd < 7; wd++) for (const planned of [0, 5, 9, 10]) {
    const existing = Array.from({ length: n }, (_, i) => ({ weekday: (wd + i) % 7 }));
    assert.deepEqual(R.standingCapacity(existing, { weekday: wd }, planned), A.standingCapacity(existing, { weekday: wd }, planned));
  }
});
