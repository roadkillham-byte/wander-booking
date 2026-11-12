# Wander booking page

One static page (`index.html`), hosted on GitHub Pages. A visitor enters people and hours and sees their price from
the Catering Rate Card formula, plus the Office Club 4-Pack price. "Request this booking" opens Wander's Google Form
(`WANDER_FORM_URL` in `config.js`). The page collects nothing and sends no email: the Coffee Van app pulls each form
request, emails the quote and adds a tentative booking (see `docs/booking-form-setup.md` in the Coffee-Van repo).

- While `WANDER_FORM_URL` is empty the button tells visitors to call instead.
- Prices, inclusions and guarantees must match the Catering Rate Card note in the vault. Change them there first,
  then here, then in the Coffee-Van repo (`src/cateringQuote.ts`, `server/bookingIntake.mjs`, `scripts/google/booking-intake.gs`).
