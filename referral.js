// Referral codes on the booking page: capture ?ref= for 30 days, and prefill it into Wander's form when the form's
// referral question is configured. A code that is not a code is ignored. Nothing here reaches outside the form URL.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.WanderReferral = api;
})(typeof self !== "undefined" ? self : this, function () {
  const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"; // no 0, 1, I, L or O
  const KEY = "wander-referral";
  const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

  // The canonical XXXX-XXXX form, or null. Case, spaces and hyphens are ignored.
  function normalise(input) {
    if (typeof input !== "string") return null;
    const raw = input.replace(/[\s-]/g, "").toUpperCase();
    if (raw.length !== 8) return null;
    for (let i = 0; i < raw.length; i++) if (ALPHABET.indexOf(raw.charAt(i)) < 0) return null;
    return raw.slice(0, 4) + "-" + raw.slice(4);
  }

  // Reads ?ref= from the page address and keeps a valid code for 30 days. Returns the live code, or null.
  // A storage that is blocked or full never throws; the visitor just gets no thank-you line.
  function captureReferral(search, store, now) {
    const fromLink = normalise(new URLSearchParams(search || "").get("ref") || "");
    try {
      if (fromLink) {
        if (store) store.setItem(KEY, JSON.stringify({ code: fromLink, at: now }));
        return fromLink;
      }
      const saved = store ? JSON.parse(store.getItem(KEY) || "null") : null;
      if (saved && normalise(saved.code) && typeof saved.at === "number" && now - saved.at < THIRTY_DAYS) {
        return normalise(saved.code);
      }
    } catch (err) {
      return fromLink;
    }
    return null;
  }

  // The form address with the referral question prefilled. Unchanged unless both a code and the question's entry id exist.
  function buildFormUrl(base, entryId, code) {
    const canonical = normalise(code || "");
    if (!canonical || !/^\d+$/.test(String(entryId || ""))) return base;
    const sep = base.indexOf("?") >= 0 ? "&" : "?";
    return base + sep + "usp=pp_url&entry." + entryId + "=" + encodeURIComponent(canonical);
  }

  // Prefills any answers the page knows. A pair with no entry id or no answer is left out.
  function prefilledFormUrl(base, pairs) {
    const parts = (pairs || []).filter(([entryId, value]) => /^\d+$/.test(String(entryId || "")) && String(value || "") !== "")
      .map(([entryId, value]) => "entry." + entryId + "=" + encodeURIComponent(String(value)));
    if (parts.length === 0) return base;
    const sep = base.indexOf("?") >= 0 ? "&" : "?";
    return base + sep + "usp=pp_url&" + parts.join("&");
  }

  return { normalise, captureReferral, buildFormUrl, prefilledFormUrl };
});
