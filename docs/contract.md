# Wander dashboard contract (version 1)

Three sides build against this file: the dashboard front end (`app.js`, `api.js`), the store (`store/logic.js`, Apps Script
adapter in `store/Adapter.gs`) and Coffee Van's sync (`server/dashboardSync.mjs` in the Coffee Van repo). Fixtures in
`fixtures/contract/` are the examples every side tests against. Change this file first, then the fixtures, then the code.

## Conventions

- Times: Australia/Sydney local wall-clock. Dates `YYYY-MM-DD`, times `HH:MM` (24-hour). Never trust a browser or server zone.
- Money: whole dollars, GST included, as Coffee Van quotes it. The dashboard never computes a price.
- Every response has `ok` (boolean). A failure is `{ok:false, error:"<short code>"}`. The client never sees an error screen:
  the front end falls back to the "we will text you" copy.
- Client tokens are long random values, carried in the page URL fragment (`#k=TOKEN`), never in query strings the server logs.
  A token returns only that client's data. Referral data is first names only.
- Requests are sent as `text/plain` JSON (no CORS preflight), as the booking intake already does. Anything carrying a token is a POST.
- `asOf` on availability and prices is when Coffee Van last published. Older than 6 hours is `stale: true`.

## Session (client, token)

`POST ?action=session` with body `{k: TOKEN}` → see `fixtures/contract/session.json`. POST keeps tokens out of URLs and server logs.

- `client`: `{firstName, referralCode}`.
- `bookings`: each `{id, status, date, startTime, endTime, people, hours, address, total, outOfHoursFee}`.
  `status` is one of `held`, `confirmed`, `completed`, `cancelled`, `requested`.
- `pending`: requests waiting for Sam, `{id, kind, replyWithinHours}`.
- `credits`: `{kind: "returning"|"referral", label, expiresAt}`. Labels are the words the page shows.
- `pack`: `null`, or `{mornings: 4, used, left, bonusHours, expiresAt}`.
- `asOf`, `stale`.

## Prices (client-independent)

`GET ?action=prices` → see `fixtures/contract/prices.json`. Published by Coffee Van, cached by the page.

- `quotes`: `{"<people>": {"<hours>": total}}`, people 1 to 200, hours 2 to 6.
- `packs`: `{"<people>": {"<hours>": {price, bonusHours, bonusValue}}}`, the 4-Pack ladder from `packBonus`.
- `fees`: `{"<HH:MM>": {"<hours>": outOfHoursFee}}`, the $35-per-started-hour rule outside 7:00 am to 4:00 pm.
- `asOf`.

## Requests (client, token)

`POST ?action=request` with body `{k, kind, requestId, ...}`. `requestId` is made by the page and makes a resend harmless.

| kind | body fields | outcomes |
|---|---|---|
| `hold` | `date, startTime, people, hours, address` | `held` (slot free, fresh) or `requested` (taken or stale) |
| `change` | `bookingId, date, startTime, people, hours, address` | `applied` (rules allow) or `requested` |
| `cancel` | `bookingId` | `requested` (credit confirmed by Sam until amount credits exist) |
| `pack` | `date, startTime, people, hours` | `requested` (Sam confirms the first date; no charge) |
| `call` | `when, note` | `requested` |

`hold` and `change` may also send `shownTotal` and `shownFee`: the total and out-of-hours fee the page showed. Coffee Van compares them with its own price and flags any difference; it books at its own price.

Response: `{ok:true, outcome, replyWithinHours, message, bookingId?}`. `message` is ready-to-show client copy.
Examples: `fixtures/contract/request-hold.json` and its two responses.

Rules applied by the store (shared logic, `rules.js`): notice of 24 hours or more, slot free on the van with a 60-minute gap,
address within 50 km. Any miss is `requested`, never an error. A hold is checked against published busy times **and** holds
still waiting in the store, under a lock, so two clients cannot hold the same slot.

## Coffee Van pull and ack (app token)

`POST ?action=pending` with body `{k: APP_TOKEN}` → `{ok, items:[...]}`. Each item is one request with its `kind` and fields plus `clientToken`.
Then `POST ?action=ack` with `{k, ids:[...]}` removes them from the queue. The store keeps a hold until a publish lists its
`requestId`, so an ack never opens a gap on the van. See `fixtures/contract/pending.json` and `ack.json`.

## Coffee Van publish (app token)

`POST ?action=publish` with `{k, snapshot}`. The snapshot replaces clients, bookings, busy times and credits; it is
idempotent. `fixtures/contract/publish.json` is an example. Clients are keyed by `token` (minted by Coffee Van, emailed as the
sign-in link). Bookings carry `requestId` when they came from the dashboard or the form.

## Health

`GET ?action=health` → `{ok, contractVersion: 1, asOf, staleAfterHours: 6}`. The page checks it before showing any link.
A dead store means no links in emails (see the customer-experience rule).
