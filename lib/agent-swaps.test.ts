import { describe, expect, it, vi } from "vitest";
import type { Cart, Swap } from "./api/client";
import { parseBudget, requestCart, swapSentence, swappedLineIds } from "./agent-swaps";

const option = (name: string, price: string) => ({
  channel3ProductId: null,
  name,
  price,
  currency: "USD",
  retailer: "Shop",
  productUrl: "https://example.com/p",
  imageUrl: null,
});

export const swap: Swap = {
  lineId: "saw",
  altIndex: 0,
  from: option("Pro saw", "30.00"),
  to: option("Budget saw", "18.00"),
  reason: "The budget saw cuts the same wood.",
  savings: "12.00",
};

export const cart: Cart = {
  projectId: "p1",
  currency: "USD",
  lines: [],
  swaps: [swap],
  skippedLineIds: ["hammer"],
  subtotal: "88.00",
  budget: "100.00",
  withinBudget: true,
  agentUsed: true,
};

const base = {
  projectId: "p1",
  slug: "chair",
  lineIds: ["saw", "hammer", "glue"],
  owned: { saw: false, hammer: true, glue: false },
  budgetText: "100",
  apiAvailable: true,
};

describe("parseBudget", () => {
  it("normalises to the contract's two decimals", () => {
    expect(parseBudget("200")).toEqual({ ok: true, value: "200.00" });
    expect(parseBudget(" $199.5 ")).toEqual({ ok: true, value: "199.50" });
  });
  it("treats empty as no budget and rejects junk", () => {
    expect(parseBudget("")).toEqual({ ok: true, value: undefined });
    expect(parseBudget("12.345")).toEqual({ ok: false });
    expect(parseBudget("abc")).toEqual({ ok: false });
  });
});

describe("swap rendering helpers", () => {
  it("words a swap as 'Swapped X for Y, saves $12.00'", () => {
    expect(swapSentence(swap, "USD")).toBe("Swapped Pro saw for Budget saw, saves $12.00");
  });
  it("lists the swapped line ids for the grid highlight", () => {
    expect(swappedLineIds(cart)).toEqual(["saw"]);
  });
});

describe("requestCart", () => {
  it("sends projectId, the grid's owned ids and the budget", async () => {
    const build = vi.fn().mockResolvedValue(cart);
    const outcome = await requestCart(base, build);
    expect(build).toHaveBeenCalledWith({ projectId: "p1", owned: ["hammer"], budget: "100.00" });
    expect(outcome).toMatchObject({ ok: true, cart });
    expect(outcome.ok && outcome.href).toBe("/cart?project=chair&owned=hammer&budget=100.00&swaps=saw:0");
  });

  it("leaves budget out when none was typed", async () => {
    const build = vi.fn().mockResolvedValue({ ...cart, budget: null, swaps: [] });
    await requestCart({ ...base, budgetText: "" }, build);
    expect(build).toHaveBeenCalledWith({ projectId: "p1", owned: ["hammer"] });
  });

  it("returns the server's message when the call fails, without throwing", async () => {
    const build = vi.fn().mockRejectedValue(new Error("HTTP 503: agent unavailable"));
    expect(await requestCart(base, build)).toEqual({ ok: false, error: "HTTP 503: agent unavailable" });
  });

  it("rejects a bad budget before calling the API", async () => {
    const build = vi.fn();
    const outcome = await requestCart({ ...base, budgetText: "lots" }, build);
    expect(outcome).toMatchObject({ ok: false });
    expect(build).not.toHaveBeenCalled();
  });

  it("explains when the site has no API configured", async () => {
    const build = vi.fn();
    const outcome = await requestCart({ ...base, apiAvailable: false }, build);
    expect(outcome.ok === false && outcome.error).toMatch(/NEXT_PUBLIC_API_URL/);
    expect(build).not.toHaveBeenCalled();
  });
});
