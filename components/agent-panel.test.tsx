import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Cart } from "../lib/api/client";
import { AgentPanelView } from "./agent-panel";
import { withHighlights, toRow } from "./materials-grid";

const option = (name: string, price: string) => ({
  channel3ProductId: null,
  name,
  price,
  currency: "USD",
  retailer: "Acme",
  productUrl: "https://example.com/p",
  imageUrl: null,
});

const cart: Cart = {
  projectId: "p1",
  currency: "USD",
  lines: [
    {
      lineId: "saw",
      channel3ProductId: null,
      name: "Budget saw",
      category: "tool",
      qty: 1,
      unitPrice: "18.00",
      lineTotal: "18.00",
      currency: "USD",
      retailer: "Acme",
      productUrl: "https://example.com/p",
      swapped: true,
      reason: null,
    },
  ],
  swaps: [
    {
      lineId: "saw",
      altIndex: 0,
      from: option("Pro saw", "30.00"),
      to: option("Budget saw", "18.00"),
      reason: "The budget saw cuts the same wood.",
      savings: "12.00",
    },
  ],
  skippedLineIds: [],
  subtotal: "18.00",
  budget: "20.00",
  withinBudget: true,
  agentUsed: true,
};

const view = (over: Partial<Parameters<typeof AgentPanelView>[0]> = {}) =>
  renderToStaticMarkup(
    <AgentPanelView
      currency="USD"
      budget=""
      onBudgetChange={() => {}}
      ownedCount={2}
      lineCount={5}
      busy={false}
      error={null}
      result={null}
      onSubmit={() => {}}
      {...over}
    />,
  );

describe("AgentPanelView", () => {
  it("shows the budget input, the button and how many grid items are owned", () => {
    const html = view();
    expect(html).toContain("Budget (USD, optional)");
    expect(html).toContain("Build my cart");
    expect(html).toContain("2 of 5 items");
    expect(html).not.toContain("agent-loading");
    expect(html).not.toContain('role="alert"');
  });

  it("loading: disables the button and says the agent is working", () => {
    const html = view({ busy: true });
    expect(html).toContain('id="agent-loading"');
    expect(html).toContain("up to 30 seconds");
    expect(html).toContain("Building...");
    expect(html).toMatch(/<button[^>]*disabled/);
  });

  it("error: shows the message as an alert and keeps the button usable", () => {
    const html = view({ error: "HTTP 503: agent unavailable" });
    expect(html).toContain('role="alert"');
    expect(html).toContain("HTTP 503: agent unavailable");
    expect(html).not.toMatch(/<button[^>]*disabled/);
  });

  it("result: each swap reads 'Swapped X for Y, saves $12.00' with the agent's reason", () => {
    const html = view({ result: { cart, href: "/cart?project=chair" } });
    expect(html).toContain("Swapped Pro saw for Budget saw, saves $12.00");
    expect(html).toContain("The budget saw cuts the same wood.");
    expect(html).toContain("The shopping agent chose these swaps");
  });

  it("result without the agent: shows the swap but never a reason the model did not write", () => {
    const html = view({ result: { cart: { ...cart, agentUsed: false }, href: "/cart" } });
    expect(html).toContain("Swapped Pro saw for Budget saw, saves $12.00");
    expect(html).not.toContain("The budget saw cuts the same wood.");
    expect(html).toContain("Agent reasons are unavailable");
  });
});

describe("grid highlight", () => {
  const line = (id: string) =>
    toRow({
      id,
      name: id,
      qty: 1,
      unit: "ea",
      category: "tool",
      channel3ProductId: null,
      price: "1.00",
      currency: "USD",
      retailer: "Acme",
      productUrl: "https://example.com",
      imageUrl: null,
      ownedDefault: false,
      alternatives: [],
    } as unknown as Parameters<typeof toRow>[0]);

  it("marks only the swapped lines", () => {
    const rows = withHighlights([line("saw"), line("hammer")], new Set(["saw"]));
    expect(rows.map((r) => [r.id, r.swapped])).toEqual([
      ["saw", true],
      ["hammer", false],
    ]);
  });

  it("clears every highlight when there are no swaps", () => {
    expect(withHighlights([line("saw")], new Set()).every((r) => !r.swapped)).toBe(true);
  });
});
