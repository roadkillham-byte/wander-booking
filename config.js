// The Google form behind the booking link (the menu QR still points to it). Its address is on the links allowlist below.
window.WANDER_FORM_URL = "https://docs.google.com/forms/d/e/1FAIpQLSdrma63Aq_JTXOnePtgFSu_u2SXfhdm8LaNa8-0U4PZUPU0-A/viewform";
// The booking intake (the Client Confirmation Google script's web app). The page posts each request here; it emails the
// quote and alerts Wander. Public address: nothing secret in it.
window.WANDER_INTAKE_URL = "https://script.google.com/macros/s/AKfycbxdeorHui4vgW2oQXYC8bS4rmYHU_JXL_ARH6XizzqD8b3HzobVtB6ctgR-SFLpJfLeYw/exec";
// The store the customer portal uses (portal/config.js): the booking page asks it for free start times and for a first-time client's hold.
// A public address; nothing secret in it. If it does not answer, the page falls back to the intake alone and we confirm by phone.
window.WANDER_STORE_URL = "https://script.google.com/macros/s/AKfycbxCGCNlXLi89gROVM7TJhMAJNvZVCgVGUzmfCFUUIPpMDByO10IcHHxbQW_appYTI0/exec";

// Where happy clients are asked to leave a review (a Google review link). Empty means no review ask is shown.
window.WANDER_REVIEW_URL = "";
// Passive page tracking (see privacy.html and the data layer plan). The events go to the same Google script as the
// intake, whose SITE_KEY script property is the word below (not a secret). Without that match the endpoint accepts nothing.
window.WANDER_EVENTS_URL = window.WANDER_INTAKE_URL;
window.WANDER_SITE_KEY = "wander-site";
// Honour Do Not Track and Global Privacy Control. Set to false only on Sam's say-so.
window.WANDER_RESPECT_DNT = true;
// Experiments: name -> variants. A visitor gets one variant each, kept, and it is reported with their first view.
window.WANDER_EXPERIMENTS = {};

// Where tracked links (go.html?to=key) may go. Nothing outside this list is ever reachable.
(function () {
  var base = "https://roadkillham-byte.github.io/wander-booking/";
  window.WANDER_LINKS = { page: base, compare: base + "#pack", form: window.WANDER_FORM_URL, call: "tel:0492801058" };
})();

// Real words from real clients, shown in the "Good to know" box once there are some: [{ quote: "...", who: "Name, business" }]. Leave empty until then.
window.WANDER_PROOF = [];

// One real client story for the "Good to know" box: [{ who: "Name, business", problem: "...", solution: "...", result: "...", price: "..." }]. Leave empty until there is one.
window.WANDER_CASES = [];

// A real price to compare with, shown under the quote only when Wander is cheaper: { label: "Typical event caterer", perPerson: 0 } (dollars a head).
window.WANDER_ANCHOR = { label: "", perPerson: 0 };
