// Browser glue: builds the tracker from config.js. Pages call WanderBoot.tracker() and use it; nothing else here.
(function () {
  function send(url, body) {
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(url, new Blob([body], { type: "text/plain" }))) return;
    } catch (e) { /* fall through */ }
    try { fetch(url, { method: "POST", mode: "no-cors", keepalive: true, headers: { "Content-Type": "text/plain" }, body: body }); } catch (e) { /* ignore */ }
  }
  var tracker = null;
  function build() {
    var storage, session;
    try { storage = window.localStorage; } catch (e) { storage = null; }
    try { session = window.sessionStorage; } catch (e) { session = null; }
    return window.WanderTrack.createTracker({
      url: window.WANDER_EVENTS_URL, siteKey: window.WANDER_SITE_KEY, respectDnt: window.WANDER_RESPECT_DNT !== false,
      storage: storage || undefined, session: session || undefined, send: send, nav: navigator, experiments: window.WANDER_EXPERIMENTS,
    });
  }
  window.WanderBoot = { tracker: function () { return tracker || (tracker = build()); } };
})();
