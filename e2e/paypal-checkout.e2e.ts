// PayPal sandbox smoke test: one real sandbox payment through the buyer's own UI.
//
//   1. Open a cart on the deployed site and click the PayPal button (inside PayPal's iframe).
//   2. Log in to the PayPal popup as the sandbox Personal (buyer) account and approve.
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
import { expect, test, type Page } from "@playwright/test";

const BUYER_EMAIL = process.env.PAYPAL_SANDBOX_BUYER_EMAIL;
const BUYER_PASSWORD = process.env.PAYPAL_SANDBOX_BUYER_PASSWORD;
const API_URL = (process.env.API_URL ?? "https://diy-wikipedia-api.onrender.com").replace(/\/$/, "");
const PROJECT = process.env.CART_PROJECT ?? "simple-wooden-chair";

test.skip(!BUYER_EMAIL || !BUYER_PASSWORD, "PAYPAL_SANDBOX_BUYER_EMAIL / _PASSWORD are not set");

// Sign in to the PayPal popup and approve the payment.
async function approveInPopup(popup: Page) {
  await popup.waitForLoadState("domcontentloaded");

  const email = popup.getByRole("textbox", { name: /email|mobile/i }).or(popup.locator("#email"));
  await email.first().fill(BUYER_EMAIL!);

  // Some sandbox sessions show email and password together; most split them with a Next button.
  const password = popup.locator("#password");
  if (!(await password.isVisible().catch(() => false))) {
    await popup.getByRole("button", { name: /^next$/i }).or(popup.locator("#btnNext")).first().click();
  }
  await password.fill(BUYER_PASSWORD!);
  await popup.getByRole("button", { name: /log ?in/i }).or(popup.locator("#btnLogin")).first().click();

  // Review page. The label has been "Pay Now", "Complete Purchase" and "Continue to Review" over time.
  await popup
    .getByRole("button", { name: /pay now|complete purchase|continue to review/i })
    .or(popup.locator("#payment-submit-btn"))
    .first()
    .click({ timeout: 60_000 });
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
