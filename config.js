// Settings for the page. Development uses the local mock (mock.mjs) at /api. When the store is deployed, set this to its
// /exec address (docs/contract.md). Nothing secret goes here: the store URL is public, and every route checks its token.
window.WANDER_API_URL = "https://script.google.com/macros/s/AKfycbxCGCNlXLi89gROVM7TJhMAJNvZVCgVGUzmfCFUUIPpMDByO10IcHHxbQW_appYTI0/exec";
// Held-only until trading is cleared (council inspection). Payment steps stay hidden and the copy says a payment link comes
// once we are trading. Switching this on enables payment; nothing else changes.
window.WANDER_PAYMENTS = false;
// Where the referral link goes (the booking page reads ?ref=).
window.WANDER_REFERRAL_BASE = "https://roadkillham-byte.github.io/wander-booking/";
window.WANDER_PHONE_DISPLAY = "0492 801 058";
window.WANDER_PHONE_LINK = "0492801058";
