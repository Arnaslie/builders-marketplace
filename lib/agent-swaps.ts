// Pure logic behind the shopping agent panel (issue #5), kept out of the component so it can be
// tested without a browser: budget parsing, the request the panel sends, and how a swap reads.
import { buildCart, usingApi, type BuildCartRequest, type Cart, type Swap } from "./api/client";
import { cartHref } from "./cart-link";
import { formatMoney } from "./money";

const BUDGET_PATTERN = /^\d{1,7}(\.\d{1,2})?$/;

// "200" and "200.5" become "200.00" and "200.50", the contract's money format.
export function parseBudget(raw: string): { ok: true; value: string | undefined } | { ok: false } {
  const text = raw.trim().replace(/^\$/, "");
  if (text === "") return { ok: true, value: undefined };
  if (!BUDGET_PATTERN.test(text)) return { ok: false };
  const [whole, frac = ""] = text.split(".");
  return { ok: true, value: `${whole}.${frac.padEnd(2, "0")}` };
}

// "Swapped Hammer for Cheap hammer, saves $12.00". The amount is the server's string, formatted
// only for display.
export function swapSentence(swap: Swap, currency: string): string {
  return `Swapped ${swap.from.name} for ${swap.to.name}, saves ${formatMoney(swap.savings, currency)}`;
}

// The grid rows the agent changed; the grid highlights these ids.
export function swappedLineIds(cart: Cart): string[] {
  return cart.swaps.map((swap) => swap.lineId);
}

export type CartOutcome = { ok: true; cart: Cart; href: string } | { ok: false; error: string };

type Input = {
  projectId: string;
  slug: string;
  lineIds: string[];
  owned: Record<string, boolean>; // the grid's "Already own it" toggles, keyed by line id
  budgetText: string;
  apiAvailable?: boolean;
};

// Validates the form, sends { projectId, owned, budget } to POST /agent/build-cart and returns
// either the cart or a message for the panel. Never throws. `build` is injectable for tests.
export async function requestCart(
  input: Input,
  build: (request: BuildCartRequest) => Promise<Cart> = buildCart,
): Promise<CartOutcome> {
  if (!(input.apiAvailable ?? usingApi)) {
    return { ok: false, error: "The shopping agent needs the API server (NEXT_PUBLIC_API_URL is not set on this copy of the site)." };
  }
  const parsed = parseBudget(input.budgetText);
  if (!parsed.ok) return { ok: false, error: "Budget must be an amount such as 200 or 199.99." };
  const ownedIds = input.lineIds.filter((id) => input.owned[id]);
  try {
    const cart = await build({ projectId: input.projectId, owned: ownedIds, ...(parsed.value ? { budget: parsed.value } : {}) });
    return { ok: true, cart, href: cartHref(input.slug, ownedIds, parsed.value, cart) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not build the cart." };
  }
}
