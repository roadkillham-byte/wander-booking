// The Wander Customer Portal page. Screens: Held (landing), Pick (change or first pick), Upgrade (the 4-Pack, once), Confirmed,
// My bookings, a booking, My 4-Pack, Compare options, Schedule a call. One action per screen. Client-facing words say "we".
// Prices and fees are read from the store (Coffee Van publishes them); this page only looks them up.
(function () {
  "use strict";
  var TIMES = [];
  for (var mins = 6 * 60; mins <= 18 * 60; mins += 30) {
    TIMES.push(String(Math.floor(mins / 60)).padStart(2, "0") + ":" + String(mins % 60).padStart(2, "0"));
  }
  var PROMISES = [
    "Late by more than 15 minutes? Your first hour of service is free.",
    "We don't turn up? You get a full refund.",
    "A coffee isn't right? We remake it or refund it.",
    "Cancel up to 24 hours ahead, and the full amount goes toward your next booking.",
  ];
  var INCLUDES = [
    "Unlimited coffee, tea and hot chocolate for every guest",
    "A bowl each, any bowl you like",
    "Our set-up hour, and the pack-down",
    "A free babyccino for every child",
  ];
  var app = document.getElementById("app");
  var state = { k: null, session: null, prices: null, route: {}, notice: null, busy: false, lastHold: null, avail: null, failures: 0 };

  function money(n) { return "$" + Math.round(Number(n) || 0).toLocaleString("en-AU"); }
  // What a client is charged to the cent: $557.10, or $619 when there are no cents. Never rounded, so the page matches the receipt.
  function exact(n) {
    var v = Math.round((Number(n) || 0) * 100) / 100;
    return "$" + v.toLocaleString("en-AU", { minimumFractionDigits: v % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 });
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function dnt() { return navigator.doNotTrack === "1" || navigator.globalPrivacyControl === true; }
  function track(type, data) {
    if (dnt() || !state.k) return;
    WanderApi.event({ k: state.k, type: type, data: data || {} });
  }
  function dayName(iso) {
    var d = new Date(iso + "T12:00:00");
    if (isNaN(d)) return iso;
    return d.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  }
  function clock(hhmm) {
    var m = /^(\d{2}):(\d{2})$/.exec(hhmm || "");
    if (!m) return hhmm || "";
    var h = Number(m[1]), suffix = h < 12 ? "am" : "pm", h12 = h % 12 || 12;
    return h12 + ":" + m[2] + " " + suffix;
  }
  function endOf(startTime, hours) {
    var m = /^(\d{2}):(\d{2})$/.exec(startTime || "");
    if (!m) return "";
    var t = Number(m[1]) * 60 + Number(m[2]) + Math.round(hours * 60);
    return String(Math.floor(t / 60)).padStart(2, "0") + ":" + String(t % 60).padStart(2, "0");
  }
  function feeFor(startTime, hours) {
    var row = state.prices && state.prices.fees && state.prices.fees[startTime];
    return row && row[hours] != null ? Number(row[hours]) : 0;
  }
  function quoteFor(people, hours) {
    var row = state.prices && state.prices.quotes && state.prices.quotes[people];
    return row && row[hours] != null ? Number(row[hours]) : null;
  }
  function packFor(people, hours) {
    var row = state.prices && state.prices.packs && state.prices.packs[people];
    return row && row[hours] ? row[hours] : null;
  }
  function referralLink() {
    var code = state.session && state.session.client && state.session.client.referralCode;
    return code ? (window.WANDER_REFERRAL_BASE || "") + "?ref=" + encodeURIComponent(code) : "";
  }
  function firstName() { return (state.session && state.session.client && state.session.client.firstName) || "there"; }
  function activeBooking() {
    var list = (state.session && state.session.bookings) || [];
    return list.filter(function (b) { return b.status === "held" || b.status === "confirmed"; })[0] || null;
  }
  function paymentsOn() { return window.WANDER_PAYMENTS === true; }

  function parseHash() {
    var raw = location.hash.replace(/^#/, "");
    var params = new URLSearchParams(raw);
    state.k = params.get("k");
    state.route = { v: params.get("v") || "home", b: params.get("b") || "" };
  }
  function go(v, extra) {
    var params = new URLSearchParams();
    params.set("k", state.k);
    params.set("v", v);
    Object.keys(extra || {}).forEach(function (key) { params.set(key, extra[key]); });
    location.hash = params.toString();
  }

  function shell(inner, opts) {
    opts = opts || {};
    var steps = ["Asked", "Held", "Confirmed", "Paid", "Morning"];
    var reached = opts.step || 0;
    var trail = steps.map(function (s, i) {
      return '<li class="' + (i < reached ? "done" : "") + '">' + s + "</li>";
    }).join("");
    var notice = state.notice ? '<p class="notice" role="status">' + esc(state.notice) + "</p>" : "";
    var stale = state.session && state.session.stale
      ? '<p class="note">Our availability is a little old. We will confirm your time by text.</p>' : "";
    // The funnel screens have no menu: nothing takes the client away from the next step. Account screens do.
    var navHtml = !opts.nav ? "" :
      '<nav class="top"><a href="#k=' + encodeURIComponent(state.k) + '&v=bookings">My bookings</a>' +
      '<a href="#k=' + encodeURIComponent(state.k) + '&v=pack">My 4-Pack</a>' +
      '<a href="#k=' + encodeURIComponent(state.k) + '&v=compare">Compare options</a>' +
      '<a href="#k=' + encodeURIComponent(state.k) + '&v=refer">Refer a team</a></nav>';
    return '<header class="band rise"><img src="assets/wander-logo.png" alt="Wander Coffee Van">' +
      "<h1>Come Find Us</h1>" + (opts.greet ? '<p class="greet">' + esc(opts.greet) + "</p>" : "") +
      '<ol class="trail" aria-label="Your progress">' + trail + "</ol></header>" +
      navHtml +
      notice + stale + inner +
      '<p class="talk"><a href="tel:' + esc(window.WANDER_PHONE_LINK) + '">Rather talk? <span>We will ring you today</span> <b class="num">' + esc(window.WANDER_PHONE_DISPLAY) + "</b></a></p>";
  }

  function promisesHtml() {
    return '<section class="rise d3"><h2 class="rule">Our promises</h2><ul class="list">' +
      PROMISES.map(function (p) { return "<li>" + esc(p) + "</li>"; }).join("") + "</ul>" +
      '<h2 class="rule">Every morning includes</h2><ul class="list">' +
      INCLUDES.map(function (p) { return "<li>" + esc(p) + "</li>"; }).join("") + "</ul></section>";
  }

  // Held landing: the quote from the form, with the date held when the client presses Book.
  function renderHome() {
    var booking = activeBooking();
    if (booking) return renderBookingCard(booking, true);
    var q = state.session && state.session.quote;
    var last = lastCompleted();
    if (!q && last) return usable(last) ? renderSameAgain(last) : renderPick(seedFrom(last), "new");
    if (!q) return renderPick({ date: "", startTime: "09:00", people: 20, hours: 3, address: "" }, "new");
    var total = Number(q.total) + Number(q.fee || 0);
    var inner = '<section class="rise d1"><h2 class="rule">Your morning</h2>' +
      '<div class="ticket"><dl>' +
      "<dt>Date</dt><dd>" + esc(dayName(q.date)) + "</dd>" +
      "<dt>Start</dt><dd>" + esc(clock(q.startTime)) + (q.fee ? " (+" + money(q.fee) + " out of hours)" : "") + "</dd>" +
      "<dt>People</dt><dd>" + esc(q.people) + "</dd>" +
      "<dt>Hours</dt><dd>" + esc(q.hours) + "</dd>" +
      "<dt>Where</dt><dd>" + esc(q.address || "to confirm on the call") + "</dd></dl>" +
      '<div class="price"><strong>' + money(total) + "</strong><span>about " + money(total / q.people) + " a head, incl. GST</span></div></div>" +
      '<p class="note">Book it and we hold this date for you. We reply within 24 hours to confirm.</p>' +
      '<button type="button" class="go" id="book" data-date="' + esc(q.date) + '" data-start="' + esc(q.startTime) + '" data-people="' + esc(q.people) +
      '" data-hours="' + esc(q.hours) + '" data-address="' + esc(q.address || "") + '">Book this morning</button>' +
      '<p class="note"><a href="#k=' + encodeURIComponent(state.k) + '&v=pick">Change the date, time or people</a></p></section>' + creditsHtml();
    track("view", { v: "held" });
    return shell(inner + promisesHtml(), { step: 1, greet: "Hi " + firstName() + ". Here is your morning." });
  }

  // A booking typed into Coffee Van by hand may have no headcount or start time; Same again needs all the details.
  function usable(b) {
    return Number.isInteger(Number(b.people)) && Number(b.people) >= 1 && /^\d{2}:\d{2}$/.test(b.startTime || "") && [2, 3, 4, 5, 6].indexOf(Number(b.hours)) >= 0;
  }
  function seedFrom(b) {
    var okTime = /^\d{2}:\d{2}$/.test(b.startTime || "");
    return { date: "", startTime: okTime ? b.startTime : "09:00", people: Number(b.people) >= 1 ? Number(b.people) : 20,
      hours: [2, 3, 4, 5, 6].indexOf(Number(b.hours)) >= 0 ? Number(b.hours) : 3, address: b.address || "" };
  }
  // The booking a change is for: the one named in the link, else the client's current one.
  function bookingForRoute() {
    var list = (state.session && state.session.bookings) || [];
    return list.filter(function (b) { return b.id === state.route.b; })[0] || activeBooking();
  }

  function lastCompleted() {
    var done = ((state.session && state.session.bookings) || []).filter(function (b) { return b.status === "completed"; });
    done.sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    return done[0] || null;
  }

  // Same again: a returning client's last morning, on the same weekday a few weeks on, held with one tap.
  function renderSameAgain(last) {
    var today = new Date().toLocaleDateString("en-CA", { timeZone: "Australia/Sydney" });
    var date = WanderRules.sameAgainDate(last.date, today);
    var base = quoteFor(Number(last.people), Number(last.hours));
    var fee = feeFor(last.startTime, Number(last.hours));
    var short = new Date(date + "T12:00:00").toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" });
    var inner = '<section class="rise d1"><h2 class="rule">Same again?</h2>' +
      '<div class="ticket"><dl><dt>Date</dt><dd>' + esc(dayName(date)) + "</dd><dt>Start</dt><dd>" + esc(clock(last.startTime)) +
      "</dd><dt>People</dt><dd>" + esc(last.people) + "</dd><dt>Hours</dt><dd>" + esc(last.hours) + "</dd><dt>Where</dt><dd>" + esc(last.address) + "</dd></dl>" +
      (base == null ? "" : '<div class="price"><strong>' + money(base + fee) + "</strong><span>incl. GST</span></div>") + "</div>" +
      '<p class="note">The same morning as last time. We hold the date and reply within 24 hours.</p>' +
      '<button type="button" class="go" id="again" data-date="' + esc(date) + '" data-start="' + esc(last.startTime) + '" data-people="' + esc(last.people) +
      '" data-hours="' + esc(last.hours) + '" data-address="' + esc(last.address) + '">Same again, ' + esc(short) + "</button>" +
      '<p class="note"><a href="#k=' + encodeURIComponent(state.k) + '&v=pick">Pick a different date or time</a></p></section>';
    track("view", { v: "same-again" });
    return shell(inner + promisesHtml(), { step: 0, greet: "Welcome back, " + firstName() + "." });
  }

  // The price, and when Coffee Van has taken credits, what was taken and what to pay. The page only shows these numbers.
  function priceHtml(b) {
    var gross = Number(b.total) + Number(b.outOfHoursFee || 0);
    var applied = b.creditsApplied || [];
    if (!applied.length && !(Number(b.discount) > 0) && !(Number(b.bonusHours) > 0)) {
      return '<div class="price"><strong>' + money(gross) + "</strong><span>incl. GST</span></div>";
    }
    var lines = applied.map(function (l) { return "<li>" + esc(l) + "</li>"; }).join("");
    return '<div class="price"><strong>' + exact(b.amountDue) + "</strong><span>to pay, after your credits</span></div>" +
      '<ul class="list credits-taken">' + lines + "</ul>" +
      '<p class="note">Price ' + exact(gross) + (Number(b.discount) > 0 ? ", less " + exact(b.discount) : "") +
      (Number(b.bonusHours) > 0 ? ", plus " + esc(b.bonusHours) + " free hours" : "") + ". Incl. GST.</p>";
  }

  function renderBookingCard(b, isHome) {
    var inner = '<section class="rise d1"><h2 class="rule">' + (b.status === "confirmed" ? "You are confirmed" : "Your morning is held") + "</h2>" +
      '<div class="ticket"><dl><dt>Date</dt><dd>' + esc(dayName(b.date)) + "</dd><dt>Start</dt><dd>" + esc(clock(b.startTime)) +
      "</dd><dt>People</dt><dd>" + esc(b.people) + "</dd><dt>Hours</dt><dd>" + esc(b.hours) + "</dd><dt>Where</dt><dd>" + esc(b.address) +
      '</dd></dl>' + priceHtml(b) + "</div>" +
      '<p class="note">' + (b.status === "confirmed"
        ? "We will text you the day before. Need to change it? Use the links below."
        : "We reply within 24 hours to confirm. Nothing is charged before we confirm.") + "</p>" +
      '<p class="note"><a href="#k=' + encodeURIComponent(state.k) + "&v=booking&b=" + encodeURIComponent(b.id) + '">Change or cancel</a></p></section>';
    if (isHome) {
      track("view", { v: "held-booking" });
      return shell(inner + clubHtml() + promisesHtml(), { step: b.status === "confirmed" ? 2 : 1, greet: "Hi " + firstName() + "." });
    }
    return inner;
  }

  // Pick: the first choice of morning, or a change to one. Prices and fees are read from the published table.
  function renderPick(seed, mode) {
    var booking = mode === "change" ? seed : null;
    var lengths = [2, 3, 4, 5, 6].map(function (h) {
      return '<label class="chip"><input type="radio" name="hours" value="' + h + '"' + (Number(seed.hours) === h ? " checked" : "") + "> " + h + " hours</label>";
    }).join("");
    var timeOptions = TIMES.map(function (t) {
      return '<option value="' + t + '"' + (seed.startTime === t ? " selected" : "") + ">" + esc(timeLabel(t, Number(seed.hours) || 3, false)) + "</option>";
    }).join("");
    var inner = '<section class="rise d1"><h2 class="rule">' + (mode === "change" ? "Change your morning" : "Pick your morning") + "</h2>" +
      '<form id="pick" class="stack">' +
      '<label>Date<input type="date" name="date" required value="' + esc(seed.date) + '"></label>' +
      '<div id="avail" aria-live="polite"></div>' +
      '<label>Start<select name="startTime">' + timeOptions + "</select></label>" +
      '<label>People<input type="number" name="people" min="1" max="200" required value="' + esc(seed.people) + '"></label>' +
      '<fieldset><legend>Hours</legend>' + lengths + "</fieldset>" +
      '<label>Where<input type="text" name="address" maxlength="200" value="' + esc(seed.address) + '" placeholder="Street and suburb"></label>' +
      '<p class="price-line" id="pick-price" aria-live="polite"></p>' +
      '<button type="submit" class="go">Book this morning</button>' +
      "</form></section>";
    track("view", { v: mode === "change" ? "change" : "pick" });
    setTimeout(function () { updatePickPrice(); applyAvailability(); }, 0);
    return shell(inner, { step: 0, greet: mode === "change" ? "Hi " + firstName() + "." : "Hi " + firstName() + ". Let's find your morning." });
  }

  // A start inside our hours is free or taken; one outside them is neither: it is a request we confirm by text.
  function timeLabel(t, hours, taken) {
    var fee = feeFor(t, hours);
    var outside = !WanderRules.withinTradingHours(t, hours);
    return clock(t) + (fee ? " (+" + money(fee) + ")" : "") + (taken ? " - taken" : outside ? " - we confirm by text" : "");
  }
  function minutesOf(hhmm) { var m = /^(\d{2}):(\d{2})$/.exec(hhmm || ""); return m ? Number(m[1]) * 60 + Number(m[2]) : null; }
  // "between 1:00 pm and 6:00 pm", one phrase for each run of free half hours.
  function freeWindows(list) {
    var runs = [], from = null, prev = null;
    list.forEach(function (t) {
      if (from === null) from = t;
      else if (minutesOf(t) - minutesOf(prev) !== 30) { runs.push([from, prev]); from = t; }
      prev = t;
    });
    if (from !== null) runs.push([from, prev]);
    return runs.map(function (r) { return r[0] === r[1] ? "at " + clock(r[0]) : "between " + clock(r[0]) + " and " + clock(r[1]); }).join(" or ");
  }
  function nextFreeChips(data, skip) {
    var dates = Object.keys(data.days).sort().filter(function (d) { return d !== skip; }).slice(0, 6);
    if (!dates.length) return "";
    return '<p class="note">Next free dates:</p><p class="chips">' + dates.map(function (d) {
      var label = new Date(d + "T12:00:00").toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
      return '<button type="button" class="chip" data-date="' + esc(d) + '">' + esc(label) + "</button>";
    }).join("") + "</p>";
  }
  function availabilityHtml(data, date, free) {
    if (!data) return "";
    if (data.stale) return '<p class="note">Our calendar is a little behind, so pick any time and we will confirm it by text.</p>';
    if (free === null) return nextFreeChips(data, "");
    if (!free.length) return '<p class="note"><strong>That day is full.</strong> Pick another, or ring us.</p>' + nextFreeChips(data, date);
    return '<p class="note">The van is free that day. You can start ' + esc(freeWindows(free)) + ".</p>";
  }
  function loadAvailability(hours, bookingId) {
    var key = hours + "|" + (bookingId || "");
    if (state.avail && state.avail.key === key && Date.now() - state.avail.at < 2 * 60 * 1000) return Promise.resolve(state.avail.data);
    return WanderApi.availability({ k: state.k, hours: hours, bookingId: bookingId || "" }).then(function (r) {
      if (r && r.ok) { state.avail = { key: key, at: Date.now(), data: r }; return r; }
      return null;
    });
  }
  // Marks the start times the van cannot take on the chosen day, and says in words when it is free. If the store does not
  // answer, nothing is claimed: every time stays open and the request itself is checked as before.
  function applyAvailability() {
    var form = document.getElementById("pick");
    var out = document.getElementById("avail");
    if (!form || !out) return;
    var hours = Number(form.hours.value) || 3;
    var b = state.route.v === "change" ? bookingForRoute() : null;
    loadAvailability(hours, b && b.id).then(function (data) {
      if (document.getElementById("pick") !== form || (Number(form.hours.value) || 3) !== hours) return;
      var date = form.date.value;
      var inWindow = data && !data.stale && /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= data.window.from && date <= data.window.through;
      var free = inWindow ? (data.days[date] || []) : null;
      Array.prototype.forEach.call(form.startTime.options, function (o) {
        var taken = free !== null && WanderRules.withinTradingHours(o.value, hours) && free.indexOf(o.value) < 0;
        o.disabled = taken;
        o.textContent = timeLabel(o.value, hours, taken);
      });
      if (free && free.length && free.indexOf(form.startTime.value) < 0 && WanderRules.withinTradingHours(form.startTime.value, hours)) { form.startTime.value = free[0]; updatePickPrice(); }
      out.innerHTML = availabilityHtml(data, date, free);
    });
  }

  function updatePickPrice() {
    var form = document.getElementById("pick");
    var out = document.getElementById("pick-price");
    if (!form || !out) return;
    var people = Number(form.people.value), hours = Number(form.hours.value), start = form.startTime.value;
    var total = quoteFor(people, hours);
    if (total == null || !people) { out.textContent = "We quote this one on the call."; return; }
    var fee = feeFor(start, hours);
    out.textContent = money(total + fee) + " for " + people + " people, " + hours + " hours" + (fee ? " (includes " + money(fee) + " out of hours)" : "") + ", incl. GST";
  }

  // The 4-Pack, once, after the first Book. Value in dollars; the guarantee beside the price; a plain decline.
  function renderUpgrade() {
    var b = state.lastHold || {};
    var people = Number(b.people) || 20, hours = Number(b.hours) || 3;
    var pack = packFor(people, hours);
    if (!pack) return renderConfirmed(null);
    track("upgrade-shown", { people: people, hours: hours });
    var singles = (quoteFor(people, hours) || 0) * 4;
    var inner = '<section class="rise d1"><h2 class="rule">Four mornings, one at a time, or all four up front</h2>' +
      '<div class="ticket stack-up">' +
      "<p>Four mornings at " + hours + " hours for " + people + " people: <strong>" + money(pack.price) + "</strong></p>" +
      "<p>Plus " + pack.bonusHours + " hours of coffee time, free, worth <strong>" + money(pack.bonusValue) + "</strong></p>" +
      "<p>Four single mornings cost " + money(singles) + ". The 4-Pack costs the same, and adds the coffee time above.</p>" +
      '<p class="guarantee">If we don\'t turn up, you get a full refund.</p></div>' +
      '<p class="note">' + (paymentsOn()
        ? "You pay once, after we confirm your first morning. Valid 12 months."
        : "We will send you a payment link once we are trading. Valid 12 months. Nothing is charged before we confirm.") + "</p>" +
      '<button type="button" class="go" id="pack-yes">Yes, the 4-Pack</button>' +
      '<p class="note"><button type="button" class="link" id="pack-no">No thanks, just this morning</button></p></section>';
    return shell(inner, { step: 1, greet: "One more thing, " + firstName() + "." });
  }

  function renderConfirmed(response) {
    var b = state.lastHold;
    var reply = (response && response.replyWithinHours) || 24;
    var calendarBtn = b ? '<button type="button" class="link" id="ics">Add to calendar</button>' : "";
    var inner = '<section class="rise d1"><h2 class="rule">What happens next</h2><ol class="steps">' +
      "<li>We reply within " + reply + " hours to confirm your morning.</li>" +
      "<li>" + (paymentsOn() ? "Once we confirm, you pay the amount shown." : "We will send a payment link once we are trading.") + "</li>" +
      "<li>We turn up" + (b ? " at " + esc(clock(b.startTime)) : "") + ". Set-up is included.</li></ol>" +
      '<p class="note">' + calendarBtn + "</p></section>" +
      '<section class="rise d2 refer"><h2 class="rule">Know a team that would love this?</h2>' +
      pitchHtml() +
      '<button type="button" class="go ghost" id="share">Copy my referral link</button>' +
      '<p class="note"><a href="#k=' + encodeURIComponent(state.k) + '&v=refer">See who you have referred</a></p></section>';
    track("booked", { outcome: response ? response.outcome : "held" });
    return shell(inner, { step: 2, greet: "Thank you, " + firstName() + "." });
  }

  function renderBookings() {
    var list = (state.session && state.session.bookings) || [];
    var pend = (state.session && state.session.pending) || [];
    var rows = list.map(function (b) {
      return '<li><a href="#k=' + encodeURIComponent(state.k) + "&v=booking&b=" + encodeURIComponent(b.id) + '">' + esc(dayName(b.date)) + " at " + esc(clock(b.startTime)) +
        '</a> <span class="word">' + esc(b.status) + "</span></li>";
    }).concat(pend.map(function (p) { return '<li>Requested: ' + esc(p.kind) + ' (we reply within ' + esc(p.replyWithinHours) + " hours)</li>"; }));
    var inner = '<section class="rise d1"><h2 class="rule">My bookings</h2>' +
      (rows.length ? '<ul class="list">' + rows.join("") + "</ul>" : '<p>No bookings yet. <a href="#k=' + encodeURIComponent(state.k) + '&v=pick">Pick a morning</a>.</p>') + "</section>" + clubHtml() + creditsHtml();
    return shell(inner, { nav: true, greet: "Your mornings, " + firstName() + "." });
  }

  function renderBooking() {
    var list = (state.session && state.session.bookings) || [];
    var b = list.filter(function (x) { return x.id === state.route.b; })[0];
    if (!b) return shell('<section class="rise d1"><p>We could not find that booking. <a href="#k=' + encodeURIComponent(state.k) + '&v=bookings">Back to my bookings</a>.</p></section>', { nav: true });
    var cancellable = b.status === "held" || b.status === "confirmed";
    var inner = renderBookingCard(b, false) +
      '<section class="rise d2"><p class="note">Change it: <a href="#k=' + encodeURIComponent(state.k) + "&v=change&b=" + encodeURIComponent(b.id) + '">pick a new date or time</a></p>' +
      (cancellable ? '<button type="button" class="link danger" id="cancel-ask">Cancel this morning</button>' +
        '<div id="cancel-confirm" hidden><p>Cancel this morning? You are promised your credit. We confirm it within 24 hours.</p>' +
        '<button type="button" class="go" id="cancel-yes">Yes, cancel it</button> <button type="button" class="link" id="cancel-no">Keep it</button></div>' : "") +
      "</section>";
    return shell(inner, { nav: true, greet: "Your morning, " + firstName() + "." });
  }

  function renderPack() {
    var pack = state.session && state.session.pack;
    var inner = '<section class="rise d1"><h2 class="rule">My 4-Pack</h2>' +
      (pack ? "<p>" + esc(pack.left) + " mornings left of " + esc(pack.mornings) + ". Bonus time: " + esc(pack.bonusHours) + " hours. Valid until " + esc(dayName(pack.expiresAt)) + ".</p>"
        : "<p>You do not have a 4-Pack yet. Four mornings, paid up front, with bonus coffee time on top.</p>" +
          '<p><a href="#k=' + encodeURIComponent(state.k) + '&v=pick">Pick a morning first</a>, then we offer the 4-Pack.</p>') + "</section>";
    return shell(inner, { nav: true, greet: "Your 4-Pack, " + firstName() + "." });
  }

  var ORDINALS = { 2: "second", 3: "third", 4: "fourth", 5: "fifth" };
  // What the offer is, in the numbers Coffee Van published. Before the first publish carries them, the old plain line.
  function pitchHtml() {
    var r = state.session && state.session.reward;
    if (!r) return "<p>Send them your link. When their first morning runs, you get 10% off your next booking.</p>";
    return "<p>Send them your link. Your friend gets " + esc(r.friendPercent) + "% off their first morning. When it runs, you get " +
      esc(r.referrerPercent) + "% off your next booking.</p>" +
      "<p>Every " + esc(ORDINALS[r.captainEvery] || r.captainEvery + "th") + " friend's morning earns you " + esc(r.captainFreeHours) + " free hours on top.</p>";
  }
  // Dots toward the next free-hours reward: how many of this round's friends' mornings are done.
  function progressHtml() {
    var r = state.session && state.session.reward;
    if (!r || !(r.captainEvery > 0)) return "";
    var done = ((state.session && state.session.referrals) || []).filter(function (x) { return x.status === "completed"; }).length;
    var into = done % r.captainEvery;
    var dots = "";
    for (var i = 0; i < r.captainEvery; i++) dots += '<span class="' + (i < into ? "on" : "") + '"></span>';
    return '<p class="note">' + into + " of " + r.captainEvery + " mornings done toward your " + esc(r.captainFreeHours) + " free hours.</p>" +
      '<p class="dots" aria-hidden="true">' + dots + "</p>";
  }

  // An Office Club member's stamp card: four mornings a month, one stamp for each that is booked. Coffee Van counts them.
  function clubHtml() {
    var club = state.session && state.session.club;
    if (!club) return "";
    var d = new Date(club.month + "-01T12:00:00");
    var month = isNaN(d) ? club.month : d.toLocaleDateString("en-AU", { month: "long", year: "numeric" });
    var stamps = "";
    for (var i = 0; i < club.perMonth; i++) stamps += '<span class="' + (i < club.used ? "on" : "") + '"></span>';
    var left = club.perMonth - club.used;
    var line = left > 0
      ? esc(club.used) + " of " + esc(club.perMonth) + " mornings booked in " + esc(month) + ". " + esc(left) + " left."
      : esc(club.used) + " of " + esc(club.perMonth) + " mornings booked in " + esc(month) + ". That is the four: another morning is a request we confirm.";
    return '<section class="rise d2 club"><h2 class="rule">Your Office Club</h2><p class="note">' + line + '</p><p class="stamps" aria-hidden="true">' + stamps + "</p>" +
      '<p class="note"><a href="#k=' + encodeURIComponent(state.k) + '&v=pick">Book a club morning</a></p></section>';
  }

  function longDate(iso) {
    var d = new Date(iso + "T12:00:00");
    return isNaN(d) ? iso : d.toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });
  }
  // The credits waiting for this client, in the words the store published.
  function creditsHtml() {
    var credits = (state.session && state.session.credits) || [];
    if (!credits.length) return "";
    return '<section class="rise d2"><h2 class="rule">Waiting for you</h2><ul class="list">' +
      credits.map(function (c) { return "<li>" + esc(c.label) + (c.expiresAt ? ", use by " + esc(longDate(c.expiresAt)) : "") + "</li>"; }).join("") +
      '</ul><p class="note">We take it off when we confirm your next morning.</p></section>';
  }

  // Refer a team: the code, one tap to share the link, and who has booked, by first name only.
  function renderRefer() {
    var code = (state.session && state.session.client && state.session.client.referralCode) || "";
    var refs = (state.session && state.session.referrals) || [];
    var rows = refs.length
      ? '<ul class="list">' + refs.map(function (r) {
        return "<li>" + esc(r.firstName || "A friend") + (r.status === "completed" ? ": their morning is done, 10% earned" : ": booked. Your 10% unlocks after their morning") + "</li>";
      }).join("") + "</ul>"
      : "<p>No one yet. Send your link to a team that would love a morning.</p>";
    var inner = '<section class="rise d1"><h2 class="rule">Refer a team</h2>' +
      pitchHtml() + progressHtml() +
      (code ? '<p class="refcode">Your code: <code>' + esc(code) + "</code></p>" : "") +
      '<button type="button" class="go" id="share">Copy my referral link</button>' + rows + "</section>" + creditsHtml();
    track("view", { v: "refer" });
    return shell(inner, { nav: true, greet: "Share the morning, " + firstName() + "." });
  }

  function renderCompare() {
    var p2 = quoteFor(20, 2), p3 = quoteFor(20, 3);
    var packs = packFor(20, 3);
    var items = [
      ["Team Morning", "One morning for your team, booked as you need it.", "From " + money(p2) + " for 20 people, 2 hours, incl. GST."],
      ["Office Club", "Four mornings a month for a team of 20. Billed after each morning.", money(p2) + " a morning at 2 hours."],
      ["Prepaid 4-Pack", "Four mornings, paid up front, with bonus time that grows with the length.", packs ? money(packs.price) + " for 20 people, 3 hours, with " + packs.bonusHours + " hours bonus." : ""],
      ["Function Day", "A flat rate for a launch, open day or school event.", money(p3) + " for 20 people, 3 hours, incl. GST."],
    ];
    var rows = items.map(function (it) {
      return '<li><h3>' + esc(it[0]) + '</h3><p>' + esc(it[1]) + '</p><p class="word">' + esc(it[2]) + '</p>' +
        '<a class="link" href="#k=' + encodeURIComponent(state.k) + "&v=call&when=" + encodeURIComponent(it[0]) + '">Request this</a></li>';
    }).join("");
    track("view", { v: "compare" });
    return shell('<section class="rise d1"><h2 class="rule">Compare options</h2><ul class="list cards">' + rows + "</ul></section>", { nav: true, greet: "Options for " + firstName() + "." });
  }

  function renderCall() {
    var when = state.route.when || "";
    var inner = '<section class="rise d1"><h2 class="rule">Schedule a call</h2>' +
      '<form id="call" class="stack"><label>When suits you<input name="when" maxlength="80" value="' + esc(when) + '" placeholder="A weekday after 3 pm"></label>' +
      '<label>Anything we should know?<textarea name="note" maxlength="300" rows="3"></textarea></label>' +
      '<button type="submit" class="go">Request the call</button></form></section>';
    return shell(inner, { nav: true, greet: "Let's talk, " + firstName() + "." });
  }

  function showPage(html) {
    app.innerHTML = html;
    bind();
  }

  // A request, sent once with its own id. If the reply never arrives the same body (same id) can be sent again safely.
  function send(body, next) {
    state.busy = true;
    return WanderApi.request(body).then(function (r) { return handle(r, next, body); });
  }

  // Responses from the store. An answer always leads to a plain next screen. A store that could not be reached says so,
  // keeps what the client typed and offers a retry, a text and a call; a store that refused asks the client to check.
  function handle(response, next, body) {
    state.busy = false;
    if (response && response.ok) {
      state.failures = 0;
      state.avail = null;
      state.notice = response.message || null;
      return refresh().then(function () { next(response); });
    }
    if (WanderApi.unreachable(response)) return showFailure(body, next);
    return flash("That did not go through. Please check the details and try again, or ring us.");
  }

  function flash(text) {
    var old = app.querySelector(".notice");
    if (old) old.remove();
    var band = app.querySelector("header.band");
    var html = '<p class="notice" role="alert">' + esc(text) + "</p>";
    if (band) band.insertAdjacentHTML("afterend", html); else app.insertAdjacentHTML("afterbegin", html);
  }

  // What the client was asking for, in their own words, for the text they can send instead.
  function describeRequest(body) {
    var list = (state.session && state.session.bookings) || [];
    if (body.kind === "cancel") {
      var b = list.filter(function (x) { return x.id === body.bookingId; })[0];
      return "I would like to cancel my morning" + (b ? " on " + dayName(b.date) + " at " + clock(b.startTime) : "") + ".";
    }
    if (body.kind === "call") return "Please ring me" + (body.when ? ": " + body.when : "") + ".";
    var what = { hold: "book", change: "change my booking to", pack: "ask about a 4-Pack starting" }[body.kind] || "book";
    return "I tried to " + what + " " + dayName(body.date) + " at " + clock(body.startTime) + " for " + body.people + " people, " + body.hours +
      " hours" + (body.address ? " at " + body.address : "") + ", but your page would not go through.";
  }

  function showFailure(body, next) {
    state.failures += 1;
    var old = document.getElementById("fail");
    if (old) old.remove();
    var text = "Hi Wander, " + describeRequest(body);
    var html = '<section class="fail" id="fail" role="alert"><h2 class="rule">We could not confirm that</h2>' +
      "<p>" + (state.failures > 1 ? "Still not getting through. " : "") +
      "Our booking system is not answering, so we cannot tell whether your request reached us. Nothing has been charged, and your details are still here.</p>" +
      '<button type="button" class="go" id="retry">Try again</button>' +
      '<p class="note"><a href="sms:' + esc(window.WANDER_PHONE_LINK) + "?&body=" + encodeURIComponent(text) + '">Text us this request</a> or ' +
      '<a href="tel:' + esc(window.WANDER_PHONE_LINK) + '">ring us on ' + esc(window.WANDER_PHONE_DISPLAY) + "</a>.</p></section>";
    var band = app.querySelector("header.band");
    if (band) band.insertAdjacentHTML("afterend", html); else app.insertAdjacentHTML("afterbegin", html);
    // One orange action: while the retry is on screen, the button it replaces steps back.
    Array.prototype.forEach.call(app.querySelectorAll("button.go"), function (b) { if (b.id !== "retry") b.classList.add("ghost"); });
    var retry = document.getElementById("retry");
    retry.addEventListener("click", function () { if (!state.busy) send(body, next); });
    document.getElementById("fail").scrollIntoView({ block: "start" });
  }

  function uid() { return "req-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8); }

  function bind() {
    var reload = document.getElementById("reload");
    if (reload) reload.addEventListener("click", route);
    var book = document.getElementById("book") || document.getElementById("again");
    if (book) book.addEventListener("click", function () {
      if (state.busy) return;
      state.busy = true;
      track("cta", { v: "held" });
      state.lastHold = { date: book.dataset.date, startTime: book.dataset.start, people: Number(book.dataset.people),
        hours: Number(book.dataset.hours), address: book.dataset.address };
      send({ k: state.k, kind: "hold", requestId: uid(), date: state.lastHold.date, startTime: state.lastHold.startTime,
        people: state.lastHold.people, hours: state.lastHold.hours, address: state.lastHold.address,
        shownTotal: shownTotalFor(state.lastHold), shownFee: feeFor(book.dataset.start, Number(book.dataset.hours)) },
        function (resp) { showPage(renderUpgradeOrConfirm(resp)); });
    });
    var pick = document.getElementById("pick");
    if (pick) {
      pick.addEventListener("input", function () { updatePickPrice(); applyAvailability(); });
      pick.addEventListener("change", function () { updatePickPrice(); applyAvailability(); });
      document.getElementById("avail").addEventListener("click", function (ev) {
        var chip = ev.target.closest ? ev.target.closest("button[data-date]") : null;
        if (!chip) return;
        pick.date.value = chip.getAttribute("data-date");
        updatePickPrice();
        applyAvailability();
      });
      pick.addEventListener("submit", function (ev) {
        ev.preventDefault();
        if (state.busy) return;
        state.busy = true;
        var f = pick;
        var people = Number(f.people.value), hours = Number(f.hours.value), start = f.startTime.value;
        var b = bookingForRoute();
        state.lastHold = { date: f.date.value, startTime: start, people: people, hours: hours, address: f.address.value };
        var body = { k: state.k, requestId: uid(), date: f.date.value, startTime: start, people: people, hours: hours, address: f.address.value,
          shownTotal: (quoteFor(people, hours) || 0) + feeFor(start, hours), shownFee: feeFor(start, hours) };
        if (state.route.v === "change" && b) { body.kind = "change"; body.bookingId = b.id; }
        else { body.kind = "hold"; }
        track("cta", { v: body.kind });
        send(body, function (resp) { showPage(resp && resp.outcome === "held" ? renderUpgradeOrConfirm(resp) : renderConfirmed(resp)); });
      });
    }
    var yes = document.getElementById("pack-yes");
    if (yes) yes.addEventListener("click", function () {
      track("upgrade-accepted", {});
      var b = state.lastHold || {};
      send({ k: state.k, kind: "pack", requestId: uid(), date: b.date, startTime: b.startTime, people: b.people, hours: b.hours },
        function (resp) { showPage(renderConfirmed(resp)); });
    });
    var no = document.getElementById("pack-no");
    if (no) no.addEventListener("click", function () {
      track("upgrade-declined", {});
      showPage(renderConfirmed(null));
    });
    var ics = document.getElementById("ics");
    if (ics) ics.addEventListener("click", function () { track("calendar", {}); downloadIcs(); });
    var share = document.getElementById("share");
    if (share) share.addEventListener("click", function () {
      track("referral-shared", {});
      var link = referralLink();
      if (!link) return;
      var copy = function () {
        if (navigator.clipboard) navigator.clipboard.writeText(link).then(function () { share.textContent = "Link copied"; }, function () {});
      };
      if (navigator.share) {
        navigator.share({ title: "Wander Coffee Van", text: "A coffee van that comes to your team. Book a morning:", url: link }).catch(copy);
      } else {
        copy();
      }
    });
    var askCancel = document.getElementById("cancel-ask");
    if (askCancel) askCancel.addEventListener("click", function () { document.getElementById("cancel-confirm").hidden = false; askCancel.hidden = true; });
    var keep = document.getElementById("cancel-no");
    if (keep) keep.addEventListener("click", function () { document.getElementById("cancel-confirm").hidden = true; askCancel.hidden = false; });
    var cancelYes = document.getElementById("cancel-yes");
    if (cancelYes) cancelYes.addEventListener("click", function () {
      var b = (state.session.bookings || []).filter(function (x) { return x.id === state.route.b; })[0];
      send({ k: state.k, kind: "cancel", requestId: uid(), bookingId: b ? b.id : "" }, function () { go("bookings"); });
    });
    var call = document.getElementById("call");
    if (call) call.addEventListener("submit", function (ev) {
      ev.preventDefault();
      send({ k: state.k, kind: "call", requestId: uid(), when: call.when.value, note: call.note.value }, function () { go("home"); });
    });
  }

  // The price the page showed for this morning: the published table, or the quote the client was sent.
  function shownTotalFor(hold) {
    var base = quoteFor(hold.people, hold.hours);
    return base == null ? quoteOf() : base + feeFor(hold.startTime, hold.hours);
  }

  function quoteOf() {
    var q = state.session && state.session.quote;
    return q ? Number(q.total) + Number(q.fee || 0) : null;
  }

  // After a held date the 4-Pack is offered once. A request that is not held goes straight to what happens next.
  function renderUpgradeOrConfirm(response) {
    if (!response || response.outcome !== "held") return renderConfirmed(response);
    return renderUpgrade();
  }

  function downloadIcs() {
    var b = state.lastHold;
    if (!b) return;
    b = { id: "wander-" + b.date + "-" + b.startTime, date: b.date, startTime: b.startTime, endTime: endOf(b.startTime, b.hours), address: b.address, hours: b.hours };
    var stamp = b.date.replace(/-/g, "") + "T" + b.startTime.replace(":", "") + "00";
    var end = b.date.replace(/-/g, "") + "T" + (b.endTime || endOf(b.startTime, b.hours)).replace(":", "") + "00";
    var ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Wander Coffee Van//Customer Portal//EN", "BEGIN:VEVENT",
      "UID:" + b.id + "@wander", "DTSTART;TZID=Australia/Sydney:" + stamp, "DTEND;TZID=Australia/Sydney:" + end,
      "SUMMARY:Wander Coffee Van", "LOCATION:" + (b.address || ""), "END:VEVENT", "END:VCALENDAR"].join("\r\n");
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
    a.download = "wander-" + b.date + ".ics";
    a.click();
  }

  function refresh() {
    return WanderApi.session(state.k).then(function (s) {
      if (s && s.ok) state.session = s;
      return s;
    });
  }

  function route() {
    parseHash();
    if (!state.k) {
      showPage(shell('<section class="rise d1"><h2 class="rule">Open your link</h2><p>Your morning link is in the email we sent you. Open it from there and this page will know who you are.</p></section>'));
      return;
    }
    refresh().then(function (s) {
      if (WanderApi.unreachable(s)) {
        showPage(shell('<section class="fail"><h2 class="rule">We are not answering just yet</h2><p>Our booking system is not answering right now. Your link is fine. Try again in a minute, or ring us.</p>' +
          '<button type="button" class="go" id="reload">Try again</button></section>'));
        return;
      }
      if (!s || !s.ok) {
        showPage(shell('<section class="rise d1"><p>We could not open this link. Reply to our email and we will send you a new one.</p></section>'));
        return;
      }
      if (!state.prices) {
        // A price table that did not load is not remembered, so the next screen asks again.
        return WanderApi.prices().then(function (p) {
          if (p && p.ok) state.prices = p;
          showRoute();
        });
      }
      showRoute();
    });
  }

  function showRoute() {
    var v = state.route.v;
    var html;
    if (v === "pick" || v === "change") {
      var from = state.session.quote || lastCompleted();
      var seed = from ? { date: state.session.quote ? from.date : "", startTime: from.startTime || "09:00", people: from.people, hours: from.hours, address: from.address || "" }
        : { date: "", startTime: "09:00", people: 20, hours: 3, address: "" };
      if (!state.session.quote && from) seed = seedFrom(from);
      html = renderPick(v === "change" ? (bookingForRoute() || {}) : seed, v === "change" ? "change" : "new");
    }
    else if (v === "bookings") html = renderBookings();
    else if (v === "booking") html = renderBooking();
    else if (v === "pack") html = renderPack();
    else if (v === "compare") html = renderCompare();
    else if (v === "refer") html = renderRefer();
    else if (v === "call") html = renderCall();
    else if (v === "confirmed") html = renderConfirmed(null);
    else html = renderHome();
    state.notice = state.notice && v !== "home" ? state.notice : null;
    showPage(html);
  }

  window.addEventListener("hashchange", route);
  document.addEventListener("DOMContentLoaded", route);
  if (document.readyState !== "loading") route();
})();
