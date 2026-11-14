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

// Real packages to compare with, shown under the price as one line each (totals for this visitor's group). Sources and dates matter:
// recheck before relying on them. Competitors are not named on the page.
//   tiers: [{ guests, hours, price }]  the seller prices by package; the smallest tier covering the group is used.
//   perPerson: a flat dollars-a-head price.   coffeeOnly: true  when Wander costs more, the line says the difference is a full bowl each.
//   wontInclude: what they usually leave out, only if true.
// Wander is shown only where it is cheaper, or where the other package is coffee-only.
// Given by Sam on 15 Nov 2026 (madisonavecoffee): coffee packages 2 h/50 guests $300, 3 h/100 $550, 4 h/200 $1,000, full day/300 $1,500;
// "Premium high tea" $45 a head.
window.WANDER_ANCHORS = [
  { label: "A coffee-only cart", coffeeOnly: true, tiers: [{ guests: 50, hours: 2, price: 300 }, { guests: 100, hours: 3, price: 550 }, { guests: 200, hours: 4, price: 1000 }, { guests: 300, hours: 24, price: 1500 }] },
  { label: "A premium high tea package", perPerson: 45 },
];
