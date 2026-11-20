// The Office Club (the old 4-Pack under its new name), the retired prepaid option, the optional photographer, the website door, the review link for everyone.
const test = require("node:test"); const assert = require("node:assert");
const fs = require("fs");
const html = fs.readFileSync(__dirname + "/index.html", "utf8"), tap = fs.readFileSync(__dirname + "/tap.html", "utf8");
const T = require("./track.js");

test("the Office Club is the old 4-Pack: same stored value, new visible name, three real perks", () => {
  assert.ok(/<input type="radio" name="package" value="Office Club 4-Pack"><span>Office Club: four mornings, price locked 12 months<\/span>/.test(html));
  assert.ok(html.includes("<summary>Four mornings? See the Office Club</summary>"));
  assert.ok(!/4-Pack<\/strong>|>4-Pack, price|See the 4-Pack/.test(html), "no visible 4-Pack name is left");
  const perks = (html.match(/<ul class="perks">[\s\S]*?<\/ul>/) || [""])[0];
  for (const w of ["A standing morning.", "Last-minute?", "Need a break?"]) assert.ok(perks.includes(w), w);
  assert.ok(/half a day's notice/.test(perks) && /up to 6 weeks/.test(perks));
});

test("the prepaid contract is retired from the form: hidden option and fold-out, back end untouched", () => {
  assert.ok(/<label hidden><input type="radio" name="package" value="Prepaid contract">/.test(html));
  assert.ok(/<details class="packwrap" id="contractwrap" hidden>/.test(html));
});

test("photographer: only with a rate, carried as hours (0 for none), pre-ticked by ?photo=", () => {
  assert.ok(/window\.WANDER_PHOTO_RATE = 80;/.test(fs.readFileSync(__dirname + "/config.js", "utf8")));
  assert.ok(/id="photo-wrap" hidden/.test(html), "hidden until a rate exists");
  assert.ok(/photographer: PHOTO_RATE && photoBox\.checked \? hours\(\) : 0/.test(html));
  assert.ok(/\[2-6\]\$\/\.test\(new URLSearchParams\(location\.search\)\.get\("photo"\)/.test(html));
});

test("the website door is a request field of its own, cleaned, never a utm tag", () => {
  assert.ok(/get\("from"\) \|\| ""; return \/\^\[a-z0-9_-\]\{1,20\}\$\/\.test\(v\) \? v : ""/.test(html));
  assert.ok(/photographer: [^\n]*from: fromDoor/.test(html));
});

test("tap.html gives every rating the same review link (no review gating)", () => {
  const rating = tap.slice(tap.indexOf('hit.q === "rating"'), tap.indexOf("main.innerHTML = body;"));
  const links = rating.match(/leave a review/g) || [];
  assert.strictEqual(links.length, 1, "one review invitation");
  assert.ok(!/outcome === "good"\)[^\n]*review/.test(rating), "the link is not inside the good branch");
  assert.ok(rating.indexOf("leave a review") > rating.indexOf('else body += "<p>We appreciate you telling us'), "after every outcome branch");
});

test("track contract: the generic named event keeps short strings and numbers only", () => {
  assert.deepStrictEqual(T.sanitise("ev", { n: "section_view", a: "value", b: "x".repeat(80), v: 3, junk: "no" }), { t: "ev", d: { n: "section_view", a: "value", b: "x".repeat(40), v: 3 } });
  assert.strictEqual(T.sanitise("nope", { n: "x" }), null);
});

test("tap.html: photo consent is one tap, stored under the booking, and children need a parent or guardian", () => {
  const { resolveTap } = require("./links.js");
  assert.deepEqual(resolveTap("photos", "yes"), { q: "photos", a: "yes" });
  assert.deepEqual(resolveTap("photos", "no"), { q: "photos", a: "no" });
  assert.equal(resolveTap("photos", "maybe"), null);
  assert.ok(/hit\.q === "photos"/.test(tap) && /parent or guardian/.test(tap) && /never of children/.test(tap));
  assert.ok(/t\.track\("tap", \{ q: hit\.q, a: hit\.a, r: r \}\)/.test(tap), "stored with the request id");
});
