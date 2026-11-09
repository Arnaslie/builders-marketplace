"use client";

// Shopping agent panel (issue #5): budget -> POST /agent/build-cart -> the cart with each swap and
// its reason. The "owned" list is not a second set of checkboxes: it comes from the grid's
// "Already own it" column (state lives in components/project-shopping.tsx), and the lines the
// agent swaps are highlighted in that grid. All money comes back from the server as strings and is
// only formatted here; the browser never computes a price. When the agent could not run, the API
// answers with the deterministic cart and agentUsed false, and the panel says reasons are
// unavailable instead of showing a reason the model did not write.
import Link from "next/link";
import { useId, useState, type FormEvent } from "react";
import type { Cart, MaterialLine } from "../lib/api/client";
import { requestCart, swapSentence, swappedLineIds } from "../lib/agent-swaps";
import { formatCents, formatMoney, toCents } from "../lib/money";

type Props = {
  projectId: string;
  slug: string;
  lines: MaterialLine[];
  currency: string;
  owned: Record<string, boolean>; // the grid's toggles
  onSwapsChange: (lineIds: string[]) => void; // which grid rows to highlight
};

export function AgentPanel({ projectId, slug, lines, currency, owned, onSwapsChange }: Props) {
  const [budget, setBudget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The cart together with the inputs that produced it, so "Go to the cart" links to exactly this
  // cart even if the grid is edited afterwards.
  const [result, setResult] = useState<{ cart: Cart; href: string } | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setResult(null);
    onSwapsChange([]);
    setBusy(true);
    const outcome = await requestCart({ projectId, slug, lineIds: lines.map((line) => line.id), owned, budgetText: budget });
    setBusy(false);
    if (outcome.ok) {
      setResult({ cart: outcome.cart, href: outcome.href });
      onSwapsChange(swappedLineIds(outcome.cart));
    } else {
      setError(outcome.error);
    }
  }

  return (
    <AgentPanelView
      currency={currency}
      budget={budget}
      onBudgetChange={setBudget}
      ownedCount={lines.filter((line) => owned[line.id]).length}
      lineCount={lines.length}
      busy={busy}
      error={error}
      result={result}
      onSubmit={onSubmit}
    />
  );
}

type ViewProps = {
  currency: string;
  budget: string;
  onBudgetChange: (value: string) => void;
  ownedCount: number;
  lineCount: number;
  busy: boolean;
  error: string | null;
  result: { cart: Cart; href: string } | null;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
};

// Everything the panel shows, with no state of its own, so each state (idle, loading, error,
// result) can be rendered and checked directly.
export function AgentPanelView({ currency, budget, onBudgetChange, ownedCount, lineCount, busy, error, result, onSubmit }: ViewProps) {
  const id = useId();
  return (
    <section className="agent-panel" id="agent-panel">
      <p>
        Tell the agent your budget. It builds the cart from the items you have not ticked as owned in the grid above, and swaps in
        cheaper listed products where it must. Swapped rows are highlighted in the grid.
      </p>
      <form className="agent-form" onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor={`${id}-budget`}>Budget ({currency}, optional)</label>
          <input
            id={`${id}-budget`}
            type="text"
            inputMode="decimal"
            placeholder="200.00"
            value={budget}
            onChange={(e) => onBudgetChange(e.target.value)}
          />
        </div>
        <p id="agent-owned-count">
          <small>
            Already own it in the grid: {ownedCount} of {lineCount} items (these are left out of the cart).
          </small>
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {busy && (
          <p id="agent-loading" role="status">
            The agent is building your cart. This can take up to 30 seconds, longer if the server is waking up.
          </p>
        )}
        <div>
          <button type="submit" className="button" disabled={busy}>
            {busy ? "Building..." : "Build my cart"}
          </button>
        </div>
      </form>

      {result && <AgentCart cart={result.cart} href={result.href} />}
    </section>
  );
}

export function AgentCart({ cart, href }: { cart: Cart; href: string }) {
  const agentUsed = cart.agentUsed === true;
  const overBy = cart.budget !== null && !cart.withinBudget ? toCents(cart.subtotal) - toCents(cart.budget) : 0;
  let status: string;
  if (agentUsed) status = "The shopping agent chose these swaps and wrote the reasons. The server computed the prices.";
  else if (cart.swaps.length > 0) status = "Agent reasons are unavailable right now. These swaps were chosen by fixed rules: cheapest listed alternative first.";
  else if (cart.budget === null) status = "No budget was set, so no swaps were needed.";
  else status = "The cart is within your budget, so no swaps were needed.";

  return (
    <div className="agent-cart" aria-live="polite">
      <h3>Your cart</h3>
      <p id="agent-status">{status}</p>

      <div className="cart-wrap">
        <table className="cart-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Qty</th>
              <th>Unit price</th>
              <th>Line total</th>
            </tr>
          </thead>
          <tbody>
            {cart.lines.map((line) => (
              <tr key={line.lineId}>
                <td>
                  {line.name}
                  {line.swapped && <small> (swapped)</small>}
                </td>
                <td>{line.qty}</td>
                <td>{formatMoney(line.unitPrice, cart.currency)}</td>
                <td>{formatMoney(line.lineTotal, cart.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="grid-total">
        Subtotal: <output id="agent-subtotal">{formatMoney(cart.subtotal, cart.currency)}</output>
        {cart.budget !== null && (
          <>
            {" "}
            <small>
              of {formatMoney(cart.budget, cart.currency)} budget
              {cart.withinBudget ? " (within budget)" : ` (over by ${formatCents(overBy, cart.currency)}; no cheaper listed options remain)`}
            </small>
          </>
        )}
      </p>

      {cart.swaps.length > 0 && (
        <>
          <h3>Swaps</h3>
          <ul className="swap-list" id="agent-swaps">
            {cart.swaps.map((swap) => (
              <li key={swap.lineId}>
                {swapSentence(swap, cart.currency)} ({swap.to.retailer}).
                {agentUsed && <> {swap.reason}</>}
              </li>
            ))}
          </ul>
        </>
      )}

      <p>
        <Link href={href}>Go to the cart and pay with PayPal</Link>
      </p>
    </div>
  );
}
