// End-to-end check of the client journey in a headless browser at phone width: link, Held, Book, the 4-Pack offer,
// a plain decline, and the confirmation. Run: node test/flow.mjs   (uses the Playwright install in render-engine).
import { createRequire } from "node:module";
import { startMock, MOCK_CLIENT_TOKEN, MOCK_RETURNING_TOKEN, MOCK_HANDMADE_TOKEN, MOCK_TWO_TOKEN } from "../mock.mjs";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.HOME + "/render-engine/node_modules/playwright-core");

const shots = process.env.SHOTS || "/tmp";
const { server, url, db } = await startMock(4181);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 2 });
page.setDefaultTimeout(6000);
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
const failures = [];
const check = async (label, fn) => {
  try { await fn(); console.log("ok   " + label); }
  catch (e) { failures.push(label + ": " + e.message); console.log("FAIL " + label + " - " + e.message.split("\n")[0]); }
};
async function noOverflowAndNoJunk(label) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 0) throw new Error(label + " overflows by " + overflow + "px");
  const text = await page.evaluate(() => document.body.innerText);
  if (/undefined|NaN|\[object/.test(text)) throw new Error(label + " shows junk text");
}

await page.goto(url + "/#k=" + MOCK_CLIENT_TOKEN);
await page.waitForSelector("#book");
await check("Held landing shows the quote and the one orange action", async () => {
  const txt = await page.innerText("#app");
  if (!txt.includes("Hi Alex")) throw new Error("no greeting");
  if (!txt.includes("$619")) throw new Error("price not shown: " + txt.slice(0, 200));
  if (!txt.includes("Book this morning")) throw new Error("no Book button");
  await noOverflowAndNoJunk("Held");
});
await page.waitForTimeout(1200);
await page.screenshot({ path: shots + "/dash-1-held.png", fullPage: true });

await check("Book holds the date and goes to the 4-Pack offer", async () => {
  await page.click("#book");
  await page.waitForSelector("#pack-yes");
  const txt = await page.innerText("#app");
  if (!txt.includes("Four mornings, one at a time, or all four up front")) throw new Error("offer heading missing");
  if (!txt.includes("$2,476")) throw new Error("4-Pack price missing: " + txt.slice(0, 300));
  if (!txt.includes("free, worth")) throw new Error("bonus value missing");
  if (!txt.includes("If we don't turn up")) throw new Error("guarantee beside the price missing");
  await noOverflowAndNoJunk("Upgrade");
});
await page.waitForTimeout(1200);
await page.screenshot({ path: shots + "/dash-2-upgrade.png", fullPage: true });

await check("a plain decline goes to what happens next, with no penalty", async () => {
  await page.click("#pack-no");
  await page.waitForSelector("text=What happens next");
  const txt = await page.innerText("#app");
  if (!txt.includes("We reply within 24 hours")) throw new Error("reply promise missing");
  if (!txt.includes("We will send a payment link once we are trading")) throw new Error("held-only copy missing");
  if (!txt.includes("Copy my referral link")) throw new Error("referral line missing");
  await noOverflowAndNoJunk("Confirmed");
});
await page.waitForTimeout(1200);
await page.screenshot({ path: shots + "/dash-3-confirmed.png", fullPage: true });

await check("the account screens render from the same session", async () => {
  for (const v of ["bookings", "pack", "compare", "call"]) {
    await page.goto(url + "/#k=" + MOCK_CLIENT_TOKEN + "&v=" + v);
    await page.waitForSelector("#app h2");
    await noOverflowAndNoJunk(v);
  }
});

await check("a returning client sees Same again with a future date, and one tap holds it; a first-time client does not", async () => {
  await page.goto(url + "/#k=" + MOCK_CLIENT_TOKEN + "&v=home");
  await page.waitForSelector("#app h2");
  if ((await page.innerText("#app")).includes("Same again")) throw new Error("a first-time client was offered Same again");
  await page.goto(url + "/#k=" + MOCK_RETURNING_TOKEN);
  await page.waitForSelector("#again");
  const label = await page.innerText("#again");
  if (!/^Same again, /.test(label)) throw new Error("button text: " + label);
  await noOverflowAndNoJunk("Same again");
  await page.click("#again");
  await page.waitForSelector("#pack-yes");
});

await check("after tapping Same again the client sees their held morning, never Same again a second time", async () => {
  await page.goto(url + "/#k=" + MOCK_RETURNING_TOKEN + "&v=home");
  await page.waitForSelector("#app h2");
  const txt = await page.innerText("#app");
  if (!txt.includes("Your morning is held")) throw new Error("no held morning: " + txt.slice(0, 200));
  if (await page.$("#again")) throw new Error("Same again is still offered");
});

await check("a hand-entered last booking (no headcount, no start) gets the picker, not a broken Same again", async () => {
  await page.goto(url + "/#k=" + MOCK_HANDMADE_TOKEN);
  await page.waitForSelector("#pick");
  if (await page.$("#again")) throw new Error("Same again offered for a booking with no headcount");
});

await check("the funnel screens have no menu and the account screens do", async () => {
  await page.goto(url + "/#k=" + MOCK_HANDMADE_TOKEN);
  await page.waitForSelector("#pick");
  if (await page.$(".top")) throw new Error("menu on the Pick screen");
  await page.goto(url + "/#k=" + MOCK_TWO_TOKEN + "&v=bookings");
  await page.waitForSelector(".top");
});

await check("changing a booking changes the one chosen, not the first", async () => {
  await page.goto(url + "/#k=" + MOCK_TWO_TOKEN + "&v=change&b=bk-l2");
  await page.waitForSelector("#pick");
  const date = await page.inputValue('#pick input[name="date"]');
  if (date !== "2026-12-19") throw new Error("seeded from the wrong booking: " + date);
  await page.fill('#pick input[name="date"]', "2026-12-20");
  await page.click('#pick button[type="submit"]');
  await page.waitForSelector("text=What happens next");
  const queued = db.tables.queue.filter((q) => q.kind === "change").pop();
  const sent = JSON.parse(queued.payload).request;
  if (sent.bookingId !== "bk-l2") throw new Error("changed " + sent.bookingId);
});

await check("Refer a team shows the code, a share button and each referral by first name only", async () => {
  await page.goto(url + "/#k=" + MOCK_CLIENT_TOKEN + "&v=refer");
  await page.waitForSelector("#share");
  const txt = await page.innerText("#app");
  for (const want of ["K7M2-QXTP", "Copy my referral link", "Jo", "booked", "Pat", "10% earned"]) {
    if (!txt.includes(want)) throw new Error("missing: " + want);
  }
  if (/@|\d{4} ?\d{3}/.test(txt.replace("0492 801 058", ""))) throw new Error("contact detail on the screen");
  await noOverflowAndNoJunk("Refer a team");
  await page.waitForTimeout(1200);
  await page.screenshot({ path: shots + "/dash-4-refer.png", fullPage: true });
});

await check("a bad link shows a plain message, never an error page", async () => {
  await page.goto(url + "/#k=NOT-A-TOKEN");
  await page.waitForFunction(() => document.getElementById("app").innerText.includes("could not open this link"), null, { timeout: 5000 });
});

// ---- Free times, honest failures, and the referral wording (client feedback, 14 Nov 2026) ----
const DAY = "2026-12-22";
const FULL = "2026-12-23";
// A check that makes the network fail on purpose: the browser's own "failed to load" console lines are expected there.
const expectFailures = (fn) => async () => { const keep = errors.length; try { await fn(); } finally { errors.length = keep; await page.unroute("**/api?action=request").catch(() => {}); await page.unroute("**/api?action=session").catch(() => {}); } };
const clockTexts = async () => page.$$eval('#pick select[name="startTime"] option', (os) => os.map((o) => ({ v: o.value, off: o.disabled, t: o.textContent })));

await check("the Pick screen shows when the van is free: taken times are switched off and the free window is written out", async () => {
  db.tables.busy.push({ date: DAY, startTime: "09:00", endTime: "12:00" });
  db.tables.busy.push({ date: FULL, startTime: "06:00", endTime: "23:00" });
  await page.goto(url + "/#k=" + MOCK_HANDMADE_TOKEN);
  await page.waitForSelector("#pick");
  await page.fill('#pick input[name="date"]', DAY);
  await page.waitForFunction(() => (document.getElementById("avail") || {}).innerText && document.getElementById("avail").innerText.includes("1:00 pm"), null, { timeout: 5000 });
  const opts = await clockTexts();
  const nine = opts.find((o) => o.v === "09:00"), one = opts.find((o) => o.v === "13:00");
  if (!nine.off || !/taken/i.test(nine.t)) throw new Error("09:00 should be switched off and say taken: " + JSON.stringify(nine));
  if (one.off) throw new Error("13:00 should be free");
  const txt = await page.innerText("#avail");
  if (!/at 1:00 pm/.test(txt) || /6:00 pm/.test(txt)) throw new Error("free window not written out inside 7 am to 4 pm: " + txt);
  const late = opts.find((o) => o.v === "14:00"), early = opts.find((o) => o.v === "06:00");
  for (const o of [late, early]) {
    if (o.off || !/confirm/i.test(o.t)) throw new Error("a time outside the trading hours should stay open as a request: " + JSON.stringify(o));
  }
  await noOverflowAndNoJunk("Pick with availability");
  await page.waitForTimeout(1200);
  await page.screenshot({ path: shots + "/dash-5-availability.png", fullPage: true });
});

await check("a full day says so and offers the next free dates, and a tap on one fills the date", async () => {
  await page.fill('#pick input[name="date"]', FULL);
  await page.waitForFunction(() => /full/i.test((document.getElementById("avail") || {}).innerText || ""), null, { timeout: 5000 });
  const chip = await page.$("#avail button[data-date]");
  if (!chip) throw new Error("no next-free-date buttons");
  const date = await chip.getAttribute("data-date");
  if (date === FULL) throw new Error("offered the full day itself");
  await chip.click();
  const now = await page.inputValue('#pick input[name="date"]');
  if (now !== date) throw new Error("the date was not filled: " + now);
});

await check("when the store cannot be reached, a Book tap is not hidden behind 'we will text you': the client can retry, text or ring", expectFailures(async () => {
  db.tables.holds = db.tables.holds.filter((h) => h.clientToken !== MOCK_CLIENT_TOKEN); // Alex booked earlier in this run
  await page.goto(url + "/#k=" + MOCK_CLIENT_TOKEN);
  await page.waitForSelector("#book");
  const holdsBefore = db.tables.holds.length;
  await page.route("**/api?action=request", (route) => route.abort());
  await page.click("#book");
  await page.waitForSelector("#fail");
  const txt = await page.innerText("#app");
  if (/we will text you/i.test(txt)) throw new Error("it still promises a text nobody knows to send");
  if (!/could(n't| not) confirm/i.test(txt)) throw new Error("no honest message: " + txt.slice(0, 300));
  const sms = await page.getAttribute('#fail a[href^="sms:"]', "href");
  if (!sms || !/December/.test(decodeURIComponent(sms))) throw new Error("the text is not pre-filled: " + sms);
  if (!(await page.$('#fail a[href^="tel:"]'))) throw new Error("no phone link");
  const orange = await page.$$eval("button.go:not(.ghost)", (bs) => bs.length);
  if (orange !== 1) throw new Error("expected one orange action while the retry shows, found " + orange);
  if (db.tables.holds.length !== holdsBefore) throw new Error("a hold was written by a request that never arrived");
  await noOverflowAndNoJunk("Unreachable");
  await page.waitForTimeout(600);
  await page.screenshot({ path: shots + "/dash-6-unreachable.png", fullPage: true });
  await page.unroute("**/api?action=request");
  await page.click("#retry");
  await page.waitForSelector("#pack-yes");
  if (db.tables.holds.length !== holdsBefore + 1) throw new Error("the retry did not hold the date");
}));

await check("a reply lost on the way back is not a second hold: Try again resends the same request id", expectFailures(async () => {
  await page.goto(url + "/#k=" + MOCK_RETURNING_TOKEN + "&v=pick");
  await page.waitForSelector("#pick");
  await page.fill('#pick input[name="date"]', "2026-12-28");
  const holdsBefore = db.tables.holds.length;
  await page.route("**/api?action=request", async (route) => { await route.fetch(); await route.abort(); });
  await page.click('#pick button[type="submit"]');
  await page.waitForSelector("#fail");
  if (db.tables.holds.length !== holdsBefore + 1) throw new Error("the store should have written the hold before the reply was lost");
  await page.unroute("**/api?action=request");
  await page.click("#retry");
  await page.waitForSelector("#pack-yes");
  if (db.tables.holds.length !== holdsBefore + 1) throw new Error("the retry made a second hold");
}));

await check("a store error and a refusal are told apart", expectFailures(async () => {
  await page.goto(url + "/#k=" + MOCK_HANDMADE_TOKEN);
  await page.waitForSelector("#pick");
  await page.fill('#pick input[name="date"]', "2026-12-29");
  await page.route("**/api?action=request", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: false, error: "store-error" }) }));
  await page.click('#pick button[type="submit"]');
  await page.waitForSelector("#fail");
  await page.unroute("**/api?action=request");
  await page.reload();
  await page.waitForSelector("#pick");
  await page.fill('#pick input[name="date"]', "2026-12-29");
  await page.route("**/api?action=request", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: false, error: "bad-people" }) }));
  await page.click('#pick button[type="submit"]');
  await page.waitForSelector(".notice");
  if (await page.$("#fail")) throw new Error("a refusal was shown as an outage");
  if (!/check/i.test(await page.innerText(".notice"))) throw new Error("no ask to check the details");
  if ((await page.inputValue('#pick input[name="date"]')) !== "2026-12-29") throw new Error("the form was cleared");
  await page.unroute("**/api?action=request");
}));

await check("opening a good link while the store is down says the store is not answering, not that the link is bad", expectFailures(async () => {
  await page.route("**/api?action=session", (route) => route.abort());
  await page.goto(url + "/#k=" + MOCK_CLIENT_TOKEN);
  await page.waitForFunction(() => /not answering/i.test(document.getElementById("app").innerText), null, { timeout: 5000 });
  const txt = await page.innerText("#app");
  if (/could not open this link/i.test(txt)) throw new Error("blamed the link");
  if (!(await page.$("#reload"))) throw new Error("no way to try again");
  await page.unroute("**/api?action=session");
  await page.click("#reload");
  await page.waitForFunction(() => /Your morning is held|Book this morning/.test(document.getElementById("app").innerText));
}));

await check("a confirmed booking shows the credits taken, the discount and what to pay", async () => {
  await page.goto(url + "/#k=" + MOCK_TWO_TOKEN + "&v=booking&b=bk-l1");
  await page.waitForSelector(".ticket");
  const txt = await page.innerText("#app");
  for (const want of ["$557", "10% off your first morning", "2 free hours (Team Captain)", "$62", "$619"]) {
    if (!txt.includes(want)) throw new Error("missing: " + want + " in " + txt.slice(0, 500));
  }
  await noOverflowAndNoJunk("Booking with credits");
  await page.waitForTimeout(1200);
  await page.screenshot({ path: shots + "/dash-7-credits.png", fullPage: true });
});

await check("the Refer screen states the offer for both sides, with progress toward the free hours", async () => {
  await page.goto(url + "/#k=" + MOCK_CLIENT_TOKEN + "&v=refer");
  await page.waitForSelector("#share");
  const txt = await page.innerText("#app");
  for (const want of ["Your friend gets 10% off their first morning", "third friend", "2 free hours", "1 of 3"]) {
    if (!txt.includes(want)) throw new Error("missing: " + want + " in " + txt.slice(0, 600));
  }
  if ((await page.$$("#app .dots span.on")).length !== 1) throw new Error("progress dots should show 1 done");
  await noOverflowAndNoJunk("Refer with offer");
  await page.waitForTimeout(1200);
  await page.screenshot({ path: shots + "/dash-8-refer-offer.png", fullPage: true });
});

await check("a client with credits waiting sees them on the landing screen, in the store's words", async () => {
  db.tables.holds = db.tables.holds.filter((h) => h.clientToken !== MOCK_CLIENT_TOKEN);
  await page.goto(url + "/#k=" + MOCK_CLIENT_TOKEN);
  await page.waitForSelector("#book");
  const txt = await page.innerText("#app");
  if (!txt.includes("Waiting for you") || !txt.includes("2 free hours on your next booking (Team Captain)")) throw new Error("credits not shown: " + txt.slice(0, 500));
});

await check("the Refer screen says when a friend's reward unlocks, and lists the credit that is waiting", async () => {
  await page.goto(url + "/#k=" + MOCK_CLIENT_TOKEN + "&v=refer");
  await page.waitForSelector("#share");
  const txt = await page.innerText("#app");
  if (!/Jo: booked.*unlocks after their morning/s.test(txt)) throw new Error("booked wording: " + txt.slice(0, 500));
  if (!/10% off your next booking/.test(txt) || !/use by/i.test(txt)) throw new Error("the waiting credit is not shown");
});

await check("no page errors", async () => {
  if (errors.length) throw new Error(errors.join(" | "));
});

await browser.close();
await new Promise((r) => server.close(r));
console.log(failures.length ? `\n${failures.length} check(s) failed` : "\nall checks passed");
process.exit(failures.length ? 1 : 0);
