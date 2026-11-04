// PayPal sandbox smoke test: one real sandbox payment through the buyer's own UI.
//
//   1. Open a cart on the deployed site and click the PayPal button (inside PayPal's iframe).
//   2. Log in to the PayPal popup as the sandbox Personal (buyer) account, confirm the payment
//      method, choose to pay in full (not installments), and approve.
//   3. The app captures the order and lands on /checkout/success?order=<PayPal order id>.
//   4. Read the stored order back from the API and check it is paid and has a capture id.
//
// Docs this file follows:
//   Popups:  https://playwright.dev/docs/pages#handling-popups
//   Frames:  https://playwright.dev/docs/frames
//   Sandbox: https://developer.paypal.com/tools/sandbox/accounts/
//
// The buyer login comes from PAYPAL_SANDBOX_BUYER_EMAIL / PAYPAL_SANDBOX_BUYER_PASSWORD
// (GitHub Actions secrets in CI, a gitignored .env locally). It is never written to the repo.
// PayPal's own login pages change without notice; the selectors below match by role and text
// first and fall back to PayPal's long-standing element ids.
import { expect, test, type Locator, type Page } from "@playwright/test";

const BUYER_EMAIL = process.env.PAYPAL_SANDBOX_BUYER_EMAIL;
const BUYER_PASSWORD = process.env.PAYPAL_SANDBOX_BUYER_PASSWORD;
const API_URL = (process.env.API_URL ?? "https://diy-wikipedia-api.onrender.com").replace(/\/$/, "");
const PROJECT = process.env.CART_PROJECT ?? "simple-wooden-chair";

test.skip(!BUYER_EMAIL || !BUYER_PASSWORD, "PAYPAL_SANDBOX_BUYER_EMAIL / _PASSWORD are not set");

// Buttons that move the review flow forward. Anchored so they never match
// "Pay with Debit or Credit Card", "Pay in 4" or "Pay Later" offers.
const PRIMARY = /^(next|continue|continue to review|review order|complete purchase|pay now|pay|agree (&|and) (pay|continue))$/i;
// Installment / credit options the buyer must NOT pick: the test expects one full capture.
const INSTALLMENTS = /pay in \d|pay later|pay monthly|installment|paypal credit/i;

async function radioLabel(radio: Locator): Promise<string> {
  return radio.evaluate((el) => {
    const input = el as HTMLInputElement;
    const own = input.labels?.[0]?.innerText ?? el.getAttribute("aria-label") ?? "";
    return own || (el.closest("label, li, [role=listitem]") as HTMLElement | null)?.innerText || "";
  });
}

// Review page: choose to pay in full, and make sure a non-installment funding source is selected.
// Both are optional because PayPal only shows them for some sandbox accounts and amounts.
async function choosePayInFull(popup: Page) {
  const payInFull = popup.getByRole("radio", { name: /pay in full|full amount/i }).or(popup.getByLabel(/pay in full/i));
  if (await payInFull.first().isVisible().catch(() => false)) {
    await payInFull.first().check();
  }

  const radios = await popup.getByRole("radio").all();
  let fundingOk = false;
  for (const radio of radios) {
    if (!(await radio.isChecked().catch(() => false))) continue;
    fundingOk = !INSTALLMENTS.test(await radioLabel(radio));
    if (fundingOk) break;
  }
  if (fundingOk || radios.length === 0) return;

  // Nothing safe is selected (or an installment plan is): pick the first plain funding source.
  for (const radio of radios) {
    if (!(await radio.isVisible().catch(() => false))) continue;
    if (INSTALLMENTS.test(await radioLabel(radio))) continue;
    await radio.check();
    return;
  }
  throw new Error("PayPal review page offers no pay-in-full funding source");
}

// Sign in to the PayPal popup and approve the payment.
async function approveInPopup(popup: Page) {
  await popup.waitForLoadState("domcontentloaded");

  await test.step("PayPal login: email", async () => {
    const email = popup.getByRole("textbox", { name: /email|mobile/i }).or(popup.locator("#email"));
    await email.first().fill(BUYER_EMAIL!);
    // Split login. #password is already in the DOM (off-screen) before Next, so its
    // visibility cannot tell us whether Next is needed. The Next button can.
    const next = popup.getByRole("button", { name: /^next$/i }).or(popup.locator("#btnNext")).first();
    if (await next.isVisible().catch(() => false)) await next.click();
  });

  await test.step("PayPal login: password", async () => {
    const login = popup.getByRole("button", { name: /^log ?in$/i }).or(popup.locator("#btnLogin")).first();
    await expect(login).toBeVisible({ timeout: 30_000 });
    await popup.locator("#password").fill(BUYER_PASSWORD!);
    await login.click();
  });

  // After login PayPal can show one or more pages: payment method, pay in full vs installments,
  // then the final confirm. Work through them until the popup closes (the buyer approved).
  for (let pageNo = 1; pageNo <= 4 && !popup.isClosed(); pageNo++) {
    await test.step(`PayPal review page ${pageNo}: payment method, pay in full, confirm`, async () => {
      const primary = popup.getByRole("button", { name: PRIMARY }).or(popup.locator("#payment-submit-btn")).first();
      await expect(primary).toBeVisible({ timeout: 60_000 });
      await choosePayInFull(popup);
      await primary.click();
      // Either the popup closes (approved) or this page's button goes away (next page loaded).
      await Promise.race([
        popup.waitForEvent("close", { timeout: 60_000 }),
        primary.waitFor({ state: "detached", timeout: 60_000 }),
      ]).catch(() => {});
    });
  }
  expect(popup.isClosed(), "PayPal popup should close once the buyer approves").toBe(true);
}

test("sandbox buyer pays for a cart and the order is stored as paid", async ({ page, request }) => {
  // Wake both free Render services before the clock matters.
  await expect
    .poll(async () => (await request.get(`${API_URL}/healthz`)).status(), { timeout: 120_000, intervals: [5_000] })
    .toBe(200);

  const config = await (await request.get(`${API_URL}/checkout/config`)).json();
  expect(config.env, "this test must never run against live PayPal").toBe("sandbox");

  await page.goto(`/cart?project=${encodeURIComponent(PROJECT)}`);
  await expect(page.getByRole("heading", { name: "Cart", level: 1 })).toBeVisible();
  await expect(page.getByText("PayPal sandbox.", { exact: false })).toBeVisible();

  // The PayPal button lives in an iframe that the SDK injects into #paypal-buttons.
  const button = page.frameLocator("#paypal-buttons iframe").first().locator('[data-funding-source="paypal"]');
  const [popup] = await Promise.all([page.waitForEvent("popup"), button.click()]);
  await approveInPopup(popup);

  // onApprove captures server-side, then routes to the success page.
  await page.waitForURL(/\/checkout\/success\?order=/, { timeout: 90_000 });
  const orderId = new URL(page.url()).searchParams.get("order");
  expect(orderId).toBeTruthy();

  await expect(page.getByRole("heading", { name: "Order received", level: 1 })).toBeVisible();
  await expect(page.getByText("Fulfilment simulated for demo")).toBeVisible();

  // What the server stored, not what the browser was told.
  const res = await request.get(`${API_URL}/checkout/orders/${encodeURIComponent(orderId!)}`);
  expect(res.status()).toBe(200);
  const order = await res.json();
  expect(order.status).toBe("paid");
  expect(order.paypalOrderId).toBe(orderId);
  expect(order.paypalCaptureId).toBeTruthy();
  expect(order.lines.length).toBeGreaterThan(0);
});
