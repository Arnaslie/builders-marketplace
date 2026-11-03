// Listing (home index) settings shared by app/page.tsx and the components in components/listing/.
// The page number lives in the URL (?page=N) so every page is linkable and the page stays a
// server component: no client state, no hydration mismatch.

export const PAGE_SIZE = 10;

// Anything that is not a positive integer falls back to page 1; the page checks the upper bound.
export function parsePage(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

// Build an index URL, leaving out the default so "/" stays the canonical first page.
export function listingHref(page: number): string {
  return page > 1 ? `/?page=${page}` : "/";
}
