// Real-browser check of the paginated listing and its UI proposals (Playwright, Chromium).
// Run through verify.sh:  verify.sh drive RUN_ID listing-views
// Usage (direct): node listing-views.mjs <base-url> <evidence-dir>
// For every view at desktop (1366) and phone (375) width it records: card count, link targets,
// horizontal overflow, console errors and a full-page screenshot. It also checks that Lenis is
// running (html.lenis) and that a wheel scroll moves the page. Exits 1 on any failed expectation.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const [base, out] = process.argv.slice(2);
const VIEWS = ["classic", "industrial", "offgrid", "postmodern"];
const WIDTHS = { desktop: 1366, phone: 375 };

const browser = await chromium.launch();
const results = [];
const failures = [];

for (const view of VIEWS) {
  for (const [label, width] of Object.entries(WIDTHS)) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

    const url = `${base}/?view=${view}&page=2`;
    const res = await page.goto(url, { waitUntil: "networkidle" });
    const facts = await page.evaluate((v) => {
      const main = document.querySelector(`main.listing--${v}`);
      const links = [...document.querySelectorAll("main a[href^='/projects/']")].map((a) => a.getAttribute("href"));
      return {
        wrapper: Boolean(main),
        cards: new Set(links).size,
        h2InCards: document.querySelectorAll("main a[href^='/projects/'] h2").length,
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        lenis: document.documentElement.classList.contains("lenis"),
        sampleTags: document.querySelectorAll("main a[href^='/projects/'] li").length > 0,
      };
    }, view);

    // Lenis glides the scroll over several frames; wait, then read the settled position.
    await page.mouse.move(width / 2, 450);
    await page.mouse.wheel(0, 800);
    await page.waitForTimeout(1200);
    facts.scrolledY = await page.evaluate(() => Math.round(window.scrollY));
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);

    const shot = `listing-${view}-${label}.png`;
    await page.screenshot({ path: `${out}/${shot}`, fullPage: true });

    const row = { view, label, status: res?.status(), ...facts, errors, shot };
    results.push(row);
    const tag = `${view}/${label}`;
    if (row.status !== 200) failures.push(`${tag}: HTTP ${row.status}`);
    if (!row.wrapper) failures.push(`${tag}: missing main.listing--${view}`);
    if (row.cards !== 10) failures.push(`${tag}: ${row.cards} cards, expected 10`);
    if (row.h2InCards !== 10) failures.push(`${tag}: ${row.h2InCards} card <h2>s, expected 10`);
    if (row.overflowX > 0) failures.push(`${tag}: horizontal overflow ${row.overflowX}px`);
    if (!row.lenis) failures.push(`${tag}: Lenis not active (no html.lenis)`);
    if (row.scrolledY < 100) failures.push(`${tag}: wheel scroll moved only ${row.scrolledY}px`);
    if (errors.length) failures.push(`${tag}: console errors: ${errors.join(" | ")}`);
    await page.close();
  }
}

await browser.close();
writeFileSync(`${out}/listing-views.json`, JSON.stringify({ results, failures }, null, 2));
for (const r of results) {
  console.log(`${r.view.padEnd(10)} ${r.label.padEnd(7)} status=${r.status} cards=${r.cards} h2=${r.h2InCards} overflowX=${r.overflowX} lenis=${r.lenis} scrolledY=${r.scrolledY} errors=${r.errors.length}`);
}
if (failures.length) {
  console.log("FAIL\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("PASS");
