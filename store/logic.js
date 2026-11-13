// The dashboard store's logic (docs/contract.md, version 1). Pure: every read and write goes through `db`, so the same code
// runs in Apps Script (store/Adapter.gs, Google Sheets) and in Node tests and the local mock server (in-memory db).
//
// db = {
//   read(table) -> rows (objects keyed by the table's headers),
//   write(table, rows)           replaces the table,
//   append(table, row),
//   lock(fn) -> fn()             runs fn with the store's lock held (one writer at a time),
//   env(name) -> string          the APP_TOKEN and any other settings,
// }
// Needs WanderRules (rules.js) loaded first.
var StoreLogic = (function () {
  var CONTRACT_VERSION = 1;
  var CATERING_HOURS = [2, 3, 4, 5, 6];
  var MAX_PEOPLE = 200;
  var PEOPLE_STEP_MIN = 1;

  var TABLES = {
    clients: ["token", "firstName", "referralCode", "quote", "referrals"],
    events: ["time", "type", "data"],
    bookings: ["id", "clientToken", "status", "date", "startTime", "endTime", "people", "hours", "address", "total", "outOfHoursFee", "requestId"],
    busy: ["date", "startTime", "endTime"],
    holds: ["requestId", "id", "clientToken", "date", "startTime", "endTime", "people", "hours", "address", "total", "outOfHoursFee", "createdAt"],
    queue: ["id", "kind", "receivedAt", "clientToken", "payload", "acked"],
    credits: ["clientToken", "kind", "label", "expiresAt"],
    meta: ["key", "value"],
  };

  function clean(value, max) {
    return String(value == null ? "" : value).replace(/[\r\n\t]+/g, " ").trim().slice(0, max);
  }

  function isDate(v) { return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v); }
  function isTime(v) { return typeof v === "string" && /^\d{2}:\d{2}$/.test(v); }

  function endTimeFor(startTime, hours) {
    var m = /^(\d{2}):(\d{2})$/.exec(startTime);
    if (!m) return "";
    var mins = Number(m[1]) * 60 + Number(m[2]) + Math.round(Number(hours) * 60);
    if (mins >= 24 * 60) return "";
    var pad = function (n) { return (n < 10 ? "0" : "") + n; };
    return pad(Math.floor(mins / 60)) + ":" + pad(mins % 60);
  }

  // A request's fields, checked. Returns { value } or { error }.
  function readRequest(body) {
    var people = Number(body.people);
    var hours = Number(body.hours);
    var shownTotal = body.shownTotal === undefined || body.shownTotal === null || body.shownTotal === "" ? null : Number(body.shownTotal);
    var shownFee = body.shownFee === undefined || body.shownFee === null || body.shownFee === "" ? null : Number(body.shownFee);
    var out = {
      shownTotal: shownTotal,
      shownFee: shownFee,
      requestId: clean(body.requestId, 80),
      date: clean(body.date, 10),
      startTime: clean(body.startTime, 5),
      people: people,
      hours: hours,
      address: clean(body.address, 200),
      travelKm: Number(body.travelKm || 0),
    };
    if (!out.requestId) return { error: "no-request-id" };
    if (!isDate(out.date) || !isTime(out.startTime)) return { error: "bad-date-or-time" };
    if (!(Math.floor(people) === people && people >= PEOPLE_STEP_MIN && people <= MAX_PEOPLE)) return { error: "bad-people" };
    if (CATERING_HOURS.indexOf(hours) < 0) return { error: "bad-hours" };
    return { value: out };
  }

  // Referrals are shown to the referrer by first name and a status, nothing else.
  function cleanReferrals(list) {
    if (!Array.isArray(list)) return [];
    var out = [];
    list.forEach(function (r) {
      if (!r || (r.status !== "booked" && r.status !== "completed")) return;
      out.push({ firstName: clean(r.firstName, 40), status: r.status });
    });
    return out;
  }

  function metaValue(db, key) {
    var rows = db.read("meta");
    for (var i = 0; i < rows.length; i++) if (rows[i].key === key) return rows[i].value;
    return "";
  }

  function setMeta(db, key, value) {
    var rows = db.read("meta").filter(function (r) { return r.key !== key; });
    rows.push({ key: key, value: value });
    db.write("meta", rows);
  }

  function clientBy(db, token) {
    if (!token) return null;
    var rows = db.read("clients");
    for (var i = 0; i < rows.length; i++) if (rows[i].token === token) return rows[i];
    return null;
  }

  function appTokenOk(db, token) {
    var expected = db.env("APP_TOKEN") || "";
    return expected.length >= 16 && token === expected;
  }

  // Everything already on the van for a day: published busy times, and holds still waiting for Coffee Van.
  function busyOn(db, date) {
    var out = [];
    db.read("busy").forEach(function (b) { if (b.date === date) out.push({ date: b.date, startTime: b.startTime, endTime: b.endTime }); });
    db.read("holds").forEach(function (h) { if (h.date === date) out.push({ date: h.date, startTime: h.startTime, endTime: h.endTime }); });
    return out;
  }

  // The price the client was shown, without the out-of-hours fee. Coffee Van re-prices on import; this is what the page
  // shows until it publishes.
  function shownBase(fields) {
    return fields.shownTotal === null || fields.shownTotal === undefined ? 0 : Math.max(0, Number(fields.shownTotal) - Number(fields.shownFee || 0));
  }

  function copyFor(outcome, replyWithinHours, startTime) {
    if (outcome === "held") return "Held. We will confirm within " + replyWithinHours + " hours.";
    if (outcome === "applied") return "Done. Your morning now starts at " + startTime + ".";
    if (outcome === "cancel") return "We have your cancellation. We will confirm your credit within " + replyWithinHours + " hours.";
    if (outcome === "pack") return "Requested: we will confirm your first morning within " + replyWithinHours + " hours. Nothing is charged.";
    if (outcome === "call") return "Requested: we will ring you within " + replyWithinHours + " hours.";
    return "Requested: we will text you within " + replyWithinHours + " hours to confirm this.";
  }

  function health(db, now) {
    return {
      ok: true,
      contractVersion: CONTRACT_VERSION,
      asOf: metaValue(db, "asOf"),
      staleAfterHours: WanderRules.STALE_AFTER_HOURS,
      checkedAt: now,
    };
  }

  // Coffee Van publishes its state. The snapshot replaces clients, bookings, busy times and credits, and drops any hold
  // whose request now appears as a booking. It is safe to send again.
  function publish(db, appToken, snapshot, now) {
    if (!appTokenOk(db, appToken)) return { ok: false, error: "not-allowed" };
    if (!snapshot || typeof snapshot !== "object" || !isDate(String(snapshot.asOf || "").slice(0, 10))) return { ok: false, error: "bad-snapshot" };
    return db.lock(function () {
      var clients = (snapshot.clients || []).filter(function (c) { return clean(c.token, 200) !== ""; }).map(function (c) {
        return {
          token: clean(c.token, 200), firstName: clean(c.firstName, 40), referralCode: clean(c.referralCode, 12),
          quote: c.quote ? JSON.stringify(c.quote) : "",
          referrals: JSON.stringify(cleanReferrals(c.referrals)),
        };
      });
      var bookings = (snapshot.bookings || []).map(function (b) {
        return {
          id: clean(b.id, 80), clientToken: clean(b.clientToken, 200), status: clean(b.status, 20), date: clean(b.date, 10),
          startTime: clean(b.startTime, 5), endTime: clean(b.endTime, 5), people: Number(b.people), hours: Number(b.hours),
          address: clean(b.address, 200), total: Number(b.total || 0), outOfHoursFee: Number(b.outOfHoursFee || 0),
          requestId: clean(b.requestId, 80),
        };
      });
      var busy = (snapshot.busy || []).map(function (b) { return { date: clean(b.date, 10), startTime: clean(b.startTime, 5), endTime: clean(b.endTime, 5) }; });
      var credits = (snapshot.credits || []).map(function (c) {
        return { clientToken: clean(c.clientToken, 200), kind: clean(c.kind, 12), label: clean(c.label, 80), expiresAt: clean(c.expiresAt, 10) };
      });
      var published = {};
      bookings.forEach(function (b) { if (b.requestId) published[b.requestId] = true; });
      db.write("clients", clients);
      db.write("bookings", bookings);
      db.write("busy", busy);
      db.write("credits", credits);
      db.write("holds", db.read("holds").filter(function (h) { return !published[h.requestId]; }));
      setMeta(db, "asOf", clean(snapshot.asOf, 40));
      setMeta(db, "publishedAt", now);
      if (snapshot.prices) setMeta(db, "prices", JSON.stringify(snapshot.prices));
      return { ok: true, clients: clients.length, bookings: bookings.length, busy: busy.length };
    });
  }

  function pending(db, appToken) {
    if (!appTokenOk(db, appToken)) return { ok: false, error: "not-allowed" };
    var items = db.read("queue").filter(function (q) { return String(q.acked) !== "yes"; }).map(function (q) {
      var fields = {};
      try { fields = JSON.parse(q.payload || "{}").request || {}; } catch (e) { fields = {}; }
      var item = { id: q.id, kind: q.kind, receivedAt: q.receivedAt, clientToken: q.clientToken };
      Object.keys(fields).forEach(function (k) { item[k] = fields[k]; });
      return item;
    });
    return { ok: true, items: items };
  }

  function ack(db, appToken, ids) {
    if (!appTokenOk(db, appToken)) return { ok: false, error: "not-allowed" };
    var want = {};
    (ids || []).forEach(function (id) { want[String(id)] = true; });
    return db.lock(function () {
      var n = 0;
      var rows = db.read("queue").map(function (q) {
        if (want[q.id] && String(q.acked) !== "yes") { n += 1; return Object.assign({}, q, { acked: "yes" }); }
        return q;
      });
      db.write("queue", rows);
      return { ok: true, acked: n };
    });
  }

  function prices(db) {
    var raw = metaValue(db, "prices");
    if (!raw) return { ok: false, error: "not-published" };
    var out = JSON.parse(raw);
    out.ok = true;
    out.asOf = metaValue(db, "asOf");
    return out;
  }

  function session(db, token, now) {
    var client = clientBy(db, token);
    if (!client) return { ok: false, error: "not-found" };
    var asOf = metaValue(db, "asOf");
    var quote = null;
    try { quote = client.quote ? JSON.parse(client.quote) : null; } catch (e) { quote = null; }
    var referrals = [];
    try { referrals = client.referrals ? cleanReferrals(JSON.parse(client.referrals)) : []; } catch (e) { referrals = []; }
    var bookings = db.read("bookings").filter(function (b) { return b.clientToken === token; }).map(function (b) {
      return {
        id: b.id, status: b.status, date: b.date, startTime: b.startTime, endTime: b.endTime, people: b.people, hours: b.hours,
        address: b.address, total: b.total, outOfHoursFee: b.outOfHoursFee,
      };
    });
    // A date this client has just held, or a change just applied, shows at once; Coffee Van's next publish replaces it.
    db.read("holds").filter(function (h) { return h.clientToken === token; }).forEach(function (h) {
      var at = -1;
      for (var i = 0; i < bookings.length; i++) if (bookings[i].id === h.id) at = i;
      var moved = { date: h.date, startTime: h.startTime, endTime: h.endTime, people: Number(h.people), hours: Number(h.hours), address: h.address };
      if (at >= 0) bookings[at] = Object.assign({}, bookings[at], moved);
      else bookings.push(Object.assign({ id: h.id, status: "held", total: Number(h.total || 0), outOfHoursFee: Number(h.outOfHoursFee || 0) }, moved));
    });
    var pendingItems = db.read("queue").filter(function (q) { return q.clientToken === token && String(q.acked) !== "yes"; }).map(function (q) {
      return { id: q.id, kind: q.kind, replyWithinHours: 24 };
    });
    var credits = db.read("credits").filter(function (c) { return c.clientToken === token; }).map(function (c) {
      return { kind: c.kind, label: c.label, expiresAt: c.expiresAt };
    });
    return {
      ok: true,
      contractVersion: CONTRACT_VERSION,
      asOf: asOf,
      stale: WanderRules.isStale(asOf, now),
      client: { firstName: client.firstName, referralCode: client.referralCode },
      quote: quote,
      referrals: referrals,
      bookings: bookings,
      pending: pendingItems,
      credits: credits,
      pack: null,
    };
  }

  // One client request. Every path returns a response the page can show; nothing is an error screen.
  function request(db, body, now) {
    var client = clientBy(db, body && body.k);
    if (!client) return { ok: false, error: "not-found" };
    var kind = clean(body.kind, 12);
    var requestId = clean(body.requestId, 80);
    if (!requestId) return { ok: false, error: "no-request-id" };

    return db.lock(function () {
      var previous = db.read("queue").filter(function (q) { return q.id === requestId && q.clientToken === client.token; })[0];
      if (previous) {
        var stored = JSON.parse(previous.payload || "{}").response;
        if (stored) return stored;
      }
      var asOf = metaValue(db, "asOf");
      var response;
      var fields;

      if (kind === "hold" || kind === "change" || kind === "pack") {
        var parsed = readRequest(body);
        if (parsed.error) return { ok: false, error: parsed.error };
        fields = parsed.value;
        if (kind === "change") fields.bookingId = clean(body.bookingId, 80);
      } else if (kind === "cancel") {
        fields = { bookingId: clean(body.bookingId, 80) };
      } else if (kind === "call") {
        fields = { when: clean(body.when, 80), note: clean(body.note, 300) };
      } else {
        return { ok: false, error: "unknown-kind" };
      }

      if (kind === "hold") {
        var others = busyOn(db, fields.date);
        var held = WanderRules.decideHold({ date: fields.date, startTime: fields.startTime, hours: fields.hours, travelKm: fields.travelKm }, others, asOf, now);
        var reply = WanderRules.replyWithinHours(now, fields.date, fields.startTime);
        var outcome = held.decision;
        response = { ok: true, outcome: outcome, replyWithinHours: reply, message: copyFor(outcome === "held" ? "held" : "requested", reply) };
        if (outcome === "held") {
          var holdId = "hold-" + requestId;
          db.append("holds", {
            requestId: requestId, id: holdId, clientToken: client.token, date: fields.date, startTime: fields.startTime,
            endTime: endTimeFor(fields.startTime, fields.hours), people: fields.people, hours: fields.hours,
            address: fields.address, total: shownBase(fields), outOfHoursFee: Number(fields.shownFee || 0), createdAt: now,
          });
          response.bookingId = holdId;
        }
        fields.decision = held.decision;
        fields.reasons = held.reasons;
      } else if (kind === "change") {
        var booking = db.read("bookings").filter(function (b) { return b.id === fields.bookingId && b.clientToken === client.token; })[0];
        if (!booking) return { ok: false, error: "not-found" };
        var others2 = busyOn(db, fields.date).filter(function (b) {
          return !(b.date === booking.date && b.startTime === booking.startTime);
        });
        var change = WanderRules.decideChange(booking, { date: fields.date, startTime: fields.startTime, hours: fields.hours, travelKm: fields.travelKm }, others2, asOf, now);
        var reply2 = WanderRules.replyWithinHours(now, fields.date, fields.startTime);
        response = change.decision === "applied"
          ? { ok: true, outcome: "applied", replyWithinHours: reply2, bookingId: booking.id, message: copyFor("applied", reply2, fields.startTime) }
          : { ok: true, outcome: "requested", replyWithinHours: reply2, bookingId: booking.id, message: copyFor("requested", reply2) };
        if (change.decision === "applied") {
          db.append("holds", {
            requestId: requestId, id: booking.id, clientToken: client.token, date: fields.date, startTime: fields.startTime,
            endTime: endTimeFor(fields.startTime, fields.hours), people: fields.people, hours: fields.hours,
            address: fields.address, total: shownBase(fields), outOfHoursFee: Number(fields.shownFee || 0), createdAt: now,
          });
        }
        fields.decision = change.decision;
        fields.reasons = change.reasons;
      } else if (kind === "cancel") {
        var target = db.read("bookings").filter(function (b) { return b.id === fields.bookingId && b.clientToken === client.token; })[0];
        if (!target) return { ok: false, error: "not-found" };
        var reply3 = WanderRules.replyWithinHours(now, target.date, target.startTime);
        response = { ok: true, outcome: "requested", replyWithinHours: reply3, bookingId: target.id, message: copyFor("cancel", reply3) };
        fields.decision = "requested";
      } else if (kind === "pack") {
        var reply4 = WanderRules.replyWithinHours(now, fields.date, fields.startTime);
        response = { ok: true, outcome: "requested", replyWithinHours: reply4, message: copyFor("pack", reply4) };
        fields.decision = "requested";
      } else {
        response = { ok: true, outcome: "requested", replyWithinHours: 24, message: copyFor("call", 24) };
        fields.decision = "requested";
      }

      db.append("queue", {
        id: requestId, kind: kind, receivedAt: now, clientToken: client.token,
        payload: JSON.stringify({ request: fields, response: response }), acked: "no",
      });
      return response;
    });
  }

  var EVENT_TYPES = ["view", "cta", "upgrade-shown", "upgrade-accepted", "upgrade-declined", "booked", "calendar", "referral-shared"];

  // Funnel events for Sam's conversion view. Nothing identifying is stored beyond the client token's presence.
  function event(db, body, now) {
    var client = clientBy(db, body && body.k);
    if (!client) return { ok: false, error: "not-found" };
    var type = clean(body.type, 24);
    if (EVENT_TYPES.indexOf(type) < 0) return { ok: false, error: "unknown-event" };
    var data = clean(JSON.stringify(body.data || {}), 200);
    db.append("events", { time: now, type: type, data: data });
    return { ok: true };
  }

  return {
    TABLES: TABLES, CONTRACT_VERSION: CONTRACT_VERSION, EVENT_TYPES: EVENT_TYPES,
    event: event,
    health: health, publish: publish, pending: pending, ack: ack, prices: prices, session: session, request: request,
    endTimeFor: endTimeFor, readRequest: readRequest,
  };
})();
if (typeof module === "object" && module.exports) module.exports = StoreLogic;
