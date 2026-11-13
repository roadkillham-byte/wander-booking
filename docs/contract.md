# Wander Customer Portal contract (version 1)

Three sides build against this file: the dashboard front end (`app.js`, `api.js`), the store (`store/logic.js`, Apps Script
adapter in `store/Adapter.gs`) and Coffee Van's sync (`server/dashboardSync.mjs` in the Coffee Van repo). Fixtures in
`fixtures/contract/` are the examples every side tests against. Change this file first, then the fixtures, then the code.

## Conventions

- Times: Australia/Sydney local wall-clock. Dates `YYYY-MM-DD`, times `HH:MM` (24-hour). Never trust a browser or server zone.
- Money: whole dollars, GST included, as Coffee Van quotes it. The dashboard never computes a price.
- Every response has `ok` (boolean). A failure is `{ok:false, error:"<short code>"}`. A rule miss is never a failure: it is a
  `requested` outcome. Two kinds of real failure, and the page tells the client which one it is:
  - The store could not be reached or could not answer (`network` is made by the page when the call fails or the reply is not
    JSON; `store-error` is sent by the store when it caught its own exception, a lock timeout included). The page says plainly that
    it could not confirm the request, keeps the client's details on screen, and offers **Try again** (it resends the **same
    `requestId`**, so a request that did arrive is not held twice) plus a pre-filled text and a phone call. It never says
    "we will text you", because nobody knows about the request.
  - The store answered and refused the request (`bad-date-or-time`, `bad-people`, `bad-hours`, `no-request-id`, `unknown-kind`,
    `not-found`). The page asks the client to check the details and keeps the form.
- Client tokens are long random values, carried in the page URL fragment (`#k=TOKEN`), never in query strings the server logs.
  A token returns only that client's data. Referral data is first names only.
- Requests are sent as `text/plain` JSON (no CORS preflight), as the booking intake already does. Anything carrying a token is a POST.
- `asOf` on availability and prices is when Coffee Van last published. Older than 6 hours is `stale: true`.

## Session (client, token)

`POST ?action=session` with body `{k: TOKEN}` → see `fixtures/contract/session.json`. POST keeps tokens out of URLs and server logs.

- `client`: `{firstName, referralCode}`.
- `referrals`: `[{firstName, status: "booked"|"completed"}]`, the people this client referred, by first name only. Nothing else about them.
  `booked` means the friend's booking is **confirmed**; a form quote or a hold still waiting for Sam is not listed.
- `bookings`: each `{id, status, date, startTime, endTime, people, hours, address, total, outOfHoursFee, discount, amountDue, bonusHours, creditsApplied}`.
  Coffee Van attaches a client's credits to a booking the moment it confirms it (payment follows confirmation), so `discount`
  (whole dollars off `total + outOfHoursFee`), `bonusHours` (free service hours added) and `creditsApplied` (the labels of the credits
  taken) are zero or empty until then, and `amountDue = total + outOfHoursFee - discount` is what the client pays. The page shows
  these numbers and never works them out.
  `status` is one of `held`, `confirmed`, `completed`, `cancelled`, `requested`.
- `pending`: requests waiting for Sam, `{id, kind, replyWithinHours}`.
- `credits`: `{kind: "returning"|"referral"|"friend"|"captain", label, expiresAt}`, the credits still waiting. Labels are the words the page shows.
  `friend` is the 10% a referred friend gets on their first morning; `captain` is the free hours a referrer earns on every third
  friend's completed morning.
- `reward`: `{referrerPercent, friendPercent, captainEvery, captainFreeHours}`, the referral offer in numbers, published by Coffee Van
  so the page's words never drift from what Coffee Van gives (10, 10, 3, 2 today). `null` until the first publish.
- `pack`: `null`, or `{mornings: 4, used, left, bonusHours, expiresAt}`.
- `asOf`, `stale`.

## Availability (client, token)

`POST ?action=availability` with body `{k, hours, bookingId?}` → see `fixtures/contract/availability.json`. The start times a
client could hold **right now**: the store runs each one through the same rules a hold uses (notice of 24 hours or more, a free
slot with a 60-minute gap against the published busy times **and** the holds still waiting), so a time listed free is held
when the client taps it. `bookingId` leaves that client's own booking out of the busy times, for a change.

- `days`: `{"YYYY-MM-DD": ["06:00", ...]}`, only days with at least one free start. A day inside `window` and not listed is full.
- `window`: `{from, through}`, the dates the answer covers (60 days from today, Sydney).
- `stale: true` when availability is older than 6 hours: `days` is `{}` and the page claims nothing is free; a pick is then a request.
- Starts are checked every 30 minutes from 06:00 to 18:00, and only those inside the trading hours are ever listed free: **every day,
  07:00 to 16:00**, and the whole booking must fit (a 3-hour morning can start at 13:00 at the latest). A start outside those hours is
  not "taken": it is a request (a hold there is `requested`, with the out-of-hours fee priced in), so the page leaves it open and says
  we confirm it by text. A held time inside the hours still waits for Sam to confirm.

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

Rules applied by the store (shared logic, `rules.js`): notice of 24 hours or more, the whole booking inside the trading hours
(every day, 07:00 to 16:00), slot free on the van with a 60-minute gap, address within 50 km. Any miss is `requested`, never an error. A hold is checked against published busy times **and** holds
still waiting in the store, under a lock, so two clients cannot hold the same slot.

## Coffee Van pull and ack (app token)

`POST ?action=pending` with body `{k: APP_TOKEN}` → `{ok, items:[...]}`. Each item is one request with its `kind` and fields plus `clientToken`.
Then `POST ?action=ack` with `{k, ids:[...]}` removes them from the queue. A hold is dropped by the first publish **after** its
ack (Coffee Van has by then turned the request into a booking, which the publish lists, or has refused it, which frees the
slot), or by any publish that lists its `requestId`, or once its date has passed. Until then it keeps blocking the van, so an
ack never opens a gap. See `fixtures/contract/pending.json` and `ack.json`.

## Coffee Van publish (app token)

`POST ?action=publish` with `{k, snapshot}`. The snapshot replaces clients, bookings, busy times and credits; it is
idempotent. `fixtures/contract/publish.json` is an example. Clients are keyed by `token` (minted by Coffee Van, emailed as the
sign-in link). `snapshot.reward` has the shape above and `snapshot.bookings[]` carries the credit fields above. `clients[].referrals` has the shape above; the store keeps a first name (40 characters) and one of the two
statuses, and drops everything else, including entries with any other status. Bookings carry `requestId` when they came from the dashboard or the form.

## Store errors

Every route of the store answers JSON, even when it throws: an exception is caught and answered `{ok:false, error:"store-error"}`
(never an HTML error page). The store emails its owner about an error at most once an hour, with the action name and the error
text only, no client data.

## Health

`GET ?action=health` → `{ok, contractVersion: 1, asOf, staleAfterHours: 6}`. The page checks it before showing any link.
A dead store means no links in emails (see the customer-experience rule).
