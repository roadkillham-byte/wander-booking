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
  var CREDIT_KINDS = ["returning", "referral", "friend", "captain"];

  var TABLES = {
    clients: ["token", "firstName", "referralCode", "quote", "referrals", "club", "contract", "pack"],
    events: ["time", "type", "data"],
    bookings: ["id", "clientToken", "status", "date", "startTime", "endTime", "people", "hours", "address", "total", "outOfHoursFee", "requestId",
      "discount", "amountDue", "bonusHours", "creditsApplied", "payLink", "paid",
      // Added last so a sheet that already exists only gains columns at the end. JSON text: what the app offers and what is chosen.
      "extrasMenu", "extras"],
    busy: ["date", "startTime", "endTime"],
    holds: ["requestId", "id", "clientToken", "date", "startTime", "endTime", "people", "hours", "address", "total", "outOfHoursFee", "createdAt"],
    queue: ["id", "kind", "receivedAt", "clientToken", "payload", "acked"],
    credits: ["clientToken", "kind", "label", "expiresAt"],
    // A new client made by the booking page before Coffee Van knows them: their private key works from the first email.
    newclients: ["token", "firstName", "requestId", "createdAt"],
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
      suburb: clean(body.suburb, 40),
      // Worked out here from the suburb the client picked or the address they typed, never taken from the page.
      travelKm: WanderRules.travelKmFor(clean(body.suburb, 40), clean(body.address, 200)),
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

  // A pay link is a Square address over https and nothing else, so the page can never be made to send a client elsewhere.
  function payLinkOk(v) {
    var link = String(v || "");
    return link.length <= 200 && /^https:\/\/[A-Za-z0-9.-]*square(up)?\.(link|site|com)\/[^\s"'<>]*$/.test(link) ? link : "";
  }

  function money(v) {
    var n = Number(v);
    return Number.isFinite(n) && v !== "" && v !== null && v !== undefined ? n : null;
  }

  // The labels of the credits Coffee Van took for a booking, as a short list of plain words.
  function cleanLabels(list) {
    if (!Array.isArray(list)) return [];
    return list.slice(0, 5).map(function (x) { return clean(x, 80); }).filter(function (x) { return x !== ""; });
  }

  // An Office Club member's card for a month: numbers and a "YYYY-MM" month, nothing else. Anything malformed is no card.
  function cleanClub(c) {
    if (!c || typeof c !== "object" || !/^\d{4}-\d{2}$/.test(String(c.month))) return null;
    var used = money(c.used), perMonth = money(c.perMonth);
    if (used === null || perMonth === null || used < 0 || perMonth < 1) return null;
    return { month: String(c.month), used: used, perMonth: perMonth };
  }

  // A client's prepaid contract, as Coffee Van publishes it for their page: counts, dates and the next instalment only. Never a method
  // of payment, an account detail or anything about another client.
  var CONTRACT_STATUS = ["active", "cancelled", "complete"];
  function cleanContract(c) {
    if (!c || typeof c !== "object") return null;
    var months = Number(c.termMonths);
    if ([3, 6, 12].indexOf(months) < 0 || CONTRACT_STATUS.indexOf(c.status) < 0) return null;
    var mornings = money(c.mornings), used = money(c.used), freeHours = money(c.freeHours), freeUsed = money(c.freeHoursUsed);
    if (mornings === null || used === null || freeHours === null || freeUsed === null || mornings < 1 || used < 0 || used > mornings) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(c.startDate)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(c.endDate))) return null;
    var next = null;
    if (c.nextInstalment && /^\d{4}-\d{2}-\d{2}$/.test(String(c.nextInstalment.dueDate)) && money(c.nextInstalment.amount) !== null) {
      next = { dueDate: String(c.nextInstalment.dueDate), amount: money(c.nextInstalment.amount) };
    }
    return {
      termMonths: months, status: String(c.status), mornings: mornings, used: used, left: mornings - used,
      startDate: String(c.startDate), endDate: String(c.endDate),
      freeHours: freeHours, freeHoursUsed: freeUsed, freeHoursUnlocked: c.freeHoursUnlocked === true,
      pausedWeeks: money(c.pausedWeeks) || 0, nextInstalment: next,
    };
  }

  // A client's 4-Pack as Coffee Van publishes it (docs/4-pack-v2.md in the app repo): counts, dates, the standing morning and the saved
  // set-up. Anything malformed is dropped rather than shown. No payment detail is ever published.
  function cleanPack(p) {
    if (!p || typeof p !== "object") return null;
    var day = /^\d{4}-\d{2}-\d{2}$/;
    var mornings = money(p.mornings), delivered = money(p.delivered), booked = money(p.booked);
    if (mornings === null || mornings < 1 || delivered === null || booked === null || delivered < 0 || booked < 0) return null;
    if (!day.test(String(p.validUntil))) return null;
    var pausedDays = money(p.pausedDays) || 0;
    var standing = null;
    if (p.standing && typeof p.standing === "object" && Number(p.standing.weekday) >= 0 && Number(p.standing.weekday) <= 6 && /^\d{2}:\d{2}$/.test(String(p.standing.startTime))) {
      standing = { weekday: Number(p.standing.weekday), startTime: String(p.standing.startTime), hours: money(p.standing.hours) || 2, address: clean(p.standing.address, 160) };
    }
    var months = (Array.isArray(p.standingMonths) ? p.standingMonths : []).filter(function (m) {
      return m && /^\d{4}-\d{2}$/.test(String(m.month)) && day.test(String(m.date)) && ["proposed", "confirmed", "released"].indexOf(m.state) >= 0;
    }).slice(0, 12).map(function (m) { return { month: String(m.month), date: String(m.date), state: String(m.state) }; });
    var setup = null;
    if (p.setup && typeof p.setup === "object") {
      setup = { address: clean(p.setup.address, 160), people: money(p.setup.people) || 0, hours: money(p.setup.hours) || 0, startTime: /^\d{2}:\d{2}$/.test(String(p.setup.startTime)) ? String(p.setup.startTime) : "",
        askFor: clean(p.setup.askFor, 80), access: clean(p.setup.access, 200), orderNotes: clean(p.setup.orderNotes, 300) };
    }
    return { mornings: mornings, delivered: delivered, booked: booked, left: Math.max(0, mornings - delivered), toBook: Math.max(0, mornings - delivered - booked), used: delivered, validUntil: String(p.validUntil), expiresAt: String(p.validUntil),
      pausedDays: Math.min(42, pausedDays), standing: standing, standingMonths: months, setup: setup, invoiceNo: clean(p.invoiceNo, 24) };
  }

  // The referral offer in numbers, published by Coffee Van so the page's words follow what Coffee Van gives.
  function cleanReward(r) {
    if (!r || typeof r !== "object") return null;
    var out = {
      referrerPercent: money(r.referrerPercent), friendPercent: money(r.friendPercent),
      captainEvery: money(r.captainEvery), captainFreeHours: money(r.captainFreeHours),
    };
    for (var k in out) if (out[k] === null) return null;
    return out;
  }

  var EXTRA_CHANGES_PER_CLIENT_PER_DAY = 30;

  // What the app offers on a booking: a few rows of key, label, blurb and a real price. Anything else is dropped.
  function cleanMenu(list) {
    if (!Array.isArray(list)) return [];
    var out = [];
    list.slice(0, 5).forEach(function (m) {
      if (!m || typeof m !== "object") return;
      var key = clean(m.key, 40), price = money(m.price);
      if (key === "" || price === null || price < 0) return;
      out.push({ key: key, label: clean(m.label, 60) || key, blurb: clean(m.blurb, 200), price: price });
    });
    return out;
  }

  // The extras a booking has taken: key, label and what it costs.
  function cleanChosen(list) {
    if (!Array.isArray(list)) return [];
    var out = [];
    list.slice(0, 5).forEach(function (m) {
      if (!m || typeof m !== "object") return;
      var key = clean(m.key, 40), price = money(m.price);
      if (key === "" || price === null || price < 0) return;
      out.push({ key: key, label: clean(m.label, 60) || key, price: price });
    });
    return out;
  }

  function parseList(text, cleaner) {
    try { return text ? cleaner(JSON.parse(text)) : []; } catch (e) { return []; }
  }

  function cents(n) { return Math.round(n * 100) / 100; }

  // Add or remove one extra on a booking's lists and amount. The price comes from the booking's own menu (what the app published),
  // never from the request. Returns the new state, or null when nothing changes.
  function changeExtras(menu, chosen, amountDue, op, key) {
    var have = null, offered = null, i;
    for (i = 0; i < chosen.length; i++) if (chosen[i].key === key) have = chosen[i];
    for (i = 0; i < menu.length; i++) if (menu[i].key === key) offered = menu[i];
    if (op === "add") {
      if (have || !offered) return null;
      return { chosen: chosen.concat([{ key: offered.key, label: offered.label, price: offered.price }]), amountDue: cents(amountDue + offered.price) };
    }
    if (!have) return null;
    return { chosen: chosen.filter(function (c) { return c.key !== key; }), amountDue: cents(Math.max(0, amountDue - have.price)) };
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
    var fresh = db.read("newclients");
    for (var j = 0; j < fresh.length; j++) {
      if (fresh[j].token === token) return { token: fresh[j].token, firstName: fresh[j].firstName, referralCode: "", quote: "", referrals: "[]", club: "", contract: "", pack: "" };
    }
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

  var ENQUIRIES = ["contract-3", "contract-6", "contract-12", "photographer"];

  function copyFor(outcome, replyWithinHours, startTime) {
    if (outcome === "held") return "Held. We will confirm within " + replyWithinHours + " hours.";
    if (outcome === "applied") return "Done. Your morning now starts at " + startTime + ".";
    if (outcome === "cancel") return "We have your cancellation. We will confirm your credit within " + replyWithinHours + " hours.";
    if (outcome === "pack") return "Requested: we will confirm your first morning within " + replyWithinHours + " hours. Nothing is charged.";
    if (outcome === "standing") return "We appreciate you! Your standing morning is kept, and we will confirm it with you shortly.";
    if (outcome === "pause") return "We appreciate you telling us! Your pause is noted and your valid-until date will move with it. We will confirm within " + replyWithinHours + " hours.";
    if (outcome === "enquiry") return "We appreciate you asking! We'll ring you within " + replyWithinHours + " hours. Nothing is charged.";
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

  // A spreadsheet cell holds at most 50,000 characters and the price table is larger, so it is stored in numbered pieces of
  // at most 40,000 and joined back in order when read. A later publish replaces every piece.
  var PRICE_PIECE_CHARS = 40000;
  function writePrices(db, prices) {
    var text = JSON.stringify(prices);
    var rows = db.read("meta").filter(function (r) { return String(r.key).indexOf("prices") !== 0; });
    for (var i = 0, n = 0; i < text.length; i += PRICE_PIECE_CHARS, n++) {
      rows.push({ key: "prices." + n, value: text.slice(i, i + PRICE_PIECE_CHARS) });
    }
    db.write("meta", rows);
  }

  function readPrices(db) {
    var pieces = db.read("meta").filter(function (r) { return String(r.key).indexOf("prices.") === 0; });
    if (pieces.length === 0) return metaValue(db, "prices");
    pieces.sort(function (a, b) { return Number(a.key.slice(7)) - Number(b.key.slice(7)); });
    return pieces.map(function (r) { return r.value; }).join("");
  }

  // Coffee Van publishes its state. The snapshot replaces clients, bookings, busy times and credits, and drops a hold when
  // its request now appears as a booking, when Coffee Van has acknowledged it (it was booked, which this snapshot lists, or
  // refused, which frees the slot), or when its date has passed. It is safe to send again.
  function publish(db, appToken, snapshot, now) {
    if (!appTokenOk(db, appToken)) return { ok: false, error: "not-allowed" };
    if (!snapshot || typeof snapshot !== "object" || !isDate(String(snapshot.asOf || "").slice(0, 10))) return { ok: false, error: "bad-snapshot" };
    return db.lock(function () {
      var clients = (snapshot.clients || []).filter(function (c) { return clean(c.token, 200) !== ""; }).map(function (c) {
        return {
          token: clean(c.token, 200), firstName: clean(c.firstName, 40), referralCode: clean(c.referralCode, 12),
          quote: c.quote ? JSON.stringify(c.quote) : "",
          referrals: JSON.stringify(cleanReferrals(c.referrals)),
          club: JSON.stringify(cleanClub(c.club)),
          contract: JSON.stringify(cleanContract(c.contract)),
          pack: JSON.stringify(cleanPack(c.pack)),
        };
      });
      var bookings = (snapshot.bookings || []).map(function (b) {
        var total = Number(b.total || 0), fee = Number(b.outOfHoursFee || 0), discount = Math.max(0, Number(b.discount || 0));
        var due = money(b.amountDue);
        return {
          id: clean(b.id, 80), clientToken: clean(b.clientToken, 200), status: clean(b.status, 20), date: clean(b.date, 10),
          startTime: clean(b.startTime, 5), endTime: clean(b.endTime, 5), people: Number(b.people), hours: Number(b.hours),
          address: clean(b.address, 200), total: total, outOfHoursFee: fee,
          requestId: clean(b.requestId, 80),
          discount: discount, amountDue: due === null ? Math.max(0, total + fee - discount) : due,
          bonusHours: Math.max(0, Number(b.bonusHours || 0)), creditsApplied: JSON.stringify(cleanLabels(b.creditsApplied)),
          payLink: payLinkOk(b.payLink), paid: b.paid === true ? "yes" : "",
          extrasMenu: JSON.stringify(cleanMenu(b.extrasMenu)), extras: JSON.stringify(cleanChosen(b.extras)),
        };
      });
      var busy = (snapshot.busy || []).map(function (b) { return { date: clean(b.date, 10), startTime: clean(b.startTime, 5), endTime: clean(b.endTime, 5) }; });
      var credits = (snapshot.credits || []).filter(function (c) { return CREDIT_KINDS.indexOf(c.kind) >= 0; }).map(function (c) {
        return { clientToken: clean(c.clientToken, 200), kind: clean(c.kind, 12), label: clean(c.label, 80), expiresAt: clean(c.expiresAt, 10) };
      });
      var published = {};
      bookings.forEach(function (b) { if (b.requestId) published[b.requestId] = true; });
      db.write("clients", clients);
      db.write("bookings", bookings);
      db.write("busy", busy);
      db.write("credits", credits);
      // A provisional client stays until Coffee Van lists them (or two weeks pass), so their key never stops working in between.
      var listed = {};
      clients.forEach(function (c) { listed[c.token] = true; });
      var provisionalCutoff = Date.parse(now) - 14 * 24 * 60 * 60 * 1000;
      db.write("newclients", db.read("newclients").filter(function (p) { return !listed[p.token] && Date.parse(p.createdAt) >= provisionalCutoff; }));
      var acked = {};
      db.read("queue").forEach(function (q) { if (String(q.acked) === "yes") acked[q.id] = true; });
      var today = String(snapshot.asOf).slice(0, 10); // the UTC date is never later than the Sydney date: a hold is only dropped once its day is certainly past
      db.write("holds", db.read("holds").filter(function (h) { return !published[h.requestId] && !acked[h.requestId] && h.date >= today; }));
      setMeta(db, "reward", JSON.stringify(cleanReward(snapshot.reward)));
      setMeta(db, "asOf", clean(snapshot.asOf, 40));
      setMeta(db, "publishedAt", now);
      if (snapshot.prices) writePrices(db, snapshot.prices);
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
    var raw = readPrices(db);
    if (!raw) return { ok: false, error: "not-published" };
    var out = JSON.parse(raw);
    // The 4-Pack has no bonus time (Sam, 16 Nov 2026). Snapshots published before then still carry bonusHours and
    // bonusValue; keep only the price so no client page ever shows them.
    if (out.packs && typeof out.packs === "object") {
      Object.keys(out.packs).forEach(function (people) {
        var row = out.packs[people];
        if (!row || typeof row !== "object") return;
        Object.keys(row).forEach(function (hours) {
          var p = row[hours];
          if (p && typeof p === "object") row[hours] = { price: p.price };
        });
      });
    }
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
    var club = null;
    try { club = client.club ? cleanClub(JSON.parse(client.club)) : null; } catch (e) { club = null; }
    var pack = null;
    try { pack = client.pack ? cleanPack(JSON.parse(client.pack)) : null; } catch (e) { pack = null; }
    var contract = null;
    try { contract = client.contract ? cleanContract(JSON.parse(client.contract)) : null; } catch (e) { contract = null; }
    var bookings = db.read("bookings").filter(function (b) { return b.clientToken === token; }).map(function (b) {
      var applied = [];
      try { applied = b.creditsApplied ? cleanLabels(JSON.parse(b.creditsApplied)) : []; } catch (e) { applied = []; }
      var total = Number(b.total || 0), fee = Number(b.outOfHoursFee || 0), discount = Number(b.discount || 0);
      var due = money(b.amountDue);
      var out = {
        id: b.id, status: b.status, date: b.date, startTime: b.startTime, endTime: b.endTime, people: b.people, hours: b.hours,
        address: b.address, total: b.total, outOfHoursFee: b.outOfHoursFee,
        discount: discount, amountDue: due === null ? Math.max(0, total + fee - discount) : due,
        bonusHours: Number(b.bonusHours || 0), creditsApplied: applied,
        payLink: payLinkOk(b.payLink), paid: String(b.paid) === "yes",
        extras: parseList(b.extras, cleanChosen),
      };
      var menu = parseList(b.extrasMenu, cleanMenu);
      if (menu.length > 0) out.extrasMenu = menu;
      return out;
    });
    // Extras the client chose that the app has not read yet are shown as chosen even if the app published in between.
    db.read("queue").filter(function (q) { return q.kind === "extra" && q.clientToken === token && String(q.acked) !== "yes"; }).forEach(function (q) {
      var want = {};
      try { want = JSON.parse(q.payload || "{}").request || {}; } catch (e) { want = {}; }
      bookings.forEach(function (b, i) {
        if (b.id !== want.bookingId) return;
        var changed = changeExtras(b.extrasMenu || [], b.extras, Number(b.amountDue), want.op, want.key);
        if (changed) bookings[i] = Object.assign({}, b, { extras: changed.chosen, amountDue: changed.amountDue, payLink: "" });
      });
    });
    // A date this client has just held, or a change just applied, shows at once; Coffee Van's next publish replaces it.
    db.read("holds").filter(function (h) { return h.clientToken === token; }).forEach(function (h) {
      var at = -1;
      for (var i = 0; i < bookings.length; i++) if (bookings[i].id === h.id) at = i;
      var moved = { date: h.date, startTime: h.startTime, endTime: h.endTime, people: Number(h.people), hours: Number(h.hours), address: h.address };
      if (at >= 0) bookings[at] = Object.assign({}, bookings[at], moved);
      else {
        var heldTotal = Number(h.total || 0), heldFee = Number(h.outOfHoursFee || 0);
        bookings.push(Object.assign({ id: h.id, status: "held", total: heldTotal, outOfHoursFee: heldFee, discount: 0, amountDue: heldTotal + heldFee, bonusHours: 0, creditsApplied: [], extras: [] }, moved));
      }
    });
    var reward = null;
    try { reward = cleanReward(JSON.parse(metaValue(db, "reward") || "null")); } catch (e) { reward = null; }
    // An extra is already shown as chosen, so it is not "waiting for a text".
    var pendingItems = db.read("queue").filter(function (q) { return q.clientToken === token && String(q.acked) !== "yes" && q.kind !== "extra"; }).map(function (q) {
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
      club: club,
      reward: reward,
      bookings: bookings,
      pending: pendingItems,
      credits: credits,
      pack: pack,
      contract: contract,
    };
  }

  // A 4-Pack holder (valid, with mornings left) may book with 12 hours' notice instead of 24, up to 2 such mornings a week across all packs
  // (4-Pack v2, Sam 16 Nov 2026; packrules.js decides, this only asks). Without packrules.js in the project the 24 hours simply stay.
  function activePackOf(client, now) {
    var pack = null;
    try { pack = client && client.pack ? cleanPack(JSON.parse(client.pack)) : null; } catch (e) { pack = null; }
    if (!pack || pack.left < 1 || pack.validUntil < WanderRules.sydneyDate(now)) return null;
    return pack;
  }
  function shortNoticeThisWeek(db, date) {
    var week = WanderPackRules.weekStart(date), n = 0;
    db.read("queue").forEach(function (q) {
      if (q.kind !== "hold" && q.kind !== "change") return;
      try {
        var p = JSON.parse(q.payload), r = p.request || {}, outcome = (p.response || {}).outcome;
        if (r.shortNotice === true && (outcome === "held" || outcome === "applied") && WanderPackRules.weekStart(r.date) === week) n += 1;
      } catch (e) { /* an unreadable row counts for nobody */ }
    });
    return n;
  }
  function packNoticeFor(db, client, date, startTime, now) {
    var none = { opts: undefined, shortNotice: false };
    if (typeof WanderPackRules === "undefined" || !activePackOf(client, now)) return none;
    var hoursAhead = WanderRules.noticeHours(now, date, startTime);
    if (!(hoursAhead < WanderRules.NOTICE_HOURS)) return none;
    var verdict = WanderPackRules.noticeAllowed({ hoursAhead: hoursAhead, isPackHolder: true, urgentThisWeek: shortNoticeThisWeek(db, date) });
    return verdict.ok && verdict.outcome === "hold" ? { opts: { minNoticeHours: WanderPackRules.PACK_NOTICE_HOURS }, shortNotice: true } : none;
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
      } else if (kind === "standing" || kind === "pause") {
        // A 4-Pack holder keeps a held standing morning, or pauses their pack (4-Pack v2). The store checks it against the pack Coffee Van
        // published, with the same rules (packrules.js); Coffee Van applies it and tells Sam. A pause the rules refuse is not queued.
        var packNow = activePackOf(client, now);
        if (!packNow || typeof WanderPackRules === "undefined") return { ok: false, error: "not-found" };
        if (kind === "standing") {
          var month = clean(body.month, 7);
          var held2 = packNow.standingMonths.filter(function (m) { return m.month === month && m.state === "proposed"; })[0];
          if (!held2) return { ok: false, error: "not-offered" };
          fields = { op: "confirm", month: month };
        } else {
          var from = clean(body.from, 10), days = Number(body.days);
          var verdict = WanderPackRules.pauseAllowed({ pausedDaysSoFar: packNow.pausedDays, requestDays: days, noticeDays: WanderPackRules.daysBetween(WanderRules.sydneyDate(now), from) });
          if (!verdict.ok) return { ok: true, outcome: "declined", replyWithinHours: 24, message: verdict.reason + " Give us a ring and we will sort it out." };
          fields = { from: from, days: days };
        }
      } else if (kind === "enquiry") {
        // One generic "ask us about it" request, priced by nobody here: Sam rings the client. Today: paying ahead for 3, 6 or 12 months,
        // and (once its hourly rate is known) a photographer. A new kind of enquiry is one more entry in ENQUIRIES.
        var what = clean(body.enquiry, 24);
        if (ENQUIRIES.indexOf(what) < 0) return { ok: false, error: "bad-enquiry" };
        fields = { enquiry: what, note: clean(body.note, 300) };
      } else {
        return { ok: false, error: "unknown-kind" };
      }

      if (kind === "hold") {
        var others = busyOn(db, fields.date);
        var holdNotice = packNoticeFor(db, client, fields.date, fields.startTime, now);
        var held = WanderRules.decideHold({ date: fields.date, startTime: fields.startTime, hours: fields.hours, travelKm: fields.travelKm }, others, asOf, now, holdNotice.opts);
        fields.shortNotice = holdNotice.shortNotice && held.decision === "held";
        if (held.decision === "held" && typeof WanderPackRules !== "undefined") {
          var ahead = WanderPackRules.daysBetween(WanderRules.sydneyDate(now), fields.date);
          if (ahead >= AVAILABILITY_DAYS && ahead < AVAILABILITY_DAYS + WanderPackRules.FIRST_PICK_DAYS && !(activePackOf(client, now) && firstPickDayOpen(WanderRules.sydneyDate(now), fields.date, fields.hours, now))) {
            held = { decision: "requested", reasons: (held.reasons || []).concat(["first pick for 4-Pack holders"]) };
          }
        }
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
        var changeNotice = packNoticeFor(db, client, fields.date, fields.startTime, now);
        var change = WanderRules.decideChange(booking, { date: fields.date, startTime: fields.startTime, hours: fields.hours, travelKm: fields.travelKm }, others2, asOf, now, changeNotice.opts);
        fields.shortNotice = changeNotice.shortNotice && change.decision === "applied";
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
      } else if (kind === "standing" || kind === "pause") {
        response = { ok: true, outcome: "requested", replyWithinHours: 24, message: copyFor(kind, 24) };
        fields.decision = "requested";
      } else if (kind === "enquiry") {
        response = { ok: true, outcome: "requested", replyWithinHours: 24, message: copyFor("enquiry", 24) };
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

  // A client adds or removes an extra (the logo on the foam) on one of their booked mornings. It must be on that booking's published
  // menu (or already chosen, for a removal). It shows at once on the client's page, as a hold does, and is queued for Coffee Van, which
  // applies it at its own price and refuses it after the cutoff; its next publish replaces the booking as truth.
  function extra(db, body, now) {
    var client = clientBy(db, body && body.k);
    if (!client) return { ok: false, error: "not-found" };
    var op = clean(body.op, 8), key = clean(body.key, 40), bookingId = clean(body.bookingId, 80);
    if (op !== "add" && op !== "remove") return { ok: false, error: "bad-op" };
    if (!key || !bookingId) return { ok: false, error: "bad-request" };

    return db.lock(function () {
      var rows = db.read("bookings");
      var at = -1;
      rows.forEach(function (b, i) { if (b.id === bookingId && b.clientToken === client.token) at = i; });
      if (at < 0) return { ok: false, error: "not-found" };
      var row = rows[at];
      if (row.status !== "held" && row.status !== "confirmed") return { ok: false, error: "not-open" };
      var menu = parseList(row.extrasMenu, cleanMenu);
      var chosen = parseList(row.extras, cleanChosen);
      var isChosen = chosen.some(function (c) { return c.key === key; });
      var isOffered = menu.some(function (m) { return m.key === key; });
      if (!isChosen && !isOffered) return { ok: false, error: "not-offered" };
      var changed = changeExtras(menu, chosen, Number(row.amountDue), op, key);
      if (!changed) return { ok: true, outcome: "unchanged", bookingId: bookingId }; // already how the client wants it

      var queue = db.read("queue");
      var since = Date.parse(now) - 24 * 60 * 60 * 1000;
      var recent = queue.filter(function (q) { return q.kind === "extra" && q.clientToken === client.token && Date.parse(q.receivedAt) >= since; }).length;
      if (recent >= EXTRA_CHANGES_PER_CLIENT_PER_DAY) return { ok: false, error: "too-many" };

      var next = Object.assign({}, row, { extras: JSON.stringify(changed.chosen), amountDue: changed.amountDue, payLink: "" });
      if (op === "add") next.paid = ""; // a card link or a payment made for the old amount no longer covers it
      rows[at] = next;
      db.write("bookings", rows);
      var response = { ok: true, outcome: "applied", bookingId: bookingId };
      db.append("queue", {
        id: "extra-" + Date.parse(now) + "-" + queue.length, kind: "extra", receivedAt: now, clientToken: client.token,
        payload: JSON.stringify({ request: { bookingId: bookingId, key: key, op: op }, response: response }), acked: "no",
      });
      return response;
    });
  }

  // A first-time client's request from the booking page, with no key yet. It runs the same rules as a portal hold, makes the
  // client's private key here (so the first email can carry it), and queues the request for Coffee Van, which makes the client.
  // Held or not, the request reaches Sam; only a held one blocks the slot. A hidden "website" box catches bots.
  var NEWHOLD_PER_EMAIL_PER_DAY = 3;
  function newHold(db, body, now) {
    if (!body || typeof body !== "object") return { ok: false, error: "bad-request" };
    if (clean(body.website, 80)) return { ok: true, outcome: "requested" };
    var requestId = clean(body.requestId, 80);
    if (!requestId) return { ok: false, error: "no-request-id" };
    var name = clean(body.name, 80);
    var phone = clean(body.phone, 30);
    var email = clean(body.email, 120).toLowerCase();
    if (!name) return { ok: false, error: "no-name" };
    if (phone.replace(/\D/g, "").length < 8) return { ok: false, error: "bad-phone" };
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: "bad-email" };
    var parsed = readRequest(body);
    if (parsed.error) return { ok: false, error: parsed.error };
    var fields = parsed.value;
    if (typeof db.newKey !== "function") return { ok: false, error: "store-error" };

    return db.lock(function () {
      var queue = db.read("queue");
      var previous = queue.filter(function (q) { return q.id === requestId && q.kind === "newhold"; })[0];
      if (previous) {
        var stored = JSON.parse(previous.payload || "{}").response;
        if (stored) return stored;
      }
      var cutoff = Date.parse(now) - 24 * 60 * 60 * 1000;
      var today = 0;
      queue.forEach(function (q) {
        if (q.kind !== "newhold" || Date.parse(q.receivedAt) < cutoff) return;
        try { if (JSON.parse(q.payload).request.email === email) today += 1; } catch (e) { /* an unreadable row counts for nobody */ }
      });
      if (today >= NEWHOLD_PER_EMAIL_PER_DAY) return { ok: false, error: "too-many" };

      var key = db.newKey();
      var asOf = metaValue(db, "asOf");
      var held = WanderRules.decideHold({ date: fields.date, startTime: fields.startTime, hours: fields.hours, travelKm: fields.travelKm }, busyOn(db, fields.date), asOf, now);
      var reply = WanderRules.replyWithinHours(now, fields.date, fields.startTime);
      // A contract enquiry (the booking page's "Prepaid contract" choice) is a request Sam confirms by phone: it never holds the van's slot.
      if (/^Prepaid contract/i.test(clean(body.package, 40)) && held.decision === "held") held = { decision: "requested", reasons: (held.reasons || []).concat(["contract enquiry"]) };
      var response = { ok: true, outcome: held.decision, replyWithinHours: reply, key: key, message: copyFor(held.decision === "held" ? "held" : "requested", reply) };
      if (held.decision === "held") {
        var holdId = "hold-" + requestId;
        db.append("holds", {
          requestId: requestId, id: holdId, clientToken: key, date: fields.date, startTime: fields.startTime,
          endTime: endTimeFor(fields.startTime, fields.hours), people: fields.people, hours: fields.hours,
          address: fields.address, total: shownBase(fields), outOfHoursFee: Number(fields.shownFee || 0), createdAt: now,
        });
        response.bookingId = holdId;
      }
      var first = name.split(/\s+/)[0];
      db.append("newclients", { token: key, firstName: clean(first, 40), requestId: requestId, createdAt: now });
      fields.name = name;
      fields.phone = phone;
      fields.email = email;
      fields.decision = held.decision;
      fields.reasons = held.reasons;
      ["source", "medium", "campaign", "heard", "referral", "package"].forEach(function (k) { fields[k] = clean(body[k], 40); });
      fields.offers = body.offers === true;
      db.append("queue", { id: requestId, kind: "newhold", receivedAt: now, clientToken: key, payload: JSON.stringify({ request: fields, response: response }), acked: "no" });
      return response;
    });
  }

  var AVAILABILITY_DAYS = 60;
  var FIRST_START_MINUTES = 6 * 60;
  var LAST_START_MINUTES = 18 * 60;
  var START_STEP_MINUTES = 30;
  var ALERT_EVERY_MS = 60 * 60 * 1000;

  function startTimes() {
    var out = [];
    for (var m = FIRST_START_MINUTES; m <= LAST_START_MINUTES; m += START_STEP_MINUTES) {
      out.push((m < 600 ? "0" : "") + Math.floor(m / 60) + ":" + (m % 60 === 0 ? "00" : "30"));
    }
    return out;
  }

  // The start times a client could hold right now, each one put through the same rules as a hold (decideHold, against the
  // published busy times and the holds still waiting), so a time listed free is held when the client taps it. For a change,
  // the client's own booking is left out exactly as a change leaves it out. When availability is stale nothing is claimed free.
  function availability(db, body, now) {
    var client = clientBy(db, body && body.k);
    if (!client) return { ok: false, error: "not-found" };
    var hours = Number(body.hours);
    if (CATERING_HOURS.indexOf(hours) < 0) return { ok: false, error: "bad-hours" };
    var own = null;
    if (body.bookingId) {
      own = db.read("bookings").filter(function (b) { return b.id === clean(body.bookingId, 80) && b.clientToken === client.token; })[0] || null;
    }
    return availabilityCore(db, hours, own, now, Boolean(activePackOf(client, now)));
  }

  // The same list for someone with no key yet (the booking page): nothing of anyone's is left out.
  function openTimes(db, body, now) {
    var hours = Number(body && body.hours);
    if (CATERING_HOURS.indexOf(hours) < 0) return { ok: false, error: "bad-hours" };
    return availabilityCore(db, hours, null, now);
  }

  // First pick (4-Pack v2, Sam 16 Nov 2026): the public sees the next AVAILABILITY_DAYS days; a pack holder sees FIRST_PICK_DAYS more, but
  // only the 2-hour mornings (packrules.js decides when each of those days opens). `firstPick` is true for a valid pack holder.
  function firstPickDayOpen(today, date, hours, now) {
    if (typeof WanderPackRules === "undefined" || Number(hours) !== 2) return false;
    var ahead = WanderPackRules.daysBetween(today, date);
    if (ahead < AVAILABILITY_DAYS || ahead >= AVAILABILITY_DAYS + WanderPackRules.FIRST_PICK_DAYS) return false;
    return WanderPackRules.isFirstPickOpen(WanderRules.addDays(date, -(AVAILABILITY_DAYS - 1)), now);
  }

  function availabilityCore(db, hours, own, now, firstPick) {
    var asOf = metaValue(db, "asOf");
    var today = WanderRules.sydneyDate(now);
    var reach = AVAILABILITY_DAYS + (firstPick && typeof WanderPackRules !== "undefined" && Number(hours) === 2 ? WanderPackRules.FIRST_PICK_DAYS : 0);
    var out = {
      ok: true, asOf: asOf, stale: WanderRules.isStale(asOf, now), hours: hours,
      window: { from: today, through: WanderRules.addDays(today, reach - 1) }, days: {},
    };
    if (out.stale || !today) return out;
    var byDate = {};
    function add(date, row) { (byDate[date] = byDate[date] || []).push(row); }
    db.read("busy").forEach(function (b) {
      if (own && b.date === own.date && b.startTime === own.startTime) return;
      add(b.date, { date: b.date, startTime: b.startTime, endTime: b.endTime });
    });
    db.read("holds").forEach(function (h) { add(h.date, { date: h.date, startTime: h.startTime, endTime: h.endTime }); });
    var times = startTimes();
    for (var i = 0; i < reach; i++) {
      var date = WanderRules.addDays(today, i);
      if (i >= AVAILABILITY_DAYS && !(firstPick && firstPickDayOpen(today, date, hours, now))) continue;
      var others = byDate[date] || [];
      var free = times.filter(function (t) {
        return WanderRules.decideHold({ date: date, startTime: t, hours: hours, travelKm: 0 }, others, asOf, now).decision === "held";
      });
      if (free.length) out.days[date] = free;
    }
    return out;
  }

  // A store error is mailed to its owner at most once an hour. `lastAlertAt` is kept by the caller (Script Properties, so it
  // works even when the Sheet itself is what failed). The mail names the action and the error, never a client or a request.
  function failureAlert(lastAlertAt, action, message, now) {
    var last = WanderRules.instantOf(lastAlertAt);
    var at = WanderRules.instantOf(now);
    if (!Number.isNaN(last) && !Number.isNaN(at) && at - last < ALERT_EVERY_MS) return { send: false, lastAlertAt: lastAlertAt };
    return {
      send: true,
      lastAlertAt: now,
      subject: "Wander Customer Portal: the store hit an error",
      body: "The portal's store hit an error while handling \"" + clean(action, 20) + "\" at " + clean(now, 40) + ".\n\n" +
        "Error: " + clean(message, 300) + "\n\n" +
        "Clients who meet this are told their request could not be confirmed, and are offered a retry, a text and a call. " +
        "Open the Apps Script project's Executions page for the detail. You will get at most one of these an hour.",
    };
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

  // What clients did on the page in the last `days` days, for Sam's conversion view. Counts only: no client is identified.
  function funnel(db, appToken, now, days) {
    if (!appTokenOk(db, appToken)) return { ok: false, error: "not-allowed" };
    var n = Math.floor(Number(days));
    if (!(n >= 1)) n = 30;
    if (n > 90) n = 90;
    var today = WanderRules.sydneyDate(now);
    var since = WanderRules.addDays(today, -(n - 1));
    var out = { ok: true, days: n, since: since, events: 0, totals: {}, views: {}, ctas: {} };
    EVENT_TYPES.forEach(function (t) { out.totals[t] = 0; });
    db.read("events").forEach(function (e) {
      var day = WanderRules.sydneyDate(e.time);
      if (!day || day < since || out.totals[e.type] === undefined) return;
      out.events += 1;
      out.totals[e.type] += 1;
      var label = "";
      try { label = clean((JSON.parse(e.data || "{}") || {}).v, 24); } catch (err) { label = ""; }
      if (label && e.type === "view") out.views[label] = (out.views[label] || 0) + 1;
      if (label && e.type === "cta") out.ctas[label] = (out.ctas[label] || 0) + 1;
    });
    return out;
  }

  return {
    TABLES: TABLES, CONTRACT_VERSION: CONTRACT_VERSION, EVENT_TYPES: EVENT_TYPES,
    event: event, funnel: funnel,
    health: health, publish: publish, pending: pending, ack: ack, prices: prices, session: session, request: request, extra: extra,
    availability: availability, openTimes: openTimes, newHold: newHold, failureAlert: failureAlert,
    endTimeFor: endTimeFor, readRequest: readRequest,
  };
})();
if (typeof module === "object" && module.exports) module.exports = StoreLogic;
