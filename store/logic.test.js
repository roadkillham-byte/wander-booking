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

