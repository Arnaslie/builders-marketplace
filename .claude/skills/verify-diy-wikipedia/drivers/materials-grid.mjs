// Real-browser check of the materials grid on /projects/simple-wooden-chair (Playwright, Chromium).
// Run through verify.sh:  verify.sh drive RUN_ID materials-grid
// Usage (direct): node materials-grid.mjs <base-url> <evidence-dir>
// Writes <evidence-dir>/materials-grid.json and materials-grid-{loaded,edited}.png; exits 1 on any
// failed expectation. Expected values are for the unedited contract/fixtures/chair.json; recompute
// them if that fixture changes (see features/web-pages.md).
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const [base, out] = process.argv.slice(2);
const EXPECT = {
  rows: 12,
  ownedTicked: 3,
  totalInitial: "$250.67",
  untickRow: "chair-drill", // first ticked row in fixture order
  totalAfterUntick: "$349.67", // + 1 x 99.00 drill
  qtyAfter: "5",
  totalAfterQty: "$356.23", // pine 2x2 qty 3 -> 5: + 2 x 3.28
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

const grid = "#materials-grid";
const total = () => page.locator("#materials-total").innerText();
const got = {};
try {
  await page.goto(`${base}/projects/simple-wooden-chair`, { waitUntil: "networkidle" });
  await page.waitForSelector(`${grid} .ag-row[row-id]`, { timeout: 15000 });
  got.rows = await page.locator(`${grid} .ag-row[row-id]`).count();
  got.headers = await page.locator(`${grid} .ag-header-cell-text`).allInnerTexts();
  got.ownedTicked = await page.locator(`${grid} input[type=checkbox]:checked`).count();
  got.totalInitial = await total();
  await page.screenshot({ path: `${out}/materials-grid-loaded.png`, fullPage: true });

  // Untick the first "Already own it" box: that line is added back into the total.
  const box = page.locator(`${grid} input[type=checkbox]:checked`).first();
  got.untickRow = await box.locator("xpath=ancestor::div[@row-id]").getAttribute("row-id");
  await box.click();
  await page.waitForTimeout(300);
  got.totalAfterUntick = await total();

  // Edit row 0's quantity to 5 through the number editor.
  const qty = page.locator(`${grid} .ag-row[row-index="0"] [col-id="qty"]`);
  await qty.dblclick();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("5");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  got.qtyAfter = (await qty.innerText()).trim();
  got.totalAfterQty = await total();
  await page.screenshot({ path: `${out}/materials-grid-edited.png`, fullPage: true });
} catch (e) {
  got.error = String(e.message || e).split("\n")[0];
}
await browser.close();

const failures = Object.entries(EXPECT)
  .filter(([k, v]) => got[k] !== v)
  .map(([k, v]) => `${k}: expected ${JSON.stringify(v)}, got ${JSON.stringify(got[k])}`);
if (got.error) failures.push(`error: ${got.error}`);
if (consoleErrors.length) failures.push(`console errors: ${consoleErrors.length}`);
const result = { pass: failures.length === 0, failures, got, consoleErrors };
writeFileSync(`${out}/materials-grid.json`, JSON.stringify(result, null, 2));
for (const [k, v] of Object.entries(got)) console.log(`${failures.some((f) => f.startsWith(k + ":")) ? "FAIL" : "ok  "} ${k} = ${JSON.stringify(v)}`);
for (const f of failures) console.log(`FAIL ${f}`);
console.log(result.pass ? "drive materials-grid: PASS" : "drive materials-grid: FAIL");
process.exit(result.pass ? 0 : 1);
