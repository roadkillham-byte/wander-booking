// Which door a visitor came through: keep the first utm_source / utm_medium / utm_campaign from the link for 90 days.
// Only a-z 0-9 _ - survive, at most 40 characters, so nothing here can carry markup or a spreadsheet formula.
// A storage that is blocked or full never throws; the visitor just books without a tag.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.WanderSource = api;
})(typeof self !== "undefined" ? self : this, function () {
  const KEY = "wander-source-v1";
  const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000;

  function clean(value) {
    return String(value == null ? "" : value).toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40);
  }

  function fromLink(search) {
    const params = new URLSearchParams(search || "");
    const source = clean(params.get("utm_source"));
    if (source) return { source, medium: clean(params.get("utm_medium")), campaign: clean(params.get("utm_campaign")) };
    if (params.get("ref")) return { source: "referral", medium: "referral", campaign: "" };
    return null;
  }

  // The live tag, or null. A tag already kept (and under 90 days old) always wins over a new one.
  function captureSource(search, store, now) {
    const link = fromLink(search);
    try {
      const saved = store ? JSON.parse(store.getItem(KEY) || "null") : null;
      if (saved && clean(saved.source) && typeof saved.at === "number" && now - saved.at < NINETY_DAYS) {
        return { source: clean(saved.source), medium: clean(saved.medium), campaign: clean(saved.campaign) };
      }
      if (link && store) store.setItem(KEY, JSON.stringify({ ...link, at: now }));
    } catch (err) {
      return link;
    }
    return link;
  }

  return { captureSource, NINETY_DAYS };
});
