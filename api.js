// The page's only door to the store (docs/contract.md). Mock and Apps Script answer the same shapes, so swapping them is
// one line in config.js. A failed call never shows an error: the caller falls back to "we will text you" copy.
var WanderApi = (function () {
  function url(action) {
    var base = window.WANDER_API_URL || "/api";
    return base + (base.indexOf("?") >= 0 ? "&" : "?") + "action=" + action;
  }
  function send(action, body) {
    return fetch(url(action), {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body || {}),
    }).then(function (r) { return r.json(); }).catch(function () { return { ok: false, error: "network" }; });
  }
  function read(action) {
    return fetch(url(action)).then(function (r) { return r.json(); }).catch(function () { return { ok: false, error: "network" }; });
  }
  return {
    session: function (k) { return send("session", { k: k }); },
    prices: function () { return read("prices"); },
    health: function () { return read("health"); },
    request: function (body) { return send("request", body); },
    event: function (body) { return send("event", body); },
  };
})();
