// The pre-order page for a confirmed morning (#p=<key>). The office manager forwards the link; each person on the team picks a
// drink, milk and bowl, so the van knows what to prep. The link carries its own key, never the client's: it cannot change or
// cancel anything. A person edits only their own pick (the browser keeps its id); nobody sees anyone else's.
var WanderPreorder = (function () {
  "use strict";
  var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function keyFrom(hash) { return new URLSearchParams(String(hash || "").replace(/^#/, "")).get("p") || ""; }
  function active(hash) { return keyFrom(hash) !== ""; }
  function dayLabel(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
    if (!m) return "";
    var d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    return DAYS[d.getUTCDay()] + " " + Number(m[3]) + " " + MONTHS[Number(m[2]) - 1];
  }
  function clock(hhmm) {
    var m = /^(\d{2}):(\d{2})$/.exec(hhmm || "");
    if (!m) return "";
    var h = Number(m[1]);
    return (h % 12 === 0 ? 12 : h % 12) + (m[2] === "00" ? "" : ":" + m[2]) + (h < 12 ? " am" : " pm");
  }
  function cutoffLabel(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "6 pm the day before";
    var parts = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit", hour12: true }).format(d);
    return parts.replace(/,/g, "");
  }

  var KEEP = "wander.po.";
  function remembered(pk) { try { return window.localStorage.getItem(KEEP + pk) || ""; } catch (e) { return ""; } }
  function remember(pk, id) { try { window.localStorage.setItem(KEEP + pk, id); } catch (e) { /* the pick is saved; this browser just will not offer to edit it */ } }

  function band(greet) {
    return '<header class="band rise"><img src="assets/wander-logo.png" alt="Wander Coffee Van"><h1>Come Find Us</h1>' +
      (greet ? '<p class="greet">' + esc(greet) + "</p>" : "") + "</header>";
  }
  function select(name, label, list, value) {
    return "<label>" + esc(label) + '<select name="' + name + '" required><option value="">Choose…</option>' +
      list.map(function (v) { return '<option value="' + esc(v) + '"' + (v === value ? " selected" : "") + ">" + esc(v) + "</option>"; }).join("") + "</select></label>";
  }
  function ticket(s) {
    var b = s.booking;
    return '<section class="ticket rise d1"><dl><dt>Day</dt><dd>' + esc(dayLabel(b.date)) + "</dd><dt>Time</dt><dd>" + esc(clock(b.startTime)) + " to " + esc(clock(b.endTime)) + "</dd></dl></section>";
  }
  function summary(p) {
    if (!p) return "";
    return '<p class="word" id="mine">Your order: <b>' + esc(p.drink) + "</b>, " + esc(p.milk) + ", " + esc(p.bowl) + (p.firstName ? " (" + esc(p.firstName) + ")" : "") + ".</p>";
  }

  function page(s, pk, notice) {
    var mine = s.mine;
    var closed = !s.open;
    var form = closed ? "" :
      '<form id="preorder" class="stack rise d2" novalidate>' +
      '<label>Your first name (optional)<input name="firstName" maxlength="30" autocomplete="given-name" value="' + esc(mine ? mine.firstName : "") + '"></label>' +
      select("drink", "Your drink", s.menu.drinks, mine ? mine.drink : "") +
      select("milk", "Your milk", s.menu.milks, mine ? mine.milk : "") +
      select("bowl", "Your bowl", s.menu.bowls, mine ? mine.bowl : "") +
      '<label>Allergies or anything we should know (optional)<textarea name="note" maxlength="120" rows="2">' + esc(mine ? mine.note : "") + "</textarea></label>" +
      '<button type="submit" class="go" id="save">' + (mine ? "Update my order" : "Save my order") + "</button>" +
      '<p class="note">You can change it until ' + esc(cutoffLabel(s.cutoffAt)) + ". After that, just walk up on the day: we will look after you.</p>" +
      '<p class="note">We use your name and order only to get your morning ready, and we delete them a week after the morning.</p></form>';
    var closedNote = closed
      ? '<section class="notice rise d2" role="status">Orders for this morning have closed. Just walk up on the day: we will look after you.</section>' : "";
    return band(closed ? "Orders are closed" : "Pick your order") + (notice ? '<p class="notice" role="status">' + esc(notice) + "</p>" : "") +
      ticket(s) + closedNote + '<section class="rise d2">' + summary(mine) + "</section>" + form;
  }

  function failure(msg) {
    return band("") + '<section class="fail"><h2 class="rule">' + esc(msg.title) + "</h2><p>" + esc(msg.body) + "</p></section>";
  }

  var ERRORS = {
    closed: "Orders have just closed for this morning. Just walk up on the day: we will look after you.",
    full: "This morning's list is full. Just walk up on the day: we will look after you.",
    "bad-pick": "One of those is not on our list. Please choose again.",
  };

  function show(app) {
    var pk = keyFrom(location.hash);
    app.innerHTML = band("") + '<section class="rise d1"><p>One moment…</p></section>';
    WanderApi.preorderSession(pk, remembered(pk)).then(function (s) {
      if (WanderApi.unreachable(s)) {
        app.innerHTML = failure({ title: "We are not answering just yet", body: "Our system is not answering right now. Your link is fine. Try again in a minute." });
        return;
      }
      if (!s || !s.ok) {
        app.innerHTML = failure({ title: "We could not open this link", body: "Ask whoever organised the morning to send you the link again." });
        return;
      }
      draw(app, s, pk, "");
    });
  }

  function draw(app, s, pk, notice) {
    app.innerHTML = page(s, pk, notice);
    var form = document.getElementById("preorder");
    if (!form) return;
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var body = { pk: pk, pickId: remembered(pk), firstName: form.firstName.value, drink: form.drink.value, milk: form.milk.value, bowl: form.bowl.value, note: form.note.value };
      if (!body.drink || !body.milk || !body.bowl) { draw(app, s, pk, "Please choose a drink, a milk and a bowl."); return; }
      document.getElementById("save").disabled = true;
      WanderApi.preorderPick(body).then(function (r) {
        if (WanderApi.unreachable(r)) { draw(app, s, pk, "We could not save that just now. Please try again in a minute."); return; }
        if (!r.ok) {
          if (r.error === "closed") { s.open = false; }
          draw(app, s, pk, ERRORS[r.error] || "We could not save that. Please try again.");
          return;
        }
        remember(pk, r.pickId);
        s.mine = r.pick;
        draw(app, s, pk, "Saved. We will have it ready for you.");
      });
    });
  }

  return { active: active, show: show, keyFrom: keyFrom, dayLabel: dayLabel, clock: clock };
})();
if (typeof module === "object" && module.exports) module.exports = WanderPreorder;
