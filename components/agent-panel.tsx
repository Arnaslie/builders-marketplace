"use client";

// Shopping agent panel (issue #5): budget + "I own this" checkboxes -> POST /agent/build-cart ->
// the cart with each swap and its reason. All money comes back from the server as strings and is
// only formatted here; the browser never computes a price. When the agent could not run, the API
// answers with the deterministic cart and agentUsed false, and the panel says reasons are
// unavailable instead of showing a reason the model did not write.
import Link from "next/link";
import { useId, useState, type FormEvent } from "react";
import { buildCart, usingApi, type Cart, type MaterialLine } from "../lib/api/client";
import { cartHref } from "../lib/cart-link";
import { formatCents, formatMoney, toCents } from "../lib/money";

const BUDGET_PATTERN = /^\d{1,7}(\.\d{1,2})?$/;

// "200" and "200.5" become "200.00" and "200.50", the contract's money format.
function parseBudget(raw: string): { ok: true; value: string | undefined } | { ok: false } {
  const text = raw.trim().replace(/^\$/, "");
  if (text === "") return { ok: true, value: undefined };
  if (!BUDGET_PATTERN.test(text)) return { ok: false };
  const [whole, frac = ""] = text.split(".");
  return { ok: true, value: `${whole}.${frac.padEnd(2, "0")}` };
}

type Props = { projectId: string; slug: string; lines: MaterialLine[]; currency: string };

export function AgentPanel({ projectId, slug, lines, currency }: Props) {
  const id = useId();
  const [budget, setBudget] = useState("");
  const [owned, setOwned] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(lines.map((line) => [line.id, line.ownedDefault])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The cart together with the inputs that produced it, so "Go to the cart" links to exactly this
  // cart even if the form is edited afterwards.
  const [result, setResult] = useState<{ cart: Cart; href: string } | null>(null);

  // Tools first: they are the usual "I already have one" items.
  const ordered = [...lines].sort((a, b) => Number(b.category === "tool") - Number(a.category === "tool"));

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!usingApi) {
      setError("The shopping agent needs the API server (NEXT_PUBLIC_API_URL is not set on this copy of the site).");
      return;
    }
    const parsed = parseBudget(budget);
    if (!parsed.ok) {
      setError("Budget must be an amount such as 200 or 199.99.");
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const ownedIds = lines.filter((line) => owned[line.id]).map((line) => line.id);
      const cart = await buildCart({ projectId, owned: ownedIds, ...(parsed.value ? { budget: parsed.value } : {}) });
      setResult({ cart, href: cartHref(slug, ownedIds, parsed.value, cart) });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not build the cart.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="agent-panel" id="agent-panel">
      <p>Tell the agent your budget and what you already own. It builds the cart and swaps in cheaper listed products where it must.</p>
      <form className="agent-form" onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor={`${id}-budget`}>Budget ({currency}, optional)</label>
          <input
            id={`${id}-budget`}
            type="text"
            inputMode="decimal"
            placeholder="200.00"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
          />
        </div>
        <fieldset className="fieldset">
          <legend>Already own</legend>
          <ul className="owned-list">
            {ordered.map((line) => (
              <li key={line.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={owned[line.id] ?? false}
                    onChange={(e) => setOwned((current) => ({ ...current, [line.id]: e.target.checked }))}
                  />{" "}
                  {line.name} <small>({line.category})</small>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
        {error && (
          <p className="error" role="alert">
            {error}
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

function AgentCart({ cart, href }: { cart: Cart; href: string }) {
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
          <ul className="swap-list">
            {cart.swaps.map((swap) => (
              <li key={swap.lineId}>
                <b>{swap.from.name}</b> became <b>{swap.to.name}</b> ({swap.to.retailer}), saving{" "}
                {formatMoney(swap.savings, cart.currency)}.
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
