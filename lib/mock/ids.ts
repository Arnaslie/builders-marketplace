// Tiny helpers for telling mock listings apart from real ones. Kept separate from
// lib/mock/projects.ts so components that only need the check do not pull in the whole
// mock catalog.
export const MOCK_ID_PREFIX = "mock-";

export function isMockProject(id: string): boolean {
  return id.startsWith(MOCK_ID_PREFIX);
}

// Shown where a cart or checkout would start. The API has no record of mock ids, so it would
// answer 404 (and a mock must never reach PayPal).
export const SAMPLE_CART_NOTE = "Sample project: placeholder materials and prices, so there is no cart or checkout for it.";
