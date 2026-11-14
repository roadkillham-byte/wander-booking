// Local mock of the store, for development and the flow test. Same logic as Apps Script (store/logic.js), kept in memory
// and seeded with one client. Prices here are a development approximation of Coffee Van's table; Coffee Van's own
// tests pin the real formulas. Run: node mock.mjs [port]
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = fileURLToPath(new URL(".", import.meta.url));
globalThis.WanderRules = require("./rules.js");
const S = require("./store/logic.js");

export const MOCK_APP_TOKEN = "dev-app-token-0123456789abcdef";
export const MOCK_CLIENT_TOKEN = "CLIENT-TOKEN-FIXTURE-0000000000";
export const MOCK_RETURNING_TOKEN = "CLIENT-TOKEN-RETURNING-0000000";
export const MOCK_HANDMADE_TOKEN = "CLIENT-TOKEN-HANDMADE-000000000";
export const MOCK_TWO_TOKEN = "CLIENT-TOKEN-TWOBOOKINGS-000000";

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".png": "image/png", ".woff2": "font/woff2", ".json": "application/json" };

function makeDb() {
  const tables = {};
  Object.keys(S.TABLES).forEach((t) => (tables[t] = []));
  tables.events = [];
  return {
    read: (t) => JSON.parse(JSON.stringify(tables[t] || [])),
    write: (t, rows) => { tables[t] = JSON.parse(JSON.stringify(rows)); },
    append: (t, row) => { (tables[t] = tables[t] || []).push(JSON.parse(JSON.stringify(row))); },
    lock: (fn) => fn(),
    env: (name) => (name === "APP_TOKEN" ? MOCK_APP_TOKEN : ""),
    tables,
  };
}

// Development price table: the catering formula with the approved ladder for 20 people (see the vault Rate Card).
function devPrices(now) {
  const quoteOf = (p, h) => Math.round(p * (3.4 + 4.62 * h) + (h + 1) * 68.41);
  const ladder = { 2: 1.5, 3: 2, 4: 2.5, 5: 3, 6: 3.5 };
  const quotes = {}, packs = {}, fees = {};
  for (let p = 1; p <= 200; p++) {
    quotes[p] = {}; packs[p] = {};
    for (const h of [2, 3, 4, 5, 6]) {
      quotes[p][h] = quoteOf(p, h);
      packs[p][h] = { price: 4 * quoteOf(p, h), bonusHours: ladder[h], bonusValue: Math.round(ladder[h] * 2 * (0.5 * (p * 4.62 + 68.41))) };
    }
  }
  for (let m = 0; m < 24 * 60; m += 30) {
    const key = String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
    fees[key] = {};
    for (const h of [2, 3, 4, 5, 6]) {
      const from = m, to = m + h * 60;
      let out = 0;
      for (let t = from; t < to; t++) if (t < 420 || t >= 960) out++;
      fees[key][h] = Math.ceil(out / 60) * 35;
    }
  }
  return { asOf: now, quotes, packs, fees };
}

export function seededDb(now = new Date().toISOString()) {
  const db = makeDb();
  S.publish(db, MOCK_APP_TOKEN, {
    asOf: now,
    clients: [
      { token: MOCK_CLIENT_TOKEN, firstName: "Alex", referralCode: "K7M2-QXTP",
        referrals: [{ firstName: "Jo", status: "booked" }, { firstName: "Pat", status: "completed" }],
        quote: { date: "2026-12-12", startTime: "09:00", people: 20, hours: 3, address: "3 Lake Road, Tea Gardens", total: 619, fee: 0 } },
      { token: MOCK_RETURNING_TOKEN, firstName: "Sam", referralCode: "H4BC-7WDR" },
      { token: MOCK_HANDMADE_TOKEN, firstName: "Pat", referralCode: "" },
      { token: MOCK_TWO_TOKEN, firstName: "Lee", referralCode: "", club: { month: now.slice(0, 7), used: 2, perMonth: 4 } },
    ],
    bookings: [
      { id: "bk-old", clientToken: MOCK_RETURNING_TOKEN, status: "completed", date: "2026-10-10", startTime: "09:00", endTime: "12:00",
        people: 20, hours: 3, address: "1 Main Street, Tea Gardens", total: 619, outOfHoursFee: 0, requestId: "" },
      // A booking Sam typed into Coffee Van by hand: no headcount and no start time.
      { id: "bk-hand", clientToken: MOCK_HANDMADE_TOKEN, status: "completed", date: "2026-10-03", startTime: "", endTime: "",
        people: 0, hours: 3, address: "", total: 0, outOfHoursFee: 0, requestId: "" },
      { id: "bk-l1", clientToken: MOCK_TWO_TOKEN, status: "confirmed", date: "2026-12-05", startTime: "09:00", endTime: "12:00",
        people: 20, hours: 3, address: "1 Main Street, Tea Gardens", total: 619, outOfHoursFee: 0, requestId: "",
        discount: 61.9, amountDue: 557.1, bonusHours: 2, creditsApplied: ["10% off your first morning", "2 free hours (Team Captain)"] },
      { id: "bk-l2", clientToken: MOCK_TWO_TOKEN, status: "confirmed", date: "2026-12-19", startTime: "10:00", endTime: "13:00",
        people: 30, hours: 3, address: "9 Beach Road, Hawks Nest", total: 900, outOfHoursFee: 0, requestId: "" },
    ],
    busy: [],
    reward: { referrerPercent: 10, friendPercent: 10, captainEvery: 3, captainFreeHours: 2 },
    credits: [
      { clientToken: MOCK_CLIENT_TOKEN, kind: "referral", label: "10% off your next booking", expiresAt: "2027-11-13" },
      { clientToken: MOCK_CLIENT_TOKEN, kind: "captain", label: "2 free hours on your next booking (Team Captain)", expiresAt: "2027-11-13" },
    ],
    prices: devPrices(now),
  }, now);
  return db;
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const text = Buffer.concat(chunks).toString("utf8");
  try { return JSON.parse(text || "{}"); } catch (e) { return null; }
}

export function startMock(port = 4180, { db = seededDb() } = {}) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const send = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(obj)); };
    if (url.pathname === "/api") {
      const action = url.searchParams.get("action") || "";
      const now = new Date().toISOString();
      if (req.method === "GET") {
        if (action === "health") return send(200, S.health(db, now));
        if (action === "prices") return send(200, S.prices(db));
        return send(404, { ok: false, error: "unknown-action" });
      }
      const body = await readBody(req);
      if (body === null) return send(400, { ok: false, error: "bad-json" });
      if (action === "session") return send(200, S.session(db, body.k, now));
      if (action === "request") return send(200, S.request(db, body, now));
      if (action === "availability") return send(200, S.availability(db, body, now));
      if (action === "event") return send(200, S.event(db, body, now));
      if (action === "funnel") return send(200, S.funnel(db, body.k, now, body.days));
      if (action === "pending") return send(200, S.pending(db, body.k));
      if (action === "ack") return send(200, S.ack(db, body.k, body.ids));
      if (action === "publish") return send(200, S.publish(db, body.k, body.snapshot, now));
      return send(404, { ok: false, error: "unknown-action" });
    }
    const rel = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
    const file = normalize(join(here, rel));
    if (!file.startsWith(here) || file.includes("node_modules") || file.includes(".git")) { res.writeHead(403); return res.end(); }
    try {
      let data = await readFile(file);
      // The page's config points at the live store; the local mock always serves the page against its own /api.
      if (rel === "config.js") data = Buffer.from(data.toString("utf8").replace(/window\.WANDER_API_URL = "[^"]*";/, 'window.WANDER_API_URL = "/api";'));
      res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" });
      res.end(data);
    } catch (e) {
      res.writeHead(404); res.end("not found");
    }
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ server, db, url: `http://127.0.0.1:${port}` })));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.argv[2] || 4180);
  const { url } = await startMock(port);
  console.log(`Dashboard mock on ${url}`);
  console.log(`Open ${url}/#k=${MOCK_CLIENT_TOKEN}`);
}
