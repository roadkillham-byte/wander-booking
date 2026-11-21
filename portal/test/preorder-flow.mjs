// End-to-end check of the pre-order page in a headless browser at phone width: open the link, pick, save, come back and edit,
// a second person sees nothing of the first, a closed morning offers no form, and a wrong key says so. Run: node test/preorder-flow.mjs
import { createRequire } from "node:module";
import { startMock, MOCK_PREORDER_KEY, MOCK_PREORDER_CLOSED_KEY, MOCK_APP_TOKEN } from "../mock.mjs";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.HOME + "/render-engine/node_modules/playwright-core");
const shots = process.env.SHOTS || "/tmp";
const { server, url, db } = await startMock(4183);
const browser = await chromium.launch({ headless: true });
const ctxA = await browser.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 2 });
const page = await ctxA.newPage();
page.setDefaultTimeout(6000);
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
const failures = [];
const check = async (label, fn) => {
  try { await fn(); console.log("ok   " + label); }
  catch (e) { failures.push(label + ": " + e.message); console.log("FAIL " + label + " - " + e.message.split("\n")[0]); }
};
const clean = async (p, label) => {
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 0) throw new Error(label + " overflows by " + overflow + "px");
  const text = await p.evaluate(() => document.body.innerText);
  if (/undefined|NaN|\[object/.test(text)) throw new Error(label + " shows junk text");
};
const rows = () => db.tables.preorders;

await page.goto(url + "/#p=" + MOCK_PREORDER_KEY);
await page.waitForSelector("#preorder");
await check("the link opens the order form, with the day and time and nothing private", async () => {
  const txt = await page.innerText("#app");
  if (!txt.includes("Pick your order")) throw new Error("no heading");
  if (!/9 am to 12 pm/.test(txt)) throw new Error("time missing: " + txt.slice(0, 200));
  for (const secret of ["Morgan", "Lake Road", "$619", "619", "Alex"]) if (txt.includes(secret)) throw new Error("shows " + secret);
  if (!txt.includes("we delete them a week after the morning")) throw new Error("no collection notice");
  if (!txt.includes("Allergies or anything we should know (optional)")) throw new Error("no optional note");
  await clean(page, "form");
});
await page.waitForTimeout(1200);
await page.screenshot({ path: shots + "/preorder-1-form.png", fullPage: true });

await check("a missing choice asks for it and saves nothing", async () => {
  await page.fill('input[name="firstName"]', "Jo");
  await page.click("#save");
  await page.waitForSelector(".notice");
  if (!(await page.innerText("#app")).includes("Please choose a drink, a milk and a bowl.")) throw new Error("no prompt");
  if (rows().length !== 0) throw new Error("saved something");
});

await check("saving stores the pick and says so", async () => {
  await page.fill('input[name="firstName"]', "Jo");
  await page.selectOption('select[name="drink"]', "Flat White");
  await page.selectOption('select[name="milk"]', "Oat");
  await page.selectOption('select[name="bowl"]', "Granola Bowl");
  await page.fill('textarea[name="note"]', "nut allergy");
  await page.click("#save");
  await page.waitForSelector("#mine");
  const txt = await page.innerText("#app");
  if (!txt.includes("Saved.")) throw new Error("no confirmation");
  if (!txt.includes("Flat White") || !txt.includes("Oat") || !txt.includes("Granola Bowl")) throw new Error("summary wrong: " + txt);
  if (rows().length !== 1 || rows()[0].note !== "nut allergy" || rows()[0].firstName !== "Jo") throw new Error("row wrong: " + JSON.stringify(rows()));
  await clean(page, "saved");
});
await page.waitForTimeout(1200);
await page.screenshot({ path: shots + "/preorder-2-saved.png", fullPage: true });

await check("coming back shows their own order and editing it changes the same row", async () => {
  await page.reload();
  await page.waitForSelector("#preorder");
  const txt = await page.innerText("#app");
  if (!txt.includes("Your order: Flat White, Oat, Granola Bowl (Jo).")) throw new Error("own order missing: " + txt.slice(0, 300));
  if (!txt.includes("Update my order")) throw new Error("not an update");
  await page.selectOption('select[name="drink"]', "Latte");
  await page.click("#save");
  await page.waitForSelector("#mine");
  if (rows().length !== 1 || rows()[0].drink !== "Latte") throw new Error("not edited in place: " + JSON.stringify(rows()));
});

await check("a second person on the same link sees an empty form and nothing of the first", async () => {
  const ctxB = await browser.newContext({ viewport: { width: 360, height: 780 } });
  const p2 = await ctxB.newPage();
  await p2.goto(url + "/#p=" + MOCK_PREORDER_KEY);
  await p2.waitForSelector("#preorder");
  if (await p2.$("#mine")) throw new Error("shows an order that is not theirs");
  const vals = await p2.evaluate(() => ({ n: document.querySelector('input[name="firstName"]').value, d: document.querySelector('select[name="drink"]').value, note: document.querySelector('textarea[name="note"]').value, btn: document.getElementById("save").textContent }));
  if (vals.n !== "" || vals.d !== "" || vals.note !== "") throw new Error("form is prefilled: " + JSON.stringify(vals));
  if (vals.btn !== "Save my order") throw new Error("not a new order: " + vals.btn);
  await ctxB.close();
});

await check("a closed morning shows no form and says to walk up", async () => {
  await page.goto(url + "/#p=" + MOCK_PREORDER_CLOSED_KEY);
  await page.reload();
  await page.waitForSelector(".notice");
  const txt = await page.innerText("#app");
  if (!txt.includes("Orders for this morning have closed")) throw new Error("no closed notice: " + txt.slice(0, 200));
  if (await page.$("#preorder")) throw new Error("form still shown");
  await clean(page, "closed");
});
await page.waitForTimeout(1200);
await page.screenshot({ path: shots + "/preorder-3-closed.png", fullPage: true });

await check("a wrong key says the link could not be opened, and shows nothing else", async () => {
  await page.goto(url + "/#p=NOT-A-REAL-KEY-0123456789abcdef");
  await page.reload();
  await page.waitForSelector(".fail");
  const txt = await page.innerText("#app");
  if (!txt.includes("We could not open this link")) throw new Error(txt.slice(0, 200));
});

await check("Coffee Van can read every pick with its app token, and nobody else can", async () => {
  const read = async (k) => (await fetch(url + "/api?action=preorders", { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ k }) })).json();
  const ok = await read(MOCK_APP_TOKEN);
  if (!ok.ok || ok.picks.length !== 1 || ok.picks[0].drink !== "Latte") throw new Error(JSON.stringify(ok));
  const no = await read("wrong");
  if (no.ok) throw new Error("a wrong token read the picks");
});

if (errors.length) { failures.push("browser errors: " + errors.join("; ")); console.log("FAIL browser errors:", errors.join("; ")); }
await browser.close();
server.close();
console.log(failures.length ? "\n" + failures.length + " FAILED" : "\nall passed");
process.exit(failures.length ? 1 : 0);
