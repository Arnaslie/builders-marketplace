// Listing (home gallery) settings shared by app/page.tsx and the components in components/listing/.
// State lives in the URL (?view=...&page=...) so every page and proposal is linkable and the page
// stays a server component: no client state, no hydration mismatch.

export const PAGE_SIZE = 10;

// "classic" is the current masonry; the other three are the UI proposals under review.
export const VIEWS = [
  { id: "classic", label: "Classic" },
  { id: "industrial", label: "Industrial Revolution" },
  { id: "offgrid", label: "Off the Grid" },
  { id: "postmodern", label: "Post-Modern" },
] as const;

export type ViewId = (typeof VIEWS)[number]["id"];

export function parseView(value: string | string[] | undefined): ViewId {
  const raw = Array.isArray(value) ? value[0] : value;
  return VIEWS.some((v) => v.id === raw) ? (raw as ViewId) : "classic";
}

// Anything that is not a positive integer falls back to page 1; the page checks the upper bound.
export function parsePage(value: string | string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

// Build a gallery URL, leaving out defaults so "/" stays the canonical first page.
export function listingHref(view: ViewId, page: number): string {
  const params = new URLSearchParams();
  if (view !== "classic") params.set("view", view);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/?${query}` : "/";
}
