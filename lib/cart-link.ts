// The cart is described by its URL, so the agent panel can hand its exact cart to /cart:
//   /cart?project=<slug>&owned=<line id>,<line id>&budget=200.00&swaps=<line id>:<alt index>,...
// `swaps` absent means "let the deterministic rules choose"; `swaps=` (empty) means "no swaps".
// The server re-checks every pick, so this format carries choices, never prices.
import type { Cart, CartRequest, SwapPick } from "./api/client";

const MONEY = /^\d{1,7}\.\d{2}$/;
const PICK = /^([a-z0-9-]+):(\d{1,3})$/;

type Params = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export function cartHref(slug: string, owned: string[], budget: string | undefined, cart: Cart): string {
  const params = new URLSearchParams({ project: slug });
  if (owned.length > 0) params.set("owned", owned.join(","));
  if (budget) params.set("budget", budget);
  params.set("swaps", cart.swaps.map((swap) => `${swap.lineId}:${swap.altIndex}`).join(","));
  // URLSearchParams encodes ":" and ","; both are safe in a query, so keep the link readable.
  return `/cart?${params.toString().replace(/%3A/g, ":").replace(/%2C/g, ",")}`;
}

// Returns null when `swaps` is present but malformed, so the page can say the link is broken
// instead of silently charging a different cart.
export function cartRequestFromParams(projectId: string, params: Params): CartRequest | null {
  const owned = (one(params.owned) ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const budget = one(params.budget);
  const request: CartRequest = { projectId, owned, ...(budget && MONEY.test(budget) ? { budget } : {}) };

  const rawSwaps = one(params.swaps);
  if (rawSwaps === undefined) return request;
  const swaps: SwapPick[] = [];
  for (const part of rawSwaps.split(",").map((p) => p.trim()).filter(Boolean)) {
    const match = PICK.exec(part);
    if (!match) return null;
    swaps.push({ lineId: match[1], altIndex: Number(match[2]) });
  }
  return { ...request, swaps };
}
