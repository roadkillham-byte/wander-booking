# Deploying the dashboard (for Sam: the steps that need you)

Nothing here is live. Each step below is a click or a yes from Sam. Do them in this order.

## 1. Store (Apps Script, one project, its own Sheet)

1. Create a new Google Sheet "Wander dashboard store". Copy its ID from the URL.
2. In Apps Script (from that Sheet: Extensions > Apps Script), create a new project. Paste in `store/Adapter.gs`, `rules.js` and `store/logic.js`, as three files in that order.
3. Project Settings > Script properties:
   - `STORE_SHEET_ID` = the Sheet ID.
   - `APP_TOKEN` = 16+ random characters. Put the same value in Coffee Van's `~/.config/coffee-van/dashboard.env` as `DASHBOARD_APP_TOKEN` (Claude can write that file; never paste the value into chat or notes).
4. Run `selfTestRules_` from the editor once. The log must say "rules OK in this runtime". If it does not, stop and tell Claude.
5. Deploy > New deployment > Web app: execute as me, access "Anyone". Copy the `/exec` address.

## 2. Page (GitHub Pages, public)

1. Decide: a public repo for the dashboard code (the page holds no client data; the booking page is already public).
2. If yes, Claude creates `wander-dashboard` on GitHub and pushes `main`. Pages then serves it at `https://<owner>.github.io/wander-dashboard/`.
3. Set `WANDER_API_URL` in `config.js` to the `/exec` address from step 1.5, and keep `WANDER_PAYMENTS = false`.

## 3. Coffee Van

1. Claude merges the `dashboard-sync` branch once Sam approves, and wires the sync into the running app's import (the same pattern as the booking intake).
2. Nothing sends until `dashboard.env` exists. Sam decides when it does.

## 4. Client links (last)

The welcome and quote emails get the "Pick your morning" link only after: the store health check passes
(`GET <exec>?action=health`), the page loads from its public address, and Sam has read the email copy.
