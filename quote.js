// Wander's Catering Rate Card, in one place. Prices are GST-inclusive, to the dollar.
// people x ($3.40 + $4.62 x hours) + (hours + 1) x $68.41
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.WanderQuote = api;
})(typeof self !== "undefined" ? self : this, function () {
  const quote = (people, h) => Math.round(people * (3.4 + 4.62 * h) + (h + 1) * 68.41);
  // The 4-Pack is four singles at the chosen length, nothing off and no bonus time (Sam, 16 Nov 2026).
  const packPrice = (people, h) => 4 * quote(people, h);
  return { quote, packPrice };
});
