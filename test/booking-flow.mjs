// The booking page in a headless browser at phone width, with the store and the intake answered by this script (nothing real is called):
// the copy that was removed stays removed, a request that goes through replaces the form with a plain confirmation (no stuck grey
// button), a request the store could not hold says "Request sent" and not "held", a failure keeps the form and the button usable,
// and the details typed are never asked for again on this page. Run: node test/booking-flow.mjs
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.HOME + "/render-engine/node_modules/playwright-core");
const root = join(fileURLToPath(new URL("..", import.meta.url)));
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".woff2": "font/woff2" };
const server = createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  const rel = u.pathname.endsWith("/") ? u.pathname + "index.html" : u.pathname;
  try { const d = await readFile(join(root, rel)); res.writeHead(200, { "Content-Type": types[extname(rel)] || "application/octet-stream" }); res.end(d); }
  catch { res.writeHead(404); res.end("nf"); }
});
await new Promise((r) => server.listen(4189, "127.0.0.1", r));
const base = "http://127.0.0.1:4189/index.html";
const browser = await chromium.launch({ headless: true });
const failures = [];
const check = async (label, fn) => {
  try { await fn(); console.log("ok   " + label); } catch (e) { failures.push(label + ": " + e.message); console.log("FAIL " + label + " - " + e.message.split("\n")[0]); }
};

// What the page sent, and what the pretend store and intake say back.
async function open(outcome, intakeOk = true) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(6000);
  const sent = { newhold: [], intake: [] };
  await page.route("https://script.google.com/**", async (route) => {
    const url = route.request().url();
    const body = route.request().postData() || "{}";
    let reply = { ok: true };
    if (url.includes("action=newhold")) { sent.newhold.push(JSON.parse(body)); reply = { ok: true, outcome, key: "KEY0123456789abcdef", replyWithinHours: 24 }; }
    else if (url.includes("action=opentimes")) reply = { ok: false };
    else { const b = JSON.parse(body); if (b.action === "booking") { sent.intake.push(b); reply = intakeOk ? { ok: true } : { ok: false }; } }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(reply) });
  });
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await page.goto(base + "?people=45&hours=4");
  return { page, ctx, sent };
}
async function fillAndSend(page) {
  const sat = new Date(Date.now() + 14 * 86400000); sat.setDate(sat.getDate() + ((6 - sat.getDay() + 7) % 7));
  const date = sat.toISOString().slice(0, 10);
  await page.fill("#name", "Test Person");
  await page.fill("#phone", "0400 000 111");
  await page.fill("#email", "test.person@example.com");
  await page.fill("#date", date);
  await page.locator("#start-chips .chip").first().click();
  await page.selectOption("#suburb", { index: 1 });
  await page.fill("#address", "1 Test Street");
  await page.click("#go");
  return date;
}

await check("the removed copy is gone and the numbers from the Wander site arrive filled in", async () => {
  const { page, ctx } = await open("held");
  const text = await page.evaluate(() => document.body.innerText + " " + document.querySelector('meta[name="description"]').content);
  for (const gone of ["weekend morning", "sure thing", "a head, everything included", "Any bowl · Unlimited drinks", "Late, no-show or not right", "Our guarantees", "What you get"]) {
    if (text.toLowerCase().includes(gone.toLowerCase())) throw new Error("still shows: " + gone);
  }
  if (!/A morning your people\s+talk about/i.test(text)) throw new Error("headline not changed: " + text.slice(0, 80));
  if ((await page.inputValue("#people")) !== "45") throw new Error("people not carried in");
  if ((await page.inputValue('input[name="hours"]:checked')) !== "4") throw new Error("hours not carried in");
  await ctx.close();
});

await check("a held request replaces the form with a plain confirmation and a working link to the client's own page", async () => {
  const { page, ctx, sent } = await open("held");
  const date = await fillAndSend(page);
  await page.waitForSelector("#sent:not([hidden])");
  if (await page.isVisible("#form")) throw new Error("the form is still showing");
  const text = await page.innerText("#sent");
  for (const need of ["Your date is held!", "Check your inbox", "wandermcco@gmail.com", "spam or junk", "0400 000 111", "1 Test Street", "45", "4"]) if (!text.includes(need)) throw new Error("missing: " + need);
  const href = await page.getAttribute("#sent-page", "href");
  if (href !== "portal/#k=KEY0123456789abcdef") throw new Error("link is " + href);
  if (sent.newhold.length !== 1 || sent.intake.length !== 1) throw new Error("expected one hold and one intake, got " + sent.newhold.length + "/" + sent.intake.length);
  if (sent.intake[0].date !== date || sent.intake[0].people !== 45 || sent.intake[0].hours !== 4) throw new Error("intake did not get the details");
  const visibleDisabled = await page.evaluate(() => [...document.querySelectorAll("button[disabled]")].filter((b) => b.offsetParent !== null).length);
  if (visibleDisabled) throw new Error("a greyed-out button is still showing");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 0) throw new Error("overflows by " + overflow);
  await ctx.close();
});

await check("ticking the photographer updates the price tag (and unticking puts it back), and the confirmation shows it", async () => {
  const { page, ctx } = await open("held");
  const money = (n) => "$" + n.toLocaleString("en-AU");
  const base = await page.evaluate(() => window.WanderQuote.quote(45, 4));
  const tag = async () => (await page.innerText("#amt")).replace(/\s+/g, "");
  if ((await tag()) !== money(base)) throw new Error("starting tag " + (await tag()) + " is not " + money(base));
  await page.check("#photographer");
  if ((await tag()) !== money(base + 320)) throw new Error("tag with photographer is " + (await tag()) + ", expected " + money(base + 320));
  if (!/with a 4-hour photographer/.test(await page.innerText("#sub"))) throw new Error("the line under the price does not say so: " + (await page.innerText("#sub")));
  await page.uncheck("#photographer");
  if ((await tag()) !== money(base)) throw new Error("untick did not restore the price");
  await page.check("#photographer");
  await fillAndSend(page);
  await page.waitForSelector("#sent:not([hidden])");
  const t = await page.innerText("#sent");
  if (!/photographer/i.test(t) || !t.includes("4 hours, $320") || !t.includes(money(base + 320))) throw new Error("confirmation misses the photographer or the whole price: " + t.replace(/\s+/g, " ").slice(0, 400));
  await ctx.close();
});

await check("a request the store could not hold says it was sent, not held", async () => {
  const { page, ctx } = await open("requested");
  await fillAndSend(page);
  await page.waitForSelector("#sent:not([hidden])");
  const text = await page.innerText("#sent");
  if (!text.includes("Request sent!") || text.includes("is held")) throw new Error("wrong headline: " + text.slice(0, 60));
  if (!text.includes("We confirm the date when we ring")) throw new Error("no confirm-on-the-call line");
  await ctx.close();
});

await check("from the confirmation, the form comes back with the details still in it and a live button", async () => {
  const { page, ctx } = await open("held");
  await fillAndSend(page);
  await page.waitForSelector("#sent:not([hidden])");
  await page.click("#sent-again");
  if (!(await page.isVisible("#form"))) throw new Error("form not back");
  if ((await page.inputValue("#name")) !== "Test Person") throw new Error("details lost");
  if (await page.isDisabled("#go")) throw new Error("button still disabled");
  if (!/Get my price/.test(await page.innerText("#go"))) throw new Error("button label not restored: " + (await page.innerText("#go")));
  await ctx.close();
});

await check("when the intake fails, the form stays, the button works again and the problem is said plainly", async () => {
  const { page, ctx } = await open("held", false);
  await fillAndSend(page);
  await page.waitForSelector("#msg:not([hidden])");
  if (!(await page.isVisible("#form"))) throw new Error("form hidden after a failure");
  if (await page.isDisabled("#go")) throw new Error("button stuck disabled");
  if (!(await page.innerText("#msg")).includes("0492 801 058")) throw new Error("no phone number in the failure");
  if (await page.isVisible("#sent")) throw new Error("confirmation showed after a failure");
  await ctx.close();
});

await browser.close();
server.close();
if (failures.length) { console.log("\n" + failures.length + " failed"); process.exit(1); }
console.log("\nall passed");
