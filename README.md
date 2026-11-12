# Wander booking page

One static page (`index.html`) on Vercel. A visitor sees their price from the Catering Rate Card formula and
sends a booking request. The page sends no email itself: it posts the request to Wander's Google Apps Script
web app ("Client Confirmation" project, `doPost`), which logs it in the "Booking requests" sheet tab, emails
the client their quote and alerts Wander.

- `INTAKE_URL` in `index.html` is the web app's `/exec` URL. While it is the placeholder, the form tells
  visitors to call instead.
- Prices, inclusions and guarantees must match the Catering Rate Card note in the vault. Change them there
  first, then here and in `~/Documents/Wander-Feedback-QR/booking-intake.gs`.
