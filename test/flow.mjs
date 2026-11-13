// End-to-end check of the client journey in a headless browser at phone width: link, Held, Book, the 4-Pack offer,
// a plain decline, and the confirmation. Run: node test/flow.mjs   (uses the Playwright install in render-engine).
import { createRequire } from "node:module";
import { startMock, MOCK_CLIENT_TOKEN, MOCK_RETURNING_TOKEN } from "../mock.mjs";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.HOME + "/render-engine/node_modules/playwright-core");

const shots = process.env.SHOTS || "/tmp";
const { server, url } = await startMock(4181);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 2 });
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
  await page.waitForSelector("#book");
  if ((await page.innerText("#app")).includes("Same again")) throw new Error("a first-time client was offered Same again");
  await page.goto(url + "/#k=" + MOCK_RETURNING_TOKEN);
  await page.waitForSelector("#again");
  const label = await page.innerText("#again");
  if (!/^Same again, /.test(label)) throw new Error("button text: " + label);
  await noOverflowAndNoJunk("Same again");
  await page.click("#again");
  await page.waitForSelector("#pack-yes");
});

await check("a bad link shows a plain message, never an error page", async () => {
  await page.goto(url + "/#k=NOT-A-TOKEN");
  await page.waitForFunction(() => document.getElementById("app").innerText.includes("could not open this link"), null, { timeout: 5000 });
});

await check("no page errors", async () => {
  if (errors.length) throw new Error(errors.join(" | "));
});

await browser.close();
await new Promise((r) => server.close(r));
console.log(failures.length ? `\n${failures.length} check(s) failed` : "\nall checks passed");
process.exit(failures.length ? 1 : 0);
