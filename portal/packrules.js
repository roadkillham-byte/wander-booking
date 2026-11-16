// Vendored from the Coffee Van app (server/packRules.mjs, branch fourpack-v2-app, 16 Nov 2026): the 4-Pack v2 capacity, notice, pause and
// first-pick rules, so the page, the store and the app can never disagree. Plain script wrapped for the browser and Apps Script (no ESM).
// DO NOT EDIT HERE: change the app's file and re-vendor with the same transformation; packrules.test.js pins the behaviour (and compares
// against the app's file when PACKRULES_SOURCE points at it).
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.WanderPackRules = api;
})(typeof self !== "undefined" ? self : this, function () {
  // 4-Pack v2 capacity rules (Wander, 16 Nov 2026). Pure functions, no I/O, no clock: every function takes what it needs.
  // Source: the vault note "Wander 4-Pack Appeal Brainstorm", section 3, and Sam's approvals of 16 Nov 2026. Every rule is
  // documented in packRules.d.ts. Plain ESM so the Coffee Van app, the local server and the wander-booking store can all import it.
  //
  // Days are calendar days (YYYY-MM-DD) worked out with UTC arithmetic, so the result never depends on the machine's time zone.
  // Sydney time (Australia/Sydney, with daylight saving) is used only where an instant or "today" has to be turned into a day.

  const STANDING_MAX_PER_WEEK = 4;
  const STANDING_MAX_PER_WEEKDAY = 2;
  const STANDING_MAX_SHARE_PERCENT = 40;
  /** Section 3 planning assumption (unsure): two 2-hour mornings a day, five days a week. */
  const PLANNED_MORNINGS_PER_WEEK = 10;
  const FIRST_PICK_DAYS = 3;
  const PACK_NOTICE_HOURS = 12;
  const SINGLE_NOTICE_HOURS = 24;
  const SHORT_NOTICE_MAX_PER_WEEK = 2;
  const PAUSE_MAX_DAYS = 42;
  const PAUSE_NOTICE_DAYS = 7;
  const STANDING_CONFIRM_DAYS = 7;

  const TIME_ZONE = "Australia/Sydney";
  const DAY_MS = 86400000;
  const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

  function utcOf(iso) {
    return Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
  }

  /** True for a real calendar day written YYYY-MM-DD. */
  function isIsoDay(value) {
    if (typeof value !== "string" || !ISO_DAY.test(value)) return false;
    return new Date(utcOf(value)).toISOString().slice(0, 10) === value;
  }

  /** The day `n` calendar days after `iso` (negative goes back). Null for a bad day. */
  function addDaysIso(iso, n) {
    if (!isIsoDay(iso) || !Number.isInteger(n)) return null;
    return new Date(utcOf(iso) + n * DAY_MS).toISOString().slice(0, 10);
  }

  /** Whole calendar days from `from` to `to` (negative when `to` is earlier). Null for a bad day. */
  function daysBetween(from, to) {
    if (!isIsoDay(from) || !isIsoDay(to)) return null;
    return Math.round((utcOf(to) - utcOf(from)) / DAY_MS);
  }

  /** 0 Sunday ... 6 Saturday, or null for a bad day. */
  function weekdayOf(iso) {
    if (!isIsoDay(iso)) return null;
    return new Date(utcOf(iso)).getUTCDay();
  }

  /** The Monday of the week `iso` falls in (the week runs Monday to Sunday). */
  function weekStart(iso) {
    const wd = weekdayOf(iso);
    if (wd === null) return null;
    return addDaysIso(iso, -((wd + 6) % 7));
  }

  const sydneyParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  function sydneyFields(ms) {
    const out = {};
    for (const p of sydneyParts.formatToParts(new Date(ms))) out[p.type] = p.value;
    return out;
  }

  /**
   * The Sydney calendar day of a value: a YYYY-MM-DD day is returned as it is, an instant (ISO date-time with a zone, or a
   * number of milliseconds) is converted. Null when it is neither.
   */
  function sydneyDay(value) {
    if (typeof value === "string" && isIsoDay(value)) return value;
    let ms = Number.NaN;
    if (typeof value === "number") ms = value;
    else if (typeof value === "string" && value.length > 10) ms = Date.parse(value);
    if (!Number.isFinite(ms)) return null;
    const f = sydneyFields(ms);
    return `${f.year}-${f.month}-${f.day}`;
  }

  /** The instant (ms) at which `day` begins in Sydney. Midnight is never inside the 2am/3am clock change, so exactly one offset fits. */
  function sydneyMidnightMs(day) {
    const base = utcOf(day);
    for (const offsetHours of [11, 10]) {
      const ms = base - offsetHours * 3600000;
      const f = sydneyFields(ms);
      if (`${f.year}-${f.month}-${f.day}` === day && f.hour === "00" && f.minute === "00") return ms;
    }
    return null;
  }

  function weekdayFrom(entry) {
    if (typeof entry !== "object" || entry === null) return null;
    if (typeof entry.date === "string") return weekdayOf(entry.date);
    if (Number.isInteger(entry.weekday) && entry.weekday >= 0 && entry.weekday <= 6) return entry.weekday;
    return null;
  }

  const refuse = (code, reason, extra = {}) => ({ ok: false, code, reason, ...extra });

  /**
   * Whether one more standing morning fits in a week.
   * `existingStanding`: the standing mornings already held in the SAME Monday-to-Sunday week, across all packs, each `{ weekday }`
   * (0 Sunday ... 6 Saturday) or `{ date }`. `candidate`: the same shape. `plannedMornings`: how many mornings the van plans that week
   * (PLANNED_MORNINGS_PER_WEEK when nothing better is known).
   */
  function standingCapacity(existingStanding, candidate, plannedMornings) {
    const weekday = weekdayFrom(candidate);
    if (weekday === null) return refuse("invalid", "That standing morning has no valid weekday.");
    if (typeof plannedMornings !== "number" || !Number.isFinite(plannedMornings) || plannedMornings < 0) {
      return refuse("invalid", "The number of mornings planned for that week is not a valid number.");
    }
    const planned = Math.floor(plannedMornings);
    if (planned === 0) return refuse("no-mornings", "No mornings are planned that week, so nothing can be held.");
    const held = (Array.isArray(existingStanding) ? existingStanding : []).map(weekdayFrom).filter((w) => w !== null);
    if (held.length + 1 > STANDING_MAX_PER_WEEK) {
      return refuse("week-full", `Four standing mornings are already held that week, which is the most the van holds.`);
    }
    const sameDay = held.filter((w) => w === weekday).length;
    if (sameDay + 1 > STANDING_MAX_PER_WEEKDAY) {
      return refuse("weekday-full", `Two standing mornings are already held on that ${WEEKDAY_NAMES[weekday]}, which is the most for one weekday.`);
    }
    // Whole-number test of "never more than 40%": (held + 1) / planned <= 40 / 100.
    if ((held.length + 1) * 100 > planned * STANDING_MAX_SHARE_PERCENT) {
      return refuse("share", `Standing mornings would pass 40% of the ${planned} mornings planned that week.`);
    }
    return { ok: true, code: "ok", reason: "Fits: the week stays within the standing limits." };
  }

  /**
   * The Sydney day on which pack holders can first see a date that the public first sees on `publicOpensOn`: three calendar days
   * earlier. Null for a bad day.
   */
  function firstPickOpenDay(publicOpensOn) {
    return addDaysIso(publicOpensOn, -FIRST_PICK_DAYS);
  }

  /**
   * The instant (ISO UTC string) at which pack holders can first see a date the public first sees on `publicOpensOn`: the start of
   * that Sydney day three calendar days earlier. Calendar days, not 72 hours, so it is correct either side of a clock change.
   */
  function firstPickOpensAt(publicOpensOn) {
    const day = firstPickOpenDay(publicOpensOn);
    if (day === null) return null;
    const ms = sydneyMidnightMs(day);
    return ms === null ? null : new Date(ms).toISOString();
  }

  /** True when `now` (an instant) is at or after the moment pack holders can see a date the public sees on `publicOpensOn`. */
  function isFirstPickOpen(publicOpensOn, now) {
    const opens = firstPickOpensAt(publicOpensOn);
    const at = typeof now === "number" ? now : typeof now === "string" ? Date.parse(now) : Number.NaN;
    if (opens === null || !Number.isFinite(at)) return false;
    return at >= Date.parse(opens);
  }

  /**
   * How a booking made `hoursAhead` of the morning is handled.
   * Singles: 24 hours' notice, otherwise a request. Pack holders: 12 hours' notice, held straight away, but at most two such short
   * notice bookings a week across all packs (`urgentThisWeek` is how many are already used); beyond that it is a request.
   * `outcome` is "hold" (held straight away, if the van is free) or "request" (Sam decides). `shortNotice` says the booking used
   * the pack holder's 12-hour allowance and so must be counted against the week's two.
   */
  function noticeAllowed(input) {
    const { hoursAhead, isPackHolder, urgentThisWeek } = input ?? {};
    const request = (reason) => ({ ok: false, outcome: "request", shortNotice: false, reason });
    if (typeof hoursAhead !== "number" || !Number.isFinite(hoursAhead) || hoursAhead < 0) {
      return request("The time until the morning could not be worked out, so it goes in as a request.");
    }
    if (hoursAhead >= SINGLE_NOTICE_HOURS) return { ok: true, outcome: "hold", shortNotice: false, reason: "Normal notice." };
    if (!isPackHolder) return request("Under 24 hours' notice goes in as a request.");
    if (hoursAhead < PACK_NOTICE_HOURS) return request("Under 12 hours' notice goes in as a request, even for a pack holder.");
    const used = urgentThisWeek === undefined ? 0 : urgentThisWeek;
    if (typeof used !== "number" || !Number.isFinite(used) || used < 0) {
      return request("The short-notice count for the week could not be checked, so it goes in as a request.");
    }
    if (used >= SHORT_NOTICE_MAX_PER_WEEK) {
      return request("Two short-notice mornings are already held this week across all packs, so this goes in as a request.");
    }
    return { ok: true, outcome: "hold", shortNotice: true, reason: "12 hours' notice for a pack holder, held straight away." };
  }

  /**
   * Whether a pack can be paused. Up to 42 days (6 weeks) in total per term, with at least 7 days' notice. `pausedDaysSoFar` is
   * what the term has used already; `requestDays` the new pause; `noticeDays` how many days before the pause starts it was asked.
   * `remainingDays` is what is left of the 42 after the request when it is allowed, and what is left now when it is refused.
   */
  function pauseAllowed(input) {
    const { requestDays, noticeDays } = input ?? {};
    const soFarRaw = input?.pausedDaysSoFar === undefined ? 0 : input.pausedDaysSoFar;
    const bad = (reason) => refuse("invalid", reason, { remainingDays: 0, totalPausedDays: 0 });
    if (typeof soFarRaw !== "number" || !Number.isInteger(soFarRaw) || soFarRaw < 0) return bad("The days already paused are not a valid number.");
    const remaining = Math.max(0, PAUSE_MAX_DAYS - soFarRaw);
    if (typeof requestDays !== "number" || !Number.isInteger(requestDays) || requestDays < 1) {
      return refuse("invalid", "A pause must be a whole number of days, at least one.", { remainingDays: remaining, totalPausedDays: soFarRaw });
    }
    if (typeof noticeDays !== "number" || !Number.isFinite(noticeDays)) {
      return refuse("invalid", "The notice given could not be worked out.", { remainingDays: remaining, totalPausedDays: soFarRaw });
    }
    if (noticeDays < PAUSE_NOTICE_DAYS) {
      return refuse("notice", "A pause needs at least 7 days' notice.", { remainingDays: remaining, totalPausedDays: soFarRaw });
    }
    if (requestDays > remaining) {
      return refuse(
        "too-long",
        remaining === 0
          ? "All 42 days of pause for this term are already used."
          : `That is longer than the pause left for this term: ${remaining} days of the 42 days remain.`,
        { remainingDays: remaining, totalPausedDays: soFarRaw },
      );
    }
    return { ok: true, code: "ok", reason: "Pause allowed.", remainingDays: remaining - requestDays, totalPausedDays: soFarRaw + requestDays };
  }

  /**
   * Whether a standing morning that has not been confirmed must go back on sale. `standingBooking` is `{ date, confirmed, released? }`.
   * The client has until the end of the day 7 days before the morning to confirm with one tap (so confirming exactly 7 days out is
   * in time); from the next day it is due for release. `today` is a day or an instant (read as a Sydney day). Nothing is deleted:
   * release is a state the caller records. Bad data never releases a morning.
   */
  function standingReleaseDue(standingBooking, today) {
    const no = (reason) => ({ due: false, deadline: null, daysOut: null, reason });
    const date = standingBooking?.date;
    const day = sydneyDay(today);
    if (!isIsoDay(date) || day === null) return no("The date could not be read, so nothing is released.");
    const deadline = addDaysIso(date, -STANDING_CONFIRM_DAYS);
    const daysOut = daysBetween(day, date);
    if (standingBooking.confirmed === true) return { due: false, deadline, daysOut, reason: "Confirmed." };
    if (standingBooking.released === true) return { due: false, deadline, daysOut, reason: "Already released." };
    if (day > deadline) return { due: true, deadline, daysOut, reason: "Not confirmed 7 days out: back on sale." };
    return { due: false, deadline, daysOut, reason: "Waiting for the client to confirm." };
  }

  return { STANDING_MAX_PER_WEEK, STANDING_MAX_PER_WEEKDAY, STANDING_MAX_SHARE_PERCENT, PLANNED_MORNINGS_PER_WEEK, FIRST_PICK_DAYS, PACK_NOTICE_HOURS, SINGLE_NOTICE_HOURS, SHORT_NOTICE_MAX_PER_WEEK, PAUSE_MAX_DAYS, PAUSE_NOTICE_DAYS, STANDING_CONFIRM_DAYS, isIsoDay, addDaysIso, daysBetween, weekdayOf, weekStart, sydneyDay, standingCapacity, firstPickOpenDay, firstPickOpensAt, isFirstPickOpen, noticeAllowed, pauseAllowed, standingReleaseDue };
});
