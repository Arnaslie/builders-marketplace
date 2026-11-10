import { describe, expect, it } from "vitest";
import { applySwaps, costBreakdown, toBreakdownLines, UNKNOWN_RETAILER, type BreakdownLine } from "./cost-breakdown";

const line = (over: Partial<BreakdownLine> & { id: string }): BreakdownLine => ({
  category: "material",
  qty: 1,
  price: "10.00",
  retailer: "Acme",
  owned: false,
  ...over,
});

const lines: BreakdownLine[] = [
  line({ id: "hammer", category: "tool", price: "20.00", retailer: "Acme" }),
  line({ id: "nails", qty: 3, price: "2.50", retailer: "Bolt" }),
  line({ id: "wood", qty: 2, price: "15.00", retailer: "Acme" }),
];

describe("costBreakdown", () => {
  it("splits spend into tools vs materials and by retailer", () => {
    const b = costBreakdown(lines);
    expect(b.totalCents).toBe(2000 + 750 + 3000);
    expect(b.byCategory).toEqual([
      { label: "Tools", cents: 2000 },
      { label: "Materials", cents: 3750 },
    ]);
    expect(b.byRetailer).toEqual([
      { label: "Acme", cents: 5000 },
      { label: "Bolt", cents: 750 },
    ]);
  });

  it("leaves owned lines out of every slice", () => {
    const b = costBreakdown(lines.map((l) => (l.id === "hammer" ? { ...l, owned: true } : l)));
    expect(b.byCategory[0]).toEqual({ label: "Tools", cents: 0 });
    expect(b.totalCents).toBe(3750);
    expect(b.byRetailer).toEqual([
      { label: "Acme", cents: 3000 },
      { label: "Bolt", cents: 750 },
    ]);
  });

  it("drops a retailer whose lines are all owned", () => {
    const b = costBreakdown(lines.map((l) => (l.retailer === "Bolt" ? { ...l, owned: true } : l)));
    expect(b.byRetailer.map((s) => s.label)).toEqual(["Acme"]);
  });

  it("reflects a swap: new unit price and new retailer, same qty", () => {
    const b = costBreakdown(lines, [{ lineId: "wood", to: { price: "9.00", retailer: "Cheapo" } }]);
    expect(b.byCategory[1]).toEqual({ label: "Materials", cents: 750 + 1800 });
    expect(b.byRetailer).toEqual([
      { label: "Acme", cents: 2000 },
      { label: "Cheapo", cents: 1800 },
      { label: "Bolt", cents: 750 },
    ]);
  });

  it("ignores a swap on an owned line (owned still costs 0)", () => {
    const owned = lines.map((l) => (l.id === "wood" ? { ...l, owned: true } : l));
    const b = costBreakdown(owned, [{ lineId: "wood", to: { price: "9.00", retailer: "Cheapo" } }]);
    expect(b.byRetailer.map((s) => s.label)).toEqual(["Acme", "Bolt"]);
    expect(b.totalCents).toBe(2750);
  });

  it("ignores a swap for an unknown line id", () => {
    expect(costBreakdown(lines, [{ lineId: "nope", to: { price: "1.00", retailer: "X" } }])).toEqual(costBreakdown(lines));
  });

  it("returns zeroed categories and no retailers for empty input", () => {
    expect(costBreakdown([])).toEqual({
      totalCents: 0,
      byCategory: [
        { label: "Tools", cents: 0 },
        { label: "Materials", cents: 0 },
      ],
      byRetailer: [],
    });
  });

  it("groups a blank retailer under Unknown retailer", () => {
    const b = costBreakdown([line({ id: "a", retailer: "  " })]);
    expect(b.byRetailer).toEqual([{ label: UNKNOWN_RETAILER, cents: 1000 }]);
  });

  it("sums in integer cents without float drift", () => {
    const b = costBreakdown([line({ id: "a", qty: 3, price: "0.10" }), line({ id: "b", qty: 1, price: "0.20" })]);
    expect(b.totalCents).toBe(50);
  });

  it("sorts equal spend by retailer name", () => {
    const b = costBreakdown([line({ id: "a", retailer: "Zed" }), line({ id: "b", retailer: "Alpha" })]);
    expect(b.byRetailer.map((s) => s.label)).toEqual(["Alpha", "Zed"]);
  });
});

describe("applySwaps", () => {
  it("does not mutate its input", () => {
    const before = JSON.stringify(lines);
    applySwaps(lines, [{ lineId: "wood", to: { price: "1.00", retailer: "X" } }]);
    expect(JSON.stringify(lines)).toBe(before);
  });
});

describe("toBreakdownLines", () => {
  const materials = [
    { id: "a", category: "tool" as const, qty: 1, price: "5.00", retailer: "Acme", ownedDefault: true },
    { id: "b", category: "material" as const, qty: 2, price: "3.00", retailer: "Bolt", ownedDefault: false },
  ];

  it("falls back to ownedDefault when the grid has no toggle for a line", () => {
    expect(toBreakdownLines(materials, {}).map((l) => l.owned)).toEqual([true, false]);
  });

  it("lets the grid's toggle override ownedDefault", () => {
    expect(toBreakdownLines(materials, { a: false, b: true }).map((l) => l.owned)).toEqual([false, true]);
  });

  it("rejects a price that is not a contract money string", () => {
    expect(() => toBreakdownLines([{ ...materials[0], price: "abc" }], {})).toThrow();
  });
});
