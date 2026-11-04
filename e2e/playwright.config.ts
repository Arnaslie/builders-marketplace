// Playwright config for the PayPal sandbox smoke test. Docs this file follows:
//   Config:  https://playwright.dev/docs/test-configuration
//   Retries: https://playwright.dev/docs/test-retries
//
// Runs against an already-deployed site (the live Render services by default), not a local build:
// the point is to prove the real sandbox path end to end, PayPal popup included.
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: "*.e2e.ts", // not *.spec.ts, so the root vitest run never picks this up
  timeout: 180_000, // free Render instances cold start, and the PayPal sandbox is slow
  expect: { timeout: 30_000 },
  retries: 1, // the sandbox login page is known to be flaky
  workers: 1, // one real sandbox order at a time
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: process.env.BASE_URL ?? "https://diy-wikipedia.onrender.com",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
