// Allowlisted redirects and one-tap answers. Nothing here ever redirects to a URL taken from the query string.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.WanderLinks = api;
})(typeof self !== "undefined" ? self : this, function () {
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const TAP_QUESTIONS = {
    industry: { prompt: "What kind of team is it?", answers: { office: "Office", trade: "Trade or yard", health: "Health or care", school: "School or club", realestate: "Real estate", event: "Events", other: "Something else" } },
    frequency: { prompt: "How often might you want us?", answers: { once: "Just once", monthly: "Monthly", weekly: "Weekly", unsure: "Not sure yet" } },
    heard: { prompt: "How did you find us?", answers: { van: "Saw the van", flyer: "A flyer", instagram: "Instagram", friend: "A friend", search: "Searching online", other: "Somewhere else" } },
    rating: { prompt: "How did we do?", answers: { 1: "1", 2: "2", 3: "3", 4: "4", 5: "5" } },
    role: { prompt: "Who is booking?", answers: { owner: "The owner", office: "Office or practice manager", organiser: "An event organiser", other: "Someone else" } },
  };
  function resolveLink(key, table) {
    if (typeof key !== "string" || !/^[a-z]{2,12}$/.test(key) || !table || !has(table, key)) return null;
    const url = table[key];
    return typeof url === "string" && /^(https:\/\/|tel:|mailto:)/.test(url) ? url : null;
  }
  function resolveTap(q, a) {
    if (typeof q !== "string" || typeof a !== "string" || !has(TAP_QUESTIONS, q) || !has(TAP_QUESTIONS[q].answers, a)) return null;
    return { q, a };
  }
  // What the thank-you page does for a rating: 4 or 5 may ask for a review, 1 or 2 says sorry, 3 just thanks.
  function ratingOutcome(a) {
    if (a === "4" || a === "5") return "good";
    if (a === "3") return "ok";
    if (a === "1" || a === "2") return "low";
    return null;
  }
  return { TAP_QUESTIONS, resolveLink, resolveTap, ratingOutcome };
});
