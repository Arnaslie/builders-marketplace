// Real-browser check of the 1994-style site design (Playwright, Chromium).
// Run through verify.sh:  verify.sh drive RUN_ID listing-views
// Usage (direct): node listing-views.mjs <base-url> <evidence-dir>
// At desktop (1366) and phone (375) width it loads index pages 1 and 5, a project page and the
// recommend page, and records: the masthead seal and welcome line, exactly one <h1>, project link
// and banner counts on index pages, the Times font, horizontal overflow, console errors and a
// full-page screenshot. On index pages it also checks that Lenis is running (html.lenis) and that
// a wheel scroll moves the page. Exits 1 on any failed expectation.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const [base, out] = process.argv.slice(2);
const PAGES = [
  { name: "index-p1", path: "/", index: true },
  { name: "index-p5", path: "/?page=5", index: true },
  { name: "project", path: "/projects/simple-wooden-chair", index: false },
  { name: "recommend", path: "/recommend", index: false },
];
const WIDTHS = { desktop: 1366, phone: 375 };

const browser = await chromium.launch();
const results = [];
const failures = [];

for (const target of PAGES) {
  for (const [label, width] of Object.entries(WIDTHS)) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

    const res = await page.goto(`${base}${target.path}`, { waitUntil: "networkidle" });
    const facts = await page.evaluate(() => {
      const links = [...document.querySelectorAll("main a[href^='/projects/']")];
      return {
        seal: Boolean(document.querySelector(".masthead svg.seal")),
        welcome: document.querySelector(".masthead-title")?.textContent?.trim() ?? "",
        h1s: document.querySelectorAll("h1").length,
        cards: new Set(links.map((a) => a.getAttribute("href"))).size,
        banners: document.querySelectorAll("main a[href^='/projects/'] .banner").length,
        font: getComputedStyle(document.body).fontFamily,
        edition: /Current Edition for /.test(document.querySelector(".site-footer")?.textContent ?? ""),
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        lenis: document.documentElement.classList.contains("lenis"),
      };
    });

    if (target.index) {
      // Lenis glides the scroll over several frames; wait, then read the settled position.
      await page.mouse.move(width / 2, 450);
      await page.mouse.wheel(0, 800);
      await page.waitForTimeout(1200);
      facts.scrolledY = await page.evaluate(() => Math.round(window.scrollY));
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(300);
    }

    const shot = `site-${target.name}-${label}.png`;
    await page.screenshot({ path: `${out}/${shot}`, fullPage: true });

    const row = { page: target.name, label, status: res?.status(), ...facts, errors, shot };
    results.push(row);
    const tag = `${target.name}/${label}`;
    if (row.status !== 200) failures.push(`${tag}: HTTP ${row.status}`);
    if (!row.seal) failures.push(`${tag}: masthead seal missing`);
    if (row.welcome !== "Welcome to the DIY Wikipedia Server") failures.push(`${tag}: welcome line is "${row.welcome}"`);
    if (row.h1s !== 1) failures.push(`${tag}: ${row.h1s} <h1>s, expected 1`);
    if (!/Times/.test(row.font)) failures.push(`${tag}: body font is ${row.font}`);
    if (!row.edition) failures.push(`${tag}: Current Edition dateline missing`);
    if (row.overflowX > 0) failures.push(`${tag}: horizontal overflow ${row.overflowX}px`);
    if (!row.lenis) failures.push(`${tag}: Lenis not active (no html.lenis)`);
    if (target.index) {
      if (row.cards !== 10) failures.push(`${tag}: ${row.cards} project links, expected 10`);
      if (row.banners !== 10) failures.push(`${tag}: ${row.banners} banners inside project links, expected 10`);
      if (row.scrolledY < 100) failures.push(`${tag}: wheel scroll moved only ${row.scrolledY}px`);
    }
    if (errors.length) failures.push(`${tag}: console errors: ${errors.join(" | ")}`);
    await page.close();
  }
}

await browser.close();
writeFileSync(`${out}/listing-views.json`, JSON.stringify({ results, failures }, null, 2));
for (const r of results) {
  console.log(`${r.page.padEnd(10)} ${r.label.padEnd(7)} status=${r.status} h1=${r.h1s} links=${r.cards} banners=${r.banners} overflowX=${r.overflowX} lenis=${r.lenis} scrolledY=${r.scrolledY ?? "-"} errors=${r.errors.length}`);
}
if (failures.length) {
  console.log("FAIL\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("PASS");
