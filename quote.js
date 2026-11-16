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
  // Prepaid contracts (Sam, 16 Nov 2026): three terms of four mornings a month at the single-morning price. Bonus hours are sized so the
  // margin stays at 43% or more on the GST-inclusive AND the ex-GST basis, with cost at half the list price. Mirrors the Coffee Van app
  // (src/cateringQuote.ts contractBonusHours); quote.test.js pins the same numbers. The page shows them, it never decides them.
  const TERMS = [
    { months: 3, mornings: 12, methods: ["bank", "card"] },
    { months: 6, mornings: 24, methods: ["bank"] },
    { months: 12, mornings: 48, methods: ["bank"] },
  ];
  const contractBonusHours = (mornings, people, h) => {
    const morning = quote(people, h);
    const price = mornings * morning;
    const cost = mornings * 0.5 * morning;
    const hourCost = 0.5 * (people * 4.62 + 68.41);
    const room = Math.min((price * 0.57 - cost) / hourCost, ((price / 1.1) * 0.57 - cost) / hourCost);
    return Math.max(0, Math.floor(room + 1e-9));
  };
  const contractTerms = (people, h) =>
    TERMS.map((t) => {
      const total = t.mornings * quote(people, h);
      return { months: t.months, mornings: t.mornings, total, freeHours: contractBonusHours(t.mornings, people, h), monthly: Math.round((total / t.months) * 100) / 100, methods: t.methods.slice() };
    });
  return { quote, packPrice, contractTerms };
});
