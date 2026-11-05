// Pure math and row-shaping for the materials grid (components/materials-grid.tsx), kept free of
// AG Grid so it is unit-testable. All money is integer cents (lib/money.ts); an owned line costs 0.
import { toCents } from "./money";

export type Category = "tool" | "material";

export type LineInput = {
  id: string;
  category: Category;
  qty: number;
  price: string; // contract money string, e.g. "3.28"
  owned: boolean;
};

// Tools come first, then materials.
export const GROUP_ORDER: readonly Category[] = ["tool", "material"];
export const GROUP_LABEL: Record<Category, string> = { tool: "Tools", material: "Materials" };

export function lineCents(line: Pick<LineInput, "qty" | "price" | "owned">): number {
  return line.owned ? 0 : line.qty * toCents(line.price);
}

export function totalCents(lines: readonly LineInput[]): number {
  return lines.reduce((sum, line) => sum + lineCents(line), 0);
}

export function subtotalsByCategory(lines: readonly LineInput[]): Record<Category, number> {
  const out: Record<Category, number> = { tool: 0, material: 0 };
  for (const line of lines) out[line.category] += lineCents(line);
  return out;
}

// Synthetic rows the grid renders next to real lines. `cents` is precomputed for them.
export type SummaryRow = {
  id: string;
  kind: "header" | "subtotal" | "total";
  group?: Category;
  name: string;
  cents: number;
};

export const headerRow = (group: Category, count: number): SummaryRow => ({
  id: `header:${group}`,
  kind: "header",
  group,
  name: `${GROUP_LABEL[group]} (${count})`,
  cents: 0,
});

export const subtotalRow = (group: Category, cents: number): SummaryRow => ({
  id: `subtotal:${group}`,
  kind: "subtotal",
  group,
  name: `${GROUP_LABEL[group]} subtotal`,
  cents,
});

export const totalRow = (cents: number): SummaryRow => ({ id: "total", kind: "total", name: "Total", cents });

// Header and subtotal rows for every non-empty group. The grid sorts these along with the lines,
// then reorders them with arrangeGroups.
export function groupSummaryRows(lines: readonly LineInput[]): SummaryRow[] {
  const subtotals = subtotalsByCategory(lines);
  return GROUP_ORDER.flatMap((group) => {
    const count = lines.filter((l) => l.category === group).length;
    return count === 0 ? [] : [headerRow(group, count), subtotalRow(group, subtotals[group])];
  });
}

// Community fallback for row grouping. Given nodes in the order the grid sorted them, return
// tools then materials; each group is: header, its lines in the sorted order, subtotal.
// Pass `groupOf` to read a node's group and `kindOf` to tell lines from summary rows.
export function arrangeGroups<T>(
  nodes: readonly T[],
  groupOf: (node: T) => Category | undefined,
  kindOf: (node: T) => "line" | "header" | "subtotal",
): T[] {
  const out: T[] = [];
  for (const group of GROUP_ORDER) {
    const inGroup = nodes.filter((n) => groupOf(n) === group);
    const header = inGroup.find((n) => kindOf(n) === "header");
    const subtotal = inGroup.find((n) => kindOf(n) === "subtotal");
    if (header) out.push(header);
    out.push(...inGroup.filter((n) => kindOf(n) === "line"));
    if (subtotal) out.push(subtotal);
  }
  return out;
}

// Enterprise path: the grid's row-group keys are category values. Tools sort before materials,
// and an unknown key sorts last so a new category never hides the known ones.
export function compareGroupKeys(a: string | null | undefined, b: string | null | undefined): number {
  const rank = (k: string | null | undefined) => {
    const i = GROUP_ORDER.indexOf(k as Category);
    return i === -1 ? GROUP_ORDER.length : i;
  };
  return rank(a) - rank(b);
}

// Display label for a group key ("tool" -> "Tools"); an unknown key is shown as-is.
export function groupLabel(key: string | null | undefined): string {
  return key != null && key in GROUP_LABEL ? GROUP_LABEL[key as Category] : (key ?? "");
}
