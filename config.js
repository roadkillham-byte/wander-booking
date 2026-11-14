// The Google form behind the booking link (the menu QR still points to it). Its address is on the links allowlist below.
window.WANDER_FORM_URL = "https://docs.google.com/forms/d/e/1FAIpQLSdrma63Aq_JTXOnePtgFSu_u2SXfhdm8LaNa8-0U4PZUPU0-A/viewform";
// The booking intake (the Client Confirmation Google script's web app). The page posts each request here; it emails the
// quote and alerts Wander. Public address: nothing secret in it.
window.WANDER_INTAKE_URL = "https://script.google.com/macros/s/AKfycbxdeorHui4vgW2oQXYC8bS4rmYHU_JXL_ARH6XizzqD8b3HzobVtB6ctgR-SFLpJfLeYw/exec";

// Passive page tracking (see privacy.html and the data layer plan). Both stay empty until the Google script that
// receives events is deployed with a SITE_KEY; until then the trackers do nothing at all.
window.WANDER_EVENTS_URL = "";
window.WANDER_SITE_KEY = "";
// Honour Do Not Track and Global Privacy Control. Set to false only on Sam's say-so.
window.WANDER_RESPECT_DNT = true;
// Experiments: name -> variants. A visitor gets one variant each, kept, and it is reported with their first view.
window.WANDER_EXPERIMENTS = {};

// Where tracked links (go.html?to=key) may go. Nothing outside this list is ever reachable.
(function () {
  var base = "https://roadkillham-byte.github.io/wander-booking/";
  window.WANDER_LINKS = { page: base, compare: base + "#pack", form: window.WANDER_FORM_URL, call: "tel:0492801058" };
})();
