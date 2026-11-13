# Wander booking page

Static page for Wander Coffee Van, hosted on GitHub Pages: https://roadkillham-byte.github.io/wander-booking/

- `index.html`: price calculator and the Prepaid 4-Pack comparison. Requests go to Wander's Google Form (`config.js`).
- `quote.js`: the rate card formula and the 4-Pack bonus ladder. **Prices must match** `Catering Rate Card` in the vault,
  `src/cateringQuote.ts` in Coffee Van, and the Google script. Pack: four singles at the chosen length, bonus time in
  30-minute blocks, `PACK_MARGIN_FLOOR = 0.43` (Sam, 13 Nov 2026).
- `track.js`, `boot.js`: passive first-party tracking, inert until `WANDER_EVENTS_URL` and `WANDER_SITE_KEY` are set in
  `config.js`. Honours Do Not Track and Global Privacy Control. Contract in the data layer plan.
- `go.html`, `tap.html`, `links.js`: tracked email links and one-tap answers. Redirects only reach the allowlist in `config.js`.
- `privacy.html`: the privacy notice. Linked from every page. **Have it reviewed (a lawyer or the OAIC guidance) before Wander starts trading.**

Tests: `node --test` in this folder (no install needed).

Turning tracking on: deploy the Google script with a `SITE_KEY`, set both values in `config.js`, push.
