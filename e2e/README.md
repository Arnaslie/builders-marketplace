# PayPal sandbox e2e

One real sandbox payment through the buyer's own PayPal popup: cart, PayPal login, approve, success page, then the stored order read back from the API (`status: paid`, capture id present).

It is its own npm package so the site's lockfile, `next build` and `vitest` never see Playwright.

## Run on GitHub

Actions > **PayPal sandbox e2e** > **Run workflow**. Inputs default to the live Render services and `simple-wooden-chair`.

Needs two repository secrets, from the sandbox **Personal** account (developer.paypal.com > Testing Tools > Sandbox Accounts):

- `PAYPAL_SANDBOX_BUYER_EMAIL`
- `PAYPAL_SANDBOX_BUYER_PASSWORD`

On failure, download the `playwright-report` artifact and open the trace with `npx playwright show-trace`.

## Run locally

```
cd e2e
npm install
npx playwright install chromium
PAYPAL_SANDBOX_BUYER_EMAIL=... PAYPAL_SANDBOX_BUYER_PASSWORD=... npx playwright test --headed
```

Optional: `BASE_URL`, `API_URL`, `CART_PROJECT`. The test refuses to run if `/checkout/config` does not report `env: sandbox`.

## Known flakiness

PayPal's sandbox login sometimes shows a CAPTCHA, a one-time-code step, or a changed layout. The test retries once; if it keeps failing at the popup, check the trace before changing app code.
