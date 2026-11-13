// Client dashboard rules, pure and dependency-free. Every decision here is one the dashboard can make without Sam,
// or one that becomes a request to Sam. Prices are never computed here: they come from Coffee Van's quote.
// Source: docs/superpowers/specs/2026-11-13-client-dashboard-design.md, sections 6 and 7.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.WanderRules = api;
})(typeof self !== "undefined" ? self : this, function () {
  const STANDARD_START = "07:00";
  const STANDARD_END = "16:00";
  const DEFAULT_START = "09:00";
  const OUT_OF_HOURS_FEE_PER_HOUR = 35;
  const TRAVEL_FREE_KM_ONE_WAY = 50;
  const NOTICE_HOURS = 24;
  const SHORT_NOTICE_WINDOW_HOURS = 48;
  const REPLY_HOURS = 24;
  const SHORT_REPLY_HOURS = 2;
  const VAN_GAP_MINUTES = 60; // travel between two bookings on one van (to confirm)

  function minutesOf(hhmm) {
    const m = /^(\d{2}):(\d{2})$/.exec(hhmm || "");
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  }

  // Fee for a morning that starts at `start` and runs `hours`: each started hour outside the standard window costs
  // OUT_OF_HOURS_FEE_PER_HOUR. Returns { fee, startedHours } and never throws; an unreadable time is { fee: 0, startedHours: 0 }.
  function outOfHoursFee(start, hours) {
    const from = minutesOf(start);
    const h = Number(hours);
    if (from === null || !(h > 0)) return { fee: 0, startedHours: 0 };
    const to = from + Math.round(h * 60);
    const lo = minutesOf(STANDARD_START), hi = minutesOf(STANDARD_END);
    let outside = 0;
    for (let m = from; m < to; m++) if (m < lo || m >= hi) outside++;
    const startedHours = Math.ceil(outside / 60);
    return { fee: startedHours * OUT_OF_HOURS_FEE_PER_HOUR, startedHours };
  }

  // Hours inside which a reply is promised: 24 normally, 2 when the booking is within 48 hours of the request.
  function replyWithinHours(requestedAtIso, eventStartIso) {
    const requested = Date.parse(requestedAtIso), event = Date.parse(eventStartIso);
    if (Number.isNaN(requested) || Number.isNaN(event)) return REPLY_HOURS;
    const hoursAway = (event - requested) / 3600000;
    return hoursAway <= SHORT_NOTICE_WINDOW_HOURS ? SHORT_REPLY_HOURS : REPLY_HOURS;
  }

  // Whole hours from `nowIso` to the booking's start.
  function noticeHours(nowIso, startIso) {
    return (Date.parse(startIso) - Date.parse(nowIso)) / 3600000;
  }

  // A proposed start is free when no other booking on the van overlaps it, with a gap for travel either side.
  // `bookings` are { date, startTime, endTime } for the same day; times are "HH:MM".
  function slotIsFree(date, startTime, hours, bookings) {
    const from = minutesOf(startTime);
    if (from === null) return false;
    const to = from + Math.round(hours * 60);
    return bookings
      .filter((b) => b.date === date && minutesOf(b.startTime) !== null)
      .every((b) => {
        const bFrom = minutesOf(b.startTime);
        const bTo = minutesOf(b.endTime) ?? bFrom + 60;
        return to + VAN_GAP_MINUTES <= bFrom || from >= bTo + VAN_GAP_MINUTES;
      });
  }

  // A change to a confirmed booking. The system applies it at once when all three hold, and otherwise asks Sam:
  // the new slot is free, the address is inside free travel, and the notice is 24 hours or more.
  // `change`: { date, startTime, hours, travelKm }. `others`: the van's other bookings. Returns { decision, reasons }.
  function decideChange(booking, change, others, nowIso) {
    const reasons = [];
    const startIso = `${booking.date}T${booking.startTime || DEFAULT_START}:00`;
    if (noticeHours(nowIso, startIso) < NOTICE_HOURS) reasons.push("less than 24 hours' notice");
    if (!slotIsFree(change.date, change.startTime, change.hours, others)) reasons.push("the new time is not free on the van");
    if (Number(change.travelKm) > TRAVEL_FREE_KM_ONE_WAY) reasons.push("the address is beyond free travel");
    return reasons.length === 0 ? { decision: "apply", reasons } : { decision: "request", reasons };
  }

  // Cancelling 24 hours or more ahead gives the full amount as a credit; less than that is asked of Sam.
  function decideCancel(booking, nowIso) {
    const startIso = `${booking.date}T${booking.startTime || DEFAULT_START}:00`;
    return noticeHours(nowIso, startIso) >= NOTICE_HOURS
      ? { decision: "credit", reasons: [] }
      : { decision: "request", reasons: ["less than 24 hours' notice"] };
  }

  return {
    STANDARD_START, STANDARD_END, DEFAULT_START, OUT_OF_HOURS_FEE_PER_HOUR, TRAVEL_FREE_KM_ONE_WAY,
    NOTICE_HOURS, VAN_GAP_MINUTES,
    outOfHoursFee, replyWithinHours, slotIsFree, decideChange, decideCancel,
  };
});
