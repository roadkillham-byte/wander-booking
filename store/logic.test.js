const test = require("node:test");
const assert = require("node:assert/strict");
const WanderRules = require("../rules.js");
globalThis.WanderRules = WanderRules;
const S = require("./logic.js");

const APP = "APP-TOKEN-0123456789abcdef";
const NOW = "2026-12-01T07:00:00+11:00"; // 1 Dec, 7 am Sydney
const FRESH = "2026-12-01T06:00:00+11:00";

// In-memory db with the same semantics as the Sheet adapter: reads return copies; writes replace; append adds a row.
function makeDb(env) {
  const tables = {};
  Object.keys(S.TABLES).forEach((t) => (tables[t] = []));
  const settings = Object.assign({ APP_TOKEN: APP }, env || {});
  let locked = 0;
  return {
    tables,
    read: (t) => JSON.parse(JSON.stringify(tables[t])),
    write: (t, rows) => { tables[t] = JSON.parse(JSON.stringify(rows)); },
    append: (t, row) => { tables[t].push(JSON.parse(JSON.stringify(row))); },
    lock: (fn) => { locked += 1; try { return fn(); } finally { locked -= 1; } },
    env: (name) => settings[name],
  };
}

function publish(db, over = {}) {
  const snapshot = Object.assign({
    asOf: FRESH,
    clients: [
      { token: "TOKEN-ALEX-0000000000000001", firstName: "Alex", referralCode: "K7M2-QXTP" },
      { token: "TOKEN-SAM-00000000000000002", firstName: "Sam", referralCode: "H4BC-7WDR" },
    ],
    bookings: [
      { id: "bk-101", clientToken: "TOKEN-ALEX-0000000000000001", status: "confirmed", date: "2026-12-05", startTime: "09:00", endTime: "12:00",
        people: 20, hours: 3, address: "1 Main Street, Forster", total: 619, outOfHoursFee: 0, requestId: "" },
    ],
    busy: [{ date: "2026-12-05", startTime: "09:00", endTime: "12:00" }],
    credits: [{ clientToken: "TOKEN-ALEX-0000000000000001", kind: "referral", label: "10% off your next booking", expiresAt: "2027-11-13" }],
  }, over);
  return S.publish(db, APP, snapshot, NOW);
}

const hold = (token, requestId, date, startTime) => ({
  k: token, kind: "hold", requestId, date, startTime, people: 20, hours: 3, address: "3 Lake Road, Tea Gardens",
});

test("publish needs the app token, and a short or wrong token is refused", () => {
  const db = makeDb();
  assert.deepEqual(S.publish(db, "wrong", { asOf: FRESH }, NOW), { ok: false, error: "not-allowed" });
  const short = makeDb({ APP_TOKEN: "short" });
  assert.deepEqual(S.publish(short, "short", { asOf: FRESH }, NOW), { ok: false, error: "not-allowed" });
});

test("a publish replaces clients, bookings, busy times and credits, and is safe to send again", () => {
  const db = makeDb();
  assert.equal(publish(db).ok, true);
  assert.equal(publish(db).ok, true);
  assert.equal(db.tables.clients.length, 2);
  assert.equal(db.tables.bookings.length, 1);
  assert.equal(db.tables.busy.length, 1);
});

test("two clients cannot hold the same slot: the second is asked of Sam, not given it", () => {
  const db = makeDb();
  publish(db);
  const first = S.request(db, hold("TOKEN-SAM-00000000000000002", "req-sam-1", "2026-12-12", "09:00"), NOW);
  assert.equal(first.outcome, "held");
  const second = S.request(db, hold("TOKEN-ALEX-0000000000000001", "req-alex-1", "2026-12-12", "10:00"), NOW);
  assert.equal(second.outcome, "requested");
  assert.equal(db.tables.holds.length, 1);
});

test("a hold that overlaps a published booking is requested, and a free one is held with a bookingId", () => {
  const db = makeDb();
  publish(db);
  assert.equal(S.request(db, hold("TOKEN-ALEX-0000000000000001", "req-a", "2026-12-05", "10:00"), NOW).outcome, "requested");
  const ok = S.request(db, hold("TOKEN-ALEX-0000000000000001", "req-b", "2026-12-19", "09:00"), NOW);
  assert.equal(ok.outcome, "held");
  assert.equal(ok.bookingId, "hold-req-b");
  assert.equal(ok.replyWithinHours, 24);
});

test("stale or missing availability turns a hold into a request, never an automatic yes", () => {
  const db = makeDb();
  publish(db);
  db.write("meta", []); // no as-of time at all
  const none = S.request(db, hold("TOKEN-ALEX-0000000000000001", "req-x", "2026-12-19", "09:00"), NOW);
  assert.equal(none.outcome, "requested");
  publish(db, { asOf: "2026-12-01T00:00:00+11:00" }); // seven hours before NOW
  const stale = S.request(db, hold("TOKEN-ALEX-0000000000000001", "req-y", "2026-12-19", "09:00"), NOW);
  assert.equal(stale.outcome, "requested");
  assert.equal(S.session(db, "TOKEN-ALEX-0000000000000001", NOW).stale, true);
});

test("Sydney time decides the notice: 7:30 am on the day is under 24 hours, a day ahead is not", () => {
  const db = makeDb();
  publish(db, { asOf: "2026-12-04T20:00:00Z" });
  const sameMorning = S.request(db, hold("TOKEN-ALEX-0000000000000001", "req-z1", "2026-12-05", "15:00"), "2026-12-04T20:30:00Z");
  assert.equal(sameMorning.outcome, "requested");
  const dayAhead = S.request(db, hold("TOKEN-ALEX-0000000000000001", "req-z2", "2026-12-20", "09:00"), "2026-12-04T20:30:00Z");
  assert.equal(dayAhead.outcome, "held");
});

test("a session returns only that client's data, never another client's name, token or referral code", () => {
  const db = makeDb();
  publish(db);
  S.request(db, hold("TOKEN-SAM-00000000000000002", "req-sam-2", "2026-12-19", "09:00"), NOW);
  const view = S.session(db, "TOKEN-ALEX-0000000000000001", NOW);
  assert.equal(view.ok, true);
  assert.equal(view.client.firstName, "Alex");
  assert.deepEqual(view.bookings.map((b) => b.id), ["bk-101"]);
  assert.equal(view.credits.length, 1);
  const text = JSON.stringify(view);
  assert.equal(text.includes("Sam"), false);
  assert.equal(text.includes("TOKEN-SAM"), false);
  assert.equal(text.includes("H4BC-7WDR"), false);
  assert.deepEqual(S.session(db, "unknown-token", NOW), { ok: false, error: "not-found" });
});

test("a resent request with the same requestId returns the same answer and writes nothing twice", () => {
  const db = makeDb();
  publish(db);
  const body = hold("TOKEN-ALEX-0000000000000001", "req-dup", "2026-12-19", "09:00");
  const first = S.request(db, body, NOW);
  const again = S.request(db, body, "2026-12-01T07:05:00+11:00");
  assert.deepEqual(again, first);
  assert.equal(db.tables.queue.length, 1);
  assert.equal(db.tables.holds.length, 1);
});

test("a change is applied when the slot is free, and only the owner can change a booking", () => {
  const db = makeDb();
  publish(db);
  const change = { k: "TOKEN-ALEX-0000000000000001", kind: "change", requestId: "req-c1", bookingId: "bk-101",
    date: "2026-12-05", startTime: "10:00", people: 20, hours: 3, address: "1 Main Street, Forster" };
  // Notice is more than 24 hours (1 Dec to 5 Dec), and the slot only overlaps the booking itself.
  const done = S.request(db, change, NOW);
  assert.equal(done.outcome, "applied");
  assert.equal(done.message, "Done. Your morning now starts at 10:00.");
  const notOwner = S.request(db, Object.assign({}, change, { k: "TOKEN-SAM-00000000000000002", requestId: "req-c2" }), NOW);
  assert.deepEqual(notOwner, { ok: false, error: "not-found" });
});

test("a change into a taken slot, or inside 24 hours, is requested rather than refused", () => {
  const db = makeDb();
  publish(db, { busy: [{ date: "2026-12-05", startTime: "09:00", endTime: "12:00" }, { date: "2026-12-05", startTime: "14:00", endTime: "17:00" }] });
  const taken = S.request(db, { k: "TOKEN-ALEX-0000000000000001", kind: "change", requestId: "req-c3", bookingId: "bk-101",
    date: "2026-12-05", startTime: "14:00", people: 20, hours: 3, address: "1 Main Street, Forster" }, NOW);
  assert.equal(taken.outcome, "requested");
  assert.equal(taken.message, "Requested: we will text you within 24 hours to confirm this.");
});

test("a cancellation is always asked of Sam, so the credit is confirmed before it is promised", () => {
  const db = makeDb();
  publish(db);
  const cancel = S.request(db, { k: "TOKEN-ALEX-0000000000000001", kind: "cancel", requestId: "req-k1", bookingId: "bk-101" }, NOW);
  assert.equal(cancel.outcome, "requested");
  assert.match(cancel.message, /We will confirm your credit within 24 hours/);
});

test("requests are checked before they are stored: a bad people count, hours or date writes nothing", () => {
  const db = makeDb();
  publish(db);
  const k = "TOKEN-ALEX-0000000000000001";
  assert.deepEqual(S.request(db, Object.assign(hold(k, "r1", "2026-12-19", "09:00"), { people: 0 }), NOW), { ok: false, error: "bad-people" });
  assert.deepEqual(S.request(db, Object.assign(hold(k, "r2", "2026-12-19", "09:00"), { hours: 7 }), NOW), { ok: false, error: "bad-hours" });
  assert.deepEqual(S.request(db, Object.assign(hold(k, "r3", "19/12/2026", "09:00"), {}), NOW), { ok: false, error: "bad-date-or-time" });
  assert.deepEqual(S.request(db, { k, kind: "bogus", requestId: "r4" }, NOW), { ok: false, error: "unknown-kind" });
  assert.equal(db.tables.queue.length, 0);
});

test("pending returns unacknowledged requests for Coffee Van; ack removes them; the hold stays until a publish lists it", () => {
  const db = makeDb();
  publish(db);
  S.request(db, hold("TOKEN-ALEX-0000000000000001", "req-p1", "2026-12-19", "09:00"), NOW);
  assert.equal(S.pending(db, "wrong").error, "not-allowed");
  const got = S.pending(db, APP);
  assert.equal(got.items.length, 1);
  assert.equal(got.items[0].kind, "hold");
  assert.equal(got.items[0].date, "2026-12-19");
  assert.equal(got.items[0].clientToken, "TOKEN-ALEX-0000000000000001");

  assert.deepEqual(S.ack(db, APP, ["req-p1"]), { ok: true, acked: 1 });
  assert.equal(S.pending(db, APP).items.length, 0);
  assert.equal(db.tables.holds.length, 1, "the hold still blocks the van after the ack");

  publish(db, { bookings: [{ id: "bk-102", clientToken: "TOKEN-ALEX-0000000000000001", status: "held", date: "2026-12-19", startTime: "09:00",
    endTime: "12:00", people: 20, hours: 3, address: "3 Lake Road", total: 619, outOfHoursFee: 0, requestId: "req-p1" }] });
  assert.equal(db.tables.holds.length, 0, "a publish that lists the request removes its hold");
});

test("prices are refused until Coffee Van has published them, then served with the as-of time", () => {
  const db = makeDb();
  assert.deepEqual(S.prices(db), { ok: false, error: "not-published" });
  publish(db, { prices: { quotes: { 20: { 3: 619 } }, packs: {}, fees: { "06:00": { 3: 35 } } } });
  const p = S.prices(db);
  assert.equal(p.ok, true);
  assert.equal(p.quotes["20"]["3"], 619);
  assert.equal(p.asOf, FRESH);
});

test("health reports the contract version, the as-of time and the stale threshold", () => {
  const db = makeDb();
  publish(db);
  const h = S.health(db, NOW);
  assert.equal(h.ok, true);
  assert.equal(h.contractVersion, 1);
  assert.equal(h.staleAfterHours, 6);
  assert.equal(h.asOf, FRESH);
});

test("the session carries the quote Coffee Van published for the client, and nothing for a client without one", () => {
  const db = makeDb();
  publish(db, { clients: [
    { token: "TOKEN-ALEX-0000000000000001", firstName: "Alex", referralCode: "K7M2-QXTP",
      quote: { date: "2026-12-12", startTime: "09:00", people: 20, hours: 3, address: "3 Lake Road", total: 619, fee: 0 } },
    { token: "TOKEN-SAM-00000000000000002", firstName: "Sam", referralCode: "H4BC-7WDR" },
  ] });
  assert.equal(S.session(db, "TOKEN-ALEX-0000000000000001", NOW).quote.total, 619);
  assert.equal(S.session(db, "TOKEN-SAM-00000000000000002", NOW).quote, null);
});

test("funnel events are stored for a known client, only for listed types, and refused otherwise", () => {
  const db = makeDb();
  publish(db);
  assert.deepEqual(S.event(db, { k: "TOKEN-ALEX-0000000000000001", type: "upgrade-shown", data: { price: 1832 } }, NOW), { ok: true });
  assert.equal(S.event(db, { k: "TOKEN-ALEX-0000000000000001", type: "made-up" }, NOW).error, "unknown-event");
  assert.equal(S.event(db, { k: "nobody", type: "view" }, NOW).error, "not-found");
  assert.equal(db.tables.events.length, 1);
  assert.equal(db.tables.events[0].type, "upgrade-shown");
});

test("the session carries only that client's referrals, by first name", () => {
  const db = makeDb();
  publish(db, { clients: [
    { token: "TOKEN-ALEX-0000000000000001", firstName: "Alex", referralCode: "K7M2-QXTP", referrals: [{ firstName: "Jo", status: "booked" }] },
    { token: "TOKEN-SAM-00000000000000002", firstName: "Sam", referralCode: "H4BC-7WDR", referrals: [{ firstName: "Pat", status: "completed" }] },
  ] });
  const alex = S.session(db, "TOKEN-ALEX-0000000000000001", NOW);
  assert.deepEqual(alex.referrals, [{ firstName: "Jo", status: "booked" }]);
  assert.equal(JSON.stringify(alex).includes("Pat"), false);
});

test("referrals keep a first name and a status and nothing else; any other status is dropped", () => {
  const db = makeDb();
  publish(db, { clients: [{ token: "TOKEN-ALEX-0000000000000001", firstName: "Alex", referralCode: "K7M2-QXTP", referrals: [
    { firstName: "Jo", status: "completed", email: "jo@example.com", surname: "Lee" },
    { firstName: "Ghost", status: "weird" },
    { firstName: "x".repeat(60), status: "booked" },
  ] }] });
  const view = S.session(db, "TOKEN-ALEX-0000000000000001", NOW);
  assert.deepEqual(view.referrals[0], { firstName: "Jo", status: "completed" });
  assert.equal(view.referrals.length, 2);
  assert.equal(view.referrals[1].firstName.length, 40);
  assert.equal(JSON.stringify(view).includes("jo@example.com"), false);
});

test("a client with no referrals gets an empty list", () => {
  const db = makeDb();
  publish(db);
  assert.deepEqual(S.session(db, "TOKEN-ALEX-0000000000000001", NOW).referrals, []);
});

test("a held date shows in the session at once as the client's own held booking, with the price they were shown", () => {
  const db = makeDb();
  publish(db);
  const held = S.request(db, Object.assign(hold("TOKEN-ALEX-0000000000000001", "req-v1", "2026-12-19", "09:00"), { shownTotal: 654, shownFee: 35 }), NOW);
  assert.equal(held.outcome, "held");
  const mine = S.session(db, "TOKEN-ALEX-0000000000000001", NOW).bookings.filter((b) => b.id === "hold-req-v1");
  assert.equal(mine.length, 1);
  assert.deepEqual({ status: mine[0].status, date: mine[0].date, startTime: mine[0].startTime, total: mine[0].total, fee: mine[0].outOfHoursFee },
    { status: "held", date: "2026-12-19", startTime: "09:00", total: 619, fee: 35 });
});

test("another client's hold never appears in this client's session", () => {
  const db = makeDb();
  publish(db);
  S.request(db, hold("TOKEN-SAM-00000000000000002", "req-v2", "2026-12-19", "09:00"), NOW);
  assert.equal(S.session(db, "TOKEN-ALEX-0000000000000001", NOW).bookings.some((b) => b.id === "hold-req-v2"), false);
});

test("a hold that is only asked of Sam is shown as pending, not as a booking", () => {
  const db = makeDb();
  publish(db);
  const asked = S.request(db, hold("TOKEN-ALEX-0000000000000001", "req-v3", "2026-12-05", "10:00"), NOW); // overlaps the published booking
  assert.equal(asked.outcome, "requested");
  const view = S.session(db, "TOKEN-ALEX-0000000000000001", NOW);
  assert.equal(view.bookings.some((b) => b.id === "hold-req-v3"), false);
  assert.equal(view.pending.some((p) => p.id === "req-v3"), true);
});

test("an applied change shows its new time on the booking until Coffee Van publishes it", () => {
  const db = makeDb();
  publish(db);
  const change = { k: "TOKEN-ALEX-0000000000000001", kind: "change", requestId: "req-v4", bookingId: "bk-101",
    date: "2026-12-05", startTime: "10:00", people: 20, hours: 3, address: "1 Main Street, Forster" };
  assert.equal(S.request(db, change, NOW).outcome, "applied");
  const booking = S.session(db, "TOKEN-ALEX-0000000000000001", NOW).bookings.filter((b) => b.id === "bk-101");
  assert.equal(booking.length, 1);
  assert.equal(booking[0].startTime, "10:00");
  assert.equal(booking[0].endTime, "13:00");
});


// ---- Free times, hold clean-up and store errors (client feedback, 14 Nov 2026) ----
const ALEX = "TOKEN-ALEX-0000000000000001";
const SAM = "TOKEN-SAM-00000000000000002";
const TIMES = [];
for (let m = 6 * 60; m <= 18 * 60; m += 30) TIMES.push(String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"));

test("availability lists the start times a hold would be given, and the notice rule starts tomorrow morning", () => {
  const db = makeDb();
  publish(db);
  const res = S.availability(db, { k: ALEX, hours: 3 }, NOW);
  assert.equal(res.ok, true);
  assert.equal(res.stale, false);
  assert.deepEqual(res.window, { from: "2026-12-01", through: "2027-01-29" });
  // Booked 09:00 to 12:00 on 5 Dec, with an hour either side for the van, and trading closes at 16:00: one start remains.
  assert.deepEqual(res.days["2026-12-05"], ["13:00"]);
  // A free day offers every start whose 3 hours end by 16:00: 07:00 to 13:00.
  assert.equal(res.days["2026-12-06"].length, 13);
  assert.equal(res.days["2026-12-06"][0], "07:00");
  assert.equal(res.days["2026-12-06"][12], "13:00");
  // 7 am on 1 Dec is "now": a start tomorrow at 06:00 is 23 hours away, so the first free start is 07:00.
  assert.equal(res.days["2026-12-02"][0], "07:00");
  assert.equal(res.days["2026-12-01"], undefined, "today is inside 24 hours");
});

test("a time the store lists as free is held when the client asks for it, and a time it leaves out is not", () => {
  for (const hours of [2, 6]) {
    for (const date of ["2026-12-02", "2026-12-05", "2026-12-06"]) {
      const listed = S.availability((() => { const d = makeDb(); publish(d); return d; })(), { k: ALEX, hours }, NOW).days[date] || [];
      for (const time of TIMES) {
        const db = makeDb();
        publish(db);
        const outcome = S.request(db, Object.assign(hold(SAM, "probe", date, time), { hours }), NOW).outcome;
        assert.equal(outcome === "held", listed.indexOf(time) >= 0, `${date} ${time} for ${hours}h: listed=${listed.indexOf(time) >= 0}, outcome=${outcome}`);
      }
    }
  }
});

test("availability claims nothing is free when the published availability is stale", () => {
  const db = makeDb();
  publish(db);
  const res = S.availability(db, { k: ALEX, hours: 3 }, "2026-12-02T09:00:00+11:00"); // 27 hours after it was published
  assert.equal(res.ok, true);
  assert.equal(res.stale, true);
  assert.deepEqual(res.days, {});
});

test("availability counts holds still waiting for Coffee Van, so a slot another client just took is not offered", () => {
  const db = makeDb();
  publish(db);
  assert.equal(S.availability(db, { k: ALEX, hours: 3 }, NOW).days["2026-12-19"].indexOf("09:00") >= 0, true);
  S.request(db, hold(SAM, "req-taken", "2026-12-19", "09:00"), NOW);
  const after = S.availability(db, { k: ALEX, hours: 3 }, NOW).days["2026-12-19"];
  assert.equal(after.indexOf("09:00"), -1);
  assert.equal(after.indexOf("10:00"), -1);
  assert.equal(after.indexOf("13:00") >= 0, true);
});

test("availability for a change leaves the client's own booking out, and nobody else's", () => {
  const db = makeDb();
  publish(db);
  const own = S.availability(db, { k: ALEX, hours: 3, bookingId: "bk-101" }, NOW).days["2026-12-05"];
  assert.equal(own.length, 13, "with her own booking out of the way the whole trading day is free");
  const other = S.availability(db, { k: SAM, hours: 3, bookingId: "bk-101" }, NOW).days["2026-12-05"];
  assert.equal(other.length, 1, "another client's booking id changes nothing for them");
});

test("availability needs a client token and sensible hours", () => {
  const db = makeDb();
  publish(db);
  assert.deepEqual(S.availability(db, { k: "nope", hours: 3 }, NOW), { ok: false, error: "not-found" });
  assert.deepEqual(S.availability(db, { k: ALEX, hours: 7 }, NOW), { ok: false, error: "bad-hours" });
  assert.deepEqual(S.availability(db, { k: ALEX }, NOW), { ok: false, error: "bad-hours" });
});

test("availability is quick enough for a phone to wait on: 60 days answers well inside a second", () => {
  const db = makeDb();
  publish(db);
  const started = Date.now();
  S.availability(db, { k: ALEX, hours: 6 }, NOW);
  assert.ok(Date.now() - started < 1000, "took " + (Date.now() - started) + " ms");
});

test("an acknowledged hold is dropped by the next publish even when Coffee Van did not book it, so the slot is free again", () => {
  const db = makeDb();
  publish(db);
  assert.equal(S.request(db, hold(ALEX, "req-h1", "2026-12-19", "09:00"), NOW).outcome, "held");
  assert.equal(S.request(db, hold(SAM, "req-h2", "2026-12-19", "09:00"), NOW).outcome, "requested", "blocked while the hold waits");
  S.ack(db, APP, ["req-h1"]);
  assert.equal(db.tables.holds.length, 1, "the ack alone opens no gap");
  publish(db); // Coffee Van's next publish: it did not make a booking of req-h1
  assert.equal(db.tables.holds.length, 0);
  assert.equal(S.request(db, hold(SAM, "req-h3", "2026-12-19", "09:00"), NOW).outcome, "held", "the slot is free");
});

test("a hold nobody has acknowledged survives a publish that does not list it", () => {
  const db = makeDb();
  publish(db);
  S.request(db, hold(ALEX, "req-h4", "2026-12-19", "09:00"), NOW);
  publish(db);
  assert.equal(db.tables.holds.length, 1);
});

test("a change the store applied and Coffee Van refused goes back to the original time, and the new slot is free", () => {
  const db = makeDb();
  publish(db);
  const change = { k: ALEX, kind: "change", requestId: "req-c1", bookingId: "bk-101", date: "2026-12-19", startTime: "09:00", people: 20, hours: 3, address: "1 Main Street, Forster" };
  assert.equal(S.request(db, change, NOW).outcome, "applied");
  assert.equal(S.session(db, ALEX, NOW).bookings.filter((b) => b.id === "bk-101")[0].date, "2026-12-19");
  S.ack(db, APP, ["req-c1"]);
  publish(db); // the booking is still on 5 Dec in Coffee Van's data
  const view = S.session(db, ALEX, NOW).bookings.filter((b) => b.id === "bk-101")[0];
  assert.equal(view.date, "2026-12-05");
  assert.equal(S.request(db, hold(SAM, "req-c2", "2026-12-19", "09:00"), NOW).outcome, "held");
});

test("a publish drops holds whose date has passed", () => {
  const db = makeDb();
  publish(db);
  db.tables.holds.push({ requestId: "old", id: "hold-old", clientToken: ALEX, date: "2026-11-20", startTime: "09:00", endTime: "12:00", people: 20, hours: 3, address: "", total: 0, outOfHoursFee: 0, createdAt: "2026-11-10T00:00:00Z" });
  publish(db);
  assert.equal(db.tables.holds.length, 0);
});

test("a store error is mailed to its owner at most once an hour, and the mail carries no client data", () => {
  const first = S.failureAlert("", "request", "Exception: Lock timeout", NOW);
  assert.equal(first.send, true);
  assert.match(first.subject, /Wander Customer Portal/);
  assert.match(first.body, /request/);
  assert.match(first.body, /Lock timeout/);
  assert.equal(first.lastAlertAt, NOW);
  const soon = S.failureAlert(first.lastAlertAt, "session", "Exception: again", "2026-12-01T07:30:00+11:00");
  assert.equal(soon.send, false);
  assert.equal(soon.lastAlertAt, first.lastAlertAt);
  const later = S.failureAlert(first.lastAlertAt, "session", "Exception: again", "2026-12-01T08:01:00+11:00");
  assert.equal(later.send, true);
  const long = S.failureAlert("", "request", "x".repeat(2000), NOW);
  assert.ok(long.body.length < 1000);
});

test("a time the store lists free for a change is applied when the client asks, and a time it leaves out is requested", () => {
  for (const date of ["2026-12-02", "2026-12-05", "2026-12-06"]) {
    const base = makeDb();
    publish(base);
    const listed = S.availability(base, { k: ALEX, hours: 3, bookingId: "bk-101" }, NOW).days[date] || [];
    for (const time of TIMES) {
      const db = makeDb();
      publish(db);
      const change = { k: ALEX, kind: "change", requestId: "probe", bookingId: "bk-101", date, startTime: time, people: 20, hours: 3, address: "1 Main Street, Forster" };
      const outcome = S.request(db, change, NOW).outcome;
      assert.equal(outcome === "applied", listed.indexOf(time) >= 0, `${date} ${time}: listed=${listed.indexOf(time) >= 0}, outcome=${outcome}`);
    }
  }
});

test("a hold outside the trading hours is asked of Sam and says why, and nothing outside the hours is ever listed free", () => {
  const db = makeDb();
  publish(db);
  const late = S.request(db, hold(ALEX, "req-late", "2026-12-12", "14:00"), NOW); // 14:00 to 17:00
  assert.equal(late.outcome, "requested");
  const queued = db.tables.queue.filter((q) => q.id === "req-late")[0];
  assert.deepEqual(JSON.parse(queued.payload).request.reasons, ["outside our usual hours (7 am to 4 pm)"]);
  const days = S.availability(db, { k: ALEX, hours: 3 }, NOW).days;
  Object.keys(days).forEach((d) => days[d].forEach((t) => {
    assert.ok(t >= "07:00" && t <= "13:00", d + " " + t + " is outside the trading hours for a 3 hour morning");
  }));
});

test("the credits Coffee Van applied to a booking, the amount due and the referral offer reach the client's session", () => {
  const db = makeDb();
  const reward = { referrerPercent: 10, friendPercent: 10, captainEvery: 3, captainFreeHours: 2 };
  publish(db, {
    reward,
    bookings: [{ id: "bk-101", clientToken: ALEX, status: "confirmed", date: "2026-12-05", startTime: "09:00", endTime: "12:00", people: 20, hours: 3,
      address: "1 Main Street, Forster", total: 619, outOfHoursFee: 0, requestId: "", discount: 62, amountDue: 557, bonusHours: 2,
      creditsApplied: ["10% off your first morning", "2 free hours (Team Captain)"] }],
  });
  const view = S.session(db, ALEX, NOW);
  assert.deepEqual(view.reward, reward);
  const b = view.bookings[0];
  assert.deepEqual({ discount: b.discount, amountDue: b.amountDue, bonusHours: b.bonusHours, creditsApplied: b.creditsApplied },
    { discount: 62, amountDue: 557, bonusHours: 2, creditsApplied: ["10% off your first morning", "2 free hours (Team Captain)"] });
});

test("a booking with no credits owes its price, and the offer is null before the first publish that carries it", () => {
  const db = makeDb();
  publish(db);
  const view = S.session(db, ALEX, NOW);
  assert.equal(view.reward, null);
  const b = view.bookings[0];
  assert.deepEqual({ discount: b.discount, amountDue: b.amountDue, bonusHours: b.bonusHours, creditsApplied: b.creditsApplied },
    { discount: 0, amountDue: 619, bonusHours: 0, creditsApplied: [] });
});

test("a held date shows at once with its price as the amount due and no credit yet", () => {
  const db = makeDb();
  publish(db);
  S.request(db, Object.assign(hold(ALEX, "req-due", "2026-12-19", "09:00"), { shownTotal: 654, shownFee: 35 }), NOW);
  const b = S.session(db, ALEX, NOW).bookings.filter((x) => x.id === "hold-req-due")[0];
  assert.deepEqual({ discount: b.discount, amountDue: b.amountDue, creditsApplied: b.creditsApplied }, { discount: 0, amountDue: 654, creditsApplied: [] });
});

test("a published credit keeps its kind, so a friend's gift and a captain reward reach the page", () => {
  const db = makeDb();
  publish(db, { credits: [
    { clientToken: ALEX, kind: "friend", label: "10% off your first morning", expiresAt: "2027-11-13" },
    { clientToken: ALEX, kind: "captain", label: "2 free hours on your next booking", expiresAt: "2027-11-13" },
    { clientToken: ALEX, kind: "bogus", label: "x", expiresAt: "2027-11-13" },
  ] });
  const kinds = S.session(db, ALEX, NOW).credits.map((c) => c.kind);
  assert.deepEqual(kinds, ["friend", "captain"]);
});

// ---- The funnel Sam looks at ----
test("the funnel counts what clients did on the page in the last days, by type and by screen, and identifies nobody", () => {
  const db = makeDb();
  publish(db);
  const at = (day) => `2026-11-${day}T01:00:00.000Z`;
  const add = (time, type, data) => db.tables.events.push({ time, type, data: JSON.stringify(data || {}) });
  add(at("20"), "view", { v: "held" }); add(at("20"), "view", { v: "held" }); add(at("21"), "view", { v: "pick" });
  add(at("20"), "cta", { v: "held" }); add(at("21"), "cta", { v: "hold" });
  add(at("20"), "booked", { outcome: "held" }); add(at("20"), "upgrade-shown", {}); add(at("20"), "upgrade-declined", {});
  add("2026-09-01T01:00:00.000Z", "view", { v: "held" }); // far too old
  const res = S.funnel(db, APP, "2026-12-01T07:00:00+11:00", 30);
  assert.equal(res.ok, true);
  assert.equal(res.days, 30);
  assert.equal(res.since, "2026-11-02"); // 30 days including today
  assert.equal(res.events, 8);
  assert.deepEqual(res.totals, { view: 3, cta: 2, "upgrade-shown": 1, "upgrade-accepted": 0, "upgrade-declined": 1, booked: 1, calendar: 0, "referral-shared": 0 });
  assert.deepEqual(res.views, { held: 2, pick: 1 });
  assert.deepEqual(res.ctas, { held: 1, hold: 1 });
  assert.equal(JSON.stringify(res).includes("TOKEN"), false);
});

test("the funnel is for the app token only, takes 1 to 90 days, and an empty store answers zeros", () => {
  const db = makeDb();
  publish(db);
  assert.deepEqual(S.funnel(db, "wrong", NOW, 30), { ok: false, error: "not-allowed" });
  assert.deepEqual(S.funnel(db, ALEX, NOW, 30), { ok: false, error: "not-allowed" }, "a client's token is not the app token");
  assert.equal(S.funnel(db, APP, NOW, 0).days, 30, "a bad length falls back to the default");
  assert.equal(S.funnel(db, APP, NOW, 500).days, 90);
  const empty = S.funnel(db, APP, NOW, 7);
  assert.equal(empty.events, 0);
  assert.equal(empty.totals.view, 0);
  assert.deepEqual(empty.views, {});
});
