// First-party page tracker for Wander's booking pages. It is inert unless an events URL and site key are set in
// config.js, and it sends nothing when the visitor's browser says Do Not Track or Global Privacy Control.
// It records what a visitor did on our own pages (never what they typed), with a random visitor id kept in
// localStorage. No third parties, no fingerprinting. See privacy.html and the data layer plan.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.WanderTrack = api;
})(typeof self !== "undefined" ? self : this, function () {
  const MAX_STR = 40, MAX_BATCH = 20;
  // type -> field -> kind (s string, n number, b boolean). This is the shared event contract.
  const CONTRACT = {
    view: { path: "s", ref: "s", us: "s", um: "s", uc: "s", rc: "s", dev: "s", lang: "s", tzo: "n", lh: "n", vn: "n", x: "s" },
    calc: { p: "n", h: "n" },
    price: { p: "n", h: "n", ms: "n" },
    pack: { p: "n", h: "n" },
    scroll: { pct: "n" },
    cta: { form: "b" },
    leave: { act: "n", max: "n" },
    click: { to: "s", r: "s" },
    tap: { q: "s", a: "s", r: "s" },
  };
  const REF_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

  function sanitise(type, data) {
    const fields = CONTRACT[type];
    if (!fields) return null;
    const d = {};
    for (const key of Object.keys(fields)) {
      const v = data && data[key];
      if (v === undefined || v === null || v === "") continue;
      if (fields[key] === "s") d[key] = String(v).slice(0, MAX_STR);
      else if (fields[key] === "n") { const n = Number(v); if (Number.isFinite(n)) d[key] = Math.round(n); }
      else d[key] = Boolean(v);
    }
    return { t: type, d };
  }

  function normaliseRef(raw) {
    const s = String(raw || "").toUpperCase().replace(/[\s-]/g, "");
    if (s.length !== 8 || [...s].some((c) => !REF_ALPHABET.includes(c))) return null;
    return s.slice(0, 4) + "-" + s.slice(4);
  }

  function buildView(o) {
    const params = new URLSearchParams(o.search || "");
    const d = { path: o.path, lang: o.lang, tzo: o.tzo, lh: o.hour, vn: o.vn, x: o.x };
    if (params.get("utm_source")) d.us = params.get("utm_source");
    if (params.get("utm_medium")) d.um = params.get("utm_medium");
    if (params.get("utm_campaign")) d.uc = params.get("utm_campaign");
    const rc = normaliseRef(params.get("ref"));
    if (rc) d.rc = rc;
    try { if (o.referrer) d.ref = new URL(o.referrer).hostname; } catch (e) { /* ignore a bad referrer */ }
    const w = Number(o.width) || 0;
    d.dev = o.coarse && w < 700 ? "m" : o.coarse && w < 1100 ? "t" : "d";
    return d;
  }

  function safeStore(store) {
    const mem = new Map();
    return {
      get(k) { try { const v = store.getItem(k); if (v !== null) return v; } catch (e) { /* blocked */ } return mem.has(k) ? mem.get(k) : null; },
      set(k, v) { mem.set(k, String(v)); try { store.setItem(k, String(v)); } catch (e) { /* blocked or full */ } },
    };
  }

  function createTracker(opts) {
    const nav = opts.nav || {};
    const respect = opts.respectDnt !== false;
    const dnt = nav.doNotTrack === "1" || nav.doNotTrack === 1 || nav.globalPrivacyControl === true;
    const enabled = Boolean(opts.url && opts.siteKey) && !(respect && dnt);
    const random = opts.random || Math.random;
    const now = opts.now || Date.now;
    const local = safeStore(opts.storage || { getItem() { return null; }, setItem() {} });
    const session = safeStore(opts.session || opts.storage || { getItem() { return null; }, setItem() {} });
    const newId = () => Array.from({ length: 16 }, () => Math.floor(random() * 36).toString(36)).join("") + now().toString(36);
    let visitorId = local.get("wander.v"); if (!visitorId) { visitorId = newId(); local.set("wander.v", visitorId); }
    let sessionId = session.get("wander.s"); if (!sessionId) { sessionId = newId(); session.set("wander.s", sessionId); }
    const visits = (Number(local.get("wander.n")) || 0) + 1; local.set("wander.n", visits);

    const variants = {};
    for (const [name, list] of Object.entries(opts.experiments || {})) {
      if (!Array.isArray(list) || list.length === 0) continue;
      let v = local.get("wander.x." + name);
      if (!v || !list.includes(v)) { v = list[Math.min(list.length - 1, Math.floor(random() * list.length))]; local.set("wander.x." + name, v); }
      variants[name] = v;
    }

    let queue = [];
    const reached = new Set();
    function flush() {
      while (queue.length) {
        const batch = queue.splice(0, MAX_BATCH);
        try { opts.send(opts.url, JSON.stringify({ k: opts.siteKey, v: visitorId, s: sessionId, e: batch })); } catch (e) { /* never break the page */ }
      }
    }
    function track(type, data) {
      if (!enabled) return;
      const s = sanitise(type, data);
      if (s) queue.push({ t: s.t, ts: now(), d: s.d });
    }
    function scroll(pct) {
      for (const mark of [25, 50, 75, 100]) if (pct >= mark && !reached.has(mark)) { reached.add(mark); track("scroll", { pct: mark }); }
    }
    function viewData(o) {
      const x = Object.entries(variants).map(([k, v]) => k + ":" + v).join(",");
      return buildView({ ...o, vn: visits, x });
    }
    return { enabled, visitorId, sessionId, variants, track, flush, scroll, viewData };
  }

  return { createTracker, sanitise, buildView, normaliseRef };
});
