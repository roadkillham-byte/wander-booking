// The public link to Wander's booking Google Form (the "Client Confirmation" project, setupBookingForm prints it).
// Empty until the form exists: the page then asks visitors to call instead.
window.WANDER_FORM_URL = "https://docs.google.com/forms/d/e/1FAIpQLSdrma63Aq_JTXOnePtgFSu_u2SXfhdm8LaNa8-0U4PZUPU0-A/viewform";

// Passive page tracking (see privacy.html and the data layer plan). Both stay empty until the Google script that
// receives events is deployed with a SITE_KEY; until then the trackers do nothing at all.
// The entry id (the number after entry.) of the form's referral question, printed by setupBookingForm. Empty until it is
// set: a referral link then still captures the code, but the form is not prefilled and the page says nothing about a friend.
window.WANDER_FORM_REFERRAL_ENTRY = "1919679306";
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
