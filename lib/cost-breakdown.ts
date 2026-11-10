// Pure data behind the cost-breakdown charts (issue #8, components/cost-charts.tsx), kept free of
// AG Charts so it is unit-testable. It reads the same line state as the materials grid
// (lib/grid-totals.ts): qty, price and the "Already own it" toggle, so an owned line adds nothing.
// A swap the shopping agent made (lib/agent-swaps.ts) replaces that line's unit price and retailer
// with the swapped-in product's. All money is integer cents (lib/money.ts).
import type { Swap } from "./api/client";
import { GROUP_LABEL, GROUP_ORDER, lineCents, type Category, type LineInput } from "./grid-totals";
import { toCents } from "./money";

export type BreakdownLine = LineInput & { retailer: string };

export type BreakdownSwap = Pick<Swap, "lineId"> & { to: Pick<Swap["to"], "price" | "retailer"> };

export type CostSlice = { label: string; cents: number };

export type CostBreakdown = {
  totalCents: number;
  byCategory: CostSlice[]; // Tools then Materials; always both, even at 0
  byRetailer: CostSlice[]; // biggest spend first; retailers with 0 spend are left out
};

export const UNKNOWN_RETAILER = "Unknown retailer";

// The line as it will be bought: swapped lines take the new product's price and retailer.
export function applySwaps(lines: readonly BreakdownLine[], swaps: readonly BreakdownSwap[]): BreakdownLine[] {
  const byLine = new Map(swaps.map((swap) => [swap.lineId, swap.to]));
  return lines.map((line) => {
    const to = byLine.get(line.id);
    return to ? { ...line, price: to.price, retailer: to.retailer } : line;
  });
}

export function costBreakdown(lines: readonly BreakdownLine[], swaps: readonly BreakdownSwap[] = []): CostBreakdown {
  const effective = applySwaps(lines, swaps);

  const category: Record<Category, number> = { tool: 0, material: 0 };
  const retailer = new Map<string, number>();
  for (const line of effective) {
    const cents = lineCents(line);
    category[line.category] += cents;
    if (cents === 0) continue;
    const name = line.retailer.trim() || UNKNOWN_RETAILER;
    retailer.set(name, (retailer.get(name) ?? 0) + cents);
  }

  return {
    totalCents: category.tool + category.material,
    byCategory: GROUP_ORDER.map((group) => ({ label: GROUP_LABEL[group], cents: category[group] })),
    byRetailer: [...retailer]
      .map(([label, cents]) => ({ label, cents }))
      .sort((a, b) => b.cents - a.cents || a.label.localeCompare(b.label)),
  };
}

// Builds the chart's lines from the API's material lines plus the grid's owned toggles. A line
// missing from `owned` falls back to the API's ownedDefault, as the grid does. Unpriced lines
// (price "0.00" fixtures) just contribute 0.
export function toBreakdownLines(
  materials: readonly { id: string; category: Category; qty: number; price: string; retailer: string; ownedDefault: boolean }[],
  owned: Readonly<Record<string, boolean>>,
): BreakdownLine[] {
  return materials.map((m) => {
    toCents(m.price); // throws on a non-contract money string rather than charting garbage
    return { id: m.id, category: m.category, qty: m.qty, price: m.price, retailer: m.retailer, owned: owned[m.id] ?? m.ownedDefault };
  });
}
