import { describe, expect, it } from "vitest";
import {
  arrangeGroups,
  groupSummaryRows,
  lineCents,
  subtotalsByCategory,
  totalCents,
  type LineInput,
} from "./grid-totals";

const line = (id: string, category: LineInput["category"], qty: number, price: string, owned = false): LineInput => ({
  id,
  category,
  qty,
  price,
  owned,
});

const lines = [
  line("saw", "tool", 1, "24.99"),
  line("clamp", "tool", 2, "9.50"),
  line("wood", "material", 3, "3.28"),
  line("screws", "material", 1, "0.10"),
];

describe("line, subtotal and total math (integer cents)", () => {
  it("multiplies qty by unit price in cents", () => {
    expect(lineCents(lines[1])).toBe(1900);
    expect(lineCents(lines[3])).toBe(10);
  });

  it("sums without float drift (0.10 + 0.20 style cases)", () => {
    const drift = [line("a", "material", 3, "0.10"), line("b", "material", 1, "0.20")];
    expect(totalCents(drift)).toBe(50);
  });

  it("subtotals per category add up to the total", () => {
    const sub = subtotalsByCategory(lines);
    expect(sub).toEqual({ tool: 4399, material: 994 });
    expect(sub.tool + sub.material).toBe(totalCents(lines));
    expect(totalCents(lines)).toBe(5393);
  });

  it("an owned toggle zeroes the line out of total and subtotal", () => {
    const toggled = lines.map((l) => (l.id === "saw" ? { ...l, owned: true } : l));
    expect(lineCents(toggled[0])).toBe(0);
    expect(subtotalsByCategory(toggled).tool).toBe(1900);
    expect(totalCents(toggled)).toBe(5393 - 2499);
  });

  it("a qty edit changes total and only its own subtotal", () => {
    const edited = lines.map((l) => (l.id === "wood" ? { ...l, qty: 5 } : l));
    expect(subtotalsByCategory(edited)).toEqual({ tool: 4399, material: 1650 });
    expect(totalCents(edited)).toBe(6049);
  });

  it("everything owned totals zero; no lines totals zero", () => {
    expect(totalCents(lines.map((l) => ({ ...l, owned: true })))).toBe(0);
    expect(totalCents([])).toBe(0);
  });
});

describe("group rows", () => {
  it("emits header + subtotal for each non-empty group, tools first", () => {
    const rows = groupSummaryRows(lines);
    expect(rows.map((r) => r.id)).toEqual(["header:tool", "subtotal:tool", "header:material", "subtotal:material"]);
    expect(rows[0].name).toBe("Tools (2)");
    expect(rows[1].cents).toBe(4399);
    expect(rows[3].cents).toBe(994);
  });

  it("omits a group with no lines", () => {
    const rows = groupSummaryRows(lines.filter((l) => l.category === "material"));
    expect(rows.map((r) => r.id)).toEqual(["header:material", "subtotal:material"]);
  });

  it("arrangeGroups puts tools then materials, header first, subtotal last, keeping sorted order inside", () => {
    type N = { id: string; group?: "tool" | "material"; kind: "line" | "header" | "subtotal" };
    // As the grid might hand them over after sorting by name descending: groups interleaved.
    const sorted: N[] = [
      { id: "wood", group: "material", kind: "line" },
      { id: "subtotal:tool", group: "tool", kind: "subtotal" },
      { id: "saw", group: "tool", kind: "line" },
      { id: "header:material", group: "material", kind: "header" },
      { id: "clamp", group: "tool", kind: "line" },
      { id: "screws", group: "material", kind: "line" },
      { id: "header:tool", group: "tool", kind: "header" },
      { id: "subtotal:material", group: "material", kind: "subtotal" },
    ];
    const out = arrangeGroups(sorted, (n) => n.group, (n) => n.kind).map((n) => n.id);
    expect(out).toEqual([
      "header:tool",
      "saw",
      "clamp",
      "subtotal:tool",
      "header:material",
      "wood",
      "screws",
      "subtotal:material",
    ]);
  });
});
