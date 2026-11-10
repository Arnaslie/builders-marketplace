// Tiny helpers for telling mock listings apart from real ones. Kept separate from
// lib/mock/projects.ts so components that only need the check do not pull in the whole
// mock catalog.
export const MOCK_ID_PREFIX = "mock-";

export function isMockProject(id: string): boolean {
  return id.startsWith(MOCK_ID_PREFIX);
}

// Shown where a checkout would start. The API prices a sample for the shopping agent but refuses to
// check it out (and a mock must never reach PayPal).
export const SAMPLE_CART_NOTE = "Sample project: placeholder prices, so there is no checkout for it.";
