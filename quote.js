// Wander's Catering Rate Card, in one place. Prices are GST-inclusive, to the dollar.
// people x ($3.40 + $4.62 x hours) + (hours + 1) x $68.41
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.WanderQuote = api;
})(typeof self !== "undefined" ? self : this, function () {
  const PACK_MARGIN_FLOOR = 0.43; // Sam, 13 Nov 2026: the lowest margin a pack may carry.
  const quote = (people, h) => Math.round(people * (3.4 + 4.62 * h) + (h + 1) * 68.41);
  const packPrice = (people, h) => 4 * quote(people, h);
  // Bonus time in 30-minute blocks. A bonus costs about half its list value (the rate card's 50% margin), so the
  // largest bonus that keeps the pack at or above the floor is 2 x (0.5 - floor) of the pack's list price.
  function packBonus(people, h, floor = PACK_MARGIN_FLOOR) {
    const blockValue = 0.5 * (people * 4.62 + 68.41);
    const blocks = Math.max(0, Math.floor((2 * (0.5 - floor) * packPrice(people, h)) / blockValue));
    return { blocks, hours: blocks / 2, value: Math.round(blocks * blockValue) };
  }
  return { PACK_MARGIN_FLOOR, quote, packPrice, packBonus };
});
