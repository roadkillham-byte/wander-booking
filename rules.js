// Client dashboard rules: pure, dependency-free, and free of prices. Every decision is either one the system can make
// without Sam, or a request to Sam. Prices and the out-of-hours fee come from Coffee Van (docs/contract.md, prices).
// All wall-clock times are Australia/Sydney, converted to instants explicitly so a browser, Node or Apps Script in another
// zone gives the same answer.
// Source: docs/superpowers/specs/2026-11-13-client-dashboard-design.md, sections 6 and 7.
// Plain script: a global `WanderRules` in the browser and Apps Script, and a module export under Node.
var WanderRules = (function () {
  const ZONE = "Australia/Sydney";
  const DEFAULT_START = "09:00";
  const TRAVEL_FREE_KM_ONE_WAY = 50;
  const NOTICE_HOURS = 24;
  const SHORT_NOTICE_WINDOW_HOURS = 48;
  const REPLY_HOURS = 24;
  const SHORT_REPLY_HOURS = 2;
  const VAN_GAP_MINUTES = 60; // travel between two bookings on one van (to confirm with Sam)
  const STALE_AFTER_HOURS = 6;

  const partsFormat = new Intl.DateTimeFormat("en-AU", {
    timeZone: ZONE, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });

  function minutesOf(hhmm) {
    const m = /^(\d{2}):(\d{2})$/.exec(hhmm || "");
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  }

  // Milliseconds since the epoch of a Sydney wall-clock date and time ("YYYY-MM-DD", "HH:MM").
  // The offset is read from the zone itself for that instant, so daylight saving is right on both sides of the change.
  function sydneyEpoch(date, hhmm) {
    const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || "");
    const mins = minutesOf(hhmm);
    if (!d || mins === null) return NaN;
    const wall = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Math.floor(mins / 60), mins % 60, 0);
    let guess = wall;
    for (let i = 0; i < 2; i++) {
      const p = {};
      for (const part of partsFormat.formatToParts(new Date(guess))) p[part.type] = part.value;
      const seen = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
      guess += wall - seen;
    }
    return guess;
  }

  // An ISO instant. With no offset, the text is read as Sydney wall-clock time, never as the machine's zone.
  function instantOf(iso) {
    if (typeof iso !== "string") return NaN;
    const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(iso.trim());
    if (!m) return NaN;
    if (m[3]) return Date.parse(iso.trim());
    return sydneyEpoch(m[1], m[2]);
  }

  // Hours from `nowIso` to the booking's start (Sydney).
  function noticeHours(nowIso, date, startTime) {
    return (sydneyEpoch(date, startTime || DEFAULT_START) - instantOf(nowIso)) / 3600000;
  }

  // The reply promise: 24 hours, or 2 when the event is within 48 hours of the request.
  function replyWithinHours(requestedAtIso, date, startTime) {
    const hoursAway = noticeHours(requestedAtIso, date, startTime);
    if (Number.isNaN(hoursAway)) return REPLY_HOURS;
    return hoursAway <= SHORT_NOTICE_WINDOW_HOURS ? SHORT_REPLY_HOURS : REPLY_HOURS;
  }

  // A slot is free when no other booking on the van overlaps it, with a gap for travel either side.
  // `bookings` are { date, startTime, endTime } for the day; times are "HH:MM".
  function slotIsFree(date, startTime, hours, bookings) {
    const from = minutesOf(startTime);
    if (from === null || !(Number(hours) > 0)) return false;
    const to = from + Math.round(Number(hours) * 60);
    return (bookings || [])
      .filter((b) => b.date === date && minutesOf(b.startTime) !== null)
      .every((b) => {
        const bFrom = minutesOf(b.startTime);
        const bTo = minutesOf(b.endTime) ?? bFrom + 60;
        return to + VAN_GAP_MINUTES <= bFrom || from >= bTo + VAN_GAP_MINUTES;
      });
  }

  // Availability older than six hours is stale: a client's pick then becomes a request, never an automatic yes.
  function isStale(asOfIso, nowIso) {
    const asOf = instantOf(asOfIso), now = instantOf(nowIso);
    if (Number.isNaN(asOf) || Number.isNaN(now)) return true;
    return (now - asOf) / 3600000 > STALE_AFTER_HOURS;
  }

  // Hold: applied at once ("held") only when the slot is free, the availability is fresh and the notice is at least
  // 24 hours. Anything else is a request. Never an error.
  // `others` are the van's busy times plus holds still waiting, so two clients cannot take one slot.
  function decideHold(request, others, asOfIso, nowIso) {
    const reasons = [];
    if (isStale(asOfIso, nowIso)) reasons.push("availability is out of date");
    if (noticeHours(nowIso, request.date, request.startTime) < NOTICE_HOURS) reasons.push("less than 24 hours' notice");
    if (!slotIsFree(request.date, request.startTime, request.hours, others)) reasons.push("the time is not free on the van");
    if (Number(request.travelKm || 0) > TRAVEL_FREE_KM_ONE_WAY) reasons.push("the address is beyond free travel");
    return { decision: reasons.length === 0 ? "held" : "requested", reasons };
  }

  // A change to a confirmed booking is applied at once when the new slot is free, the address is inside free travel,
  // and the notice is 24 hours or more. Otherwise it is asked of Sam.
  function decideChange(booking, change, others, asOfIso, nowIso) {
    const reasons = [];
    if (isStale(asOfIso, nowIso)) reasons.push("availability is out of date");
    if (noticeHours(nowIso, booking.date, booking.startTime) < NOTICE_HOURS) reasons.push("less than 24 hours' notice");
    if (!slotIsFree(change.date, change.startTime, change.hours, others)) reasons.push("the new time is not free on the van");
    if (Number(change.travelKm || 0) > TRAVEL_FREE_KM_ONE_WAY) reasons.push("the address is beyond free travel");
    return { decision: reasons.length === 0 ? "applied" : "requested", reasons };
  }

  // Cancelling 24 hours or more ahead is promised a credit of the full amount. The amount credit is not built yet,
  // so every cancellation is a request for Sam to confirm the credit (docs/contract.md, Requests).
  function decideCancel(booking, nowIso) {
    const reasons = noticeHours(nowIso, booking.date, booking.startTime) >= NOTICE_HOURS ? [] : ["less than 24 hours' notice"];
    return { decision: "requested", reasons };
  }

  // "Same again": the last completed morning's date plus 28 days, moved forward a week at a time until it is at least
  // 3 days after today. It keeps the weekday of the last morning. UTC date arithmetic only, so no zone can shift it.
  function sameAgainDate(lastDateIso, todayIso) {
    const last = /^(\d{4})-(\d{2})-(\d{2})$/.exec(lastDateIso || "");
    const today = /^(\d{4})-(\d{2})-(\d{2})$/.exec(todayIso || "");
    if (!last || !today) return "";
    const DAY = 86400000;
    let date = Date.UTC(Number(last[1]), Number(last[2]) - 1, Number(last[3])) + 28 * DAY;
    const floor = Date.UTC(Number(today[1]), Number(today[2]) - 1, Number(today[3])) + 3 * DAY;
    while (date < floor) date += 7 * DAY;
    return new Date(date).toISOString().slice(0, 10);
  }

  return {
    sameAgainDate,
    ZONE, DEFAULT_START, TRAVEL_FREE_KM_ONE_WAY, NOTICE_HOURS, VAN_GAP_MINUTES, STALE_AFTER_HOURS,
    sydneyEpoch, instantOf, noticeHours, replyWithinHours, slotIsFree, isStale, decideHold, decideChange, decideCancel,
  };
})();
if (typeof module === "object" && module.exports) module.exports = WanderRules;
