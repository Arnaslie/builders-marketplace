"use client";

import { useState, type FormEvent } from "react";
import {
  submitRecommendation,
  usingApi,
  type DraftLine,
  type RecommendationRequest,
  type RecommendationResult,
} from "../lib/api/client";

type LineState = { key: number; name: string; qty: string; unit: string; category: DraftLine["category"] };

let nextKey = 1;
const newLine = (): LineState => ({ key: nextKey++, name: "", qty: "1", unit: "each", category: "material" });

export function RecommendForm() {
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [steps, setSteps] = useState("");
  const [lines, setLines] = useState<LineState[]>(() => [newLine()]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RecommendationResult | null>(null);

  const updateLine = (key: number, patch: Partial<LineState>) =>
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setResult(null);

    const materials: DraftLine[] = [];
    for (const line of lines.filter((l) => l.name.trim() !== "")) {
      const qty = Number(line.qty);
      if (!Number.isInteger(qty) || qty < 1) {
        setError(`Quantity for "${line.name}" must be a whole number of at least 1.`);
        return;
      }
      materials.push({ name: line.name.trim(), qty, unit: line.unit.trim() || "each", category: line.category });
    }
    if (materials.length === 0) {
      setError("Add at least one material or tool.");
      return;
    }

    const draft: RecommendationRequest = {
      title: title.trim(),
      summary: summary.trim(),
      steps: steps
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
      materials,
    };

    setBusy(true);
    try {
      setResult(await submitRecommendation(draft));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the draft.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form className="form" onSubmit={onSubmit}>
        <div className="field">
          <label htmlFor="rec-title">Title</label>
          <input id="rec-title" required minLength={3} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="rec-summary">Summary</label>
          <textarea id="rec-summary" required rows={3} maxLength={2000} value={summary} onChange={(e) => setSummary(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="rec-steps">Steps (one per line)</label>
          <textarea id="rec-steps" rows={5} value={steps} onChange={(e) => setSteps(e.target.value)} />
        </div>

        <fieldset className="fieldset">
          <legend>Materials and tools</legend>
          {lines.map((line, index) => (
            <div className="line-row" key={line.key}>
              <input aria-label={`Item ${index + 1} name`} placeholder="Item" value={line.name} onChange={(e) => updateLine(line.key, { name: e.target.value })} />
              <input aria-label={`Item ${index + 1} quantity`} type="number" min={1} step={1} value={line.qty} onChange={(e) => updateLine(line.key, { qty: e.target.value })} />
              <input aria-label={`Item ${index + 1} unit`} placeholder="Unit" value={line.unit} onChange={(e) => updateLine(line.key, { unit: e.target.value })} />
              <select aria-label={`Item ${index + 1} category`} value={line.category} onChange={(e) => updateLine(line.key, { category: e.target.value as DraftLine["category"] })}>
                <option value="material">material</option>
                <option value="tool">tool</option>
              </select>
              <button type="button" className="button button-quiet" disabled={lines.length === 1} onClick={() => setLines((c) => c.filter((l) => l.key !== line.key))}>
                Remove
              </button>
            </div>
          ))}
          <div>
            <button type="button" className="button button-quiet" onClick={() => setLines((c) => [...c, newLine()])}>
              Add another item
            </button>
          </div>
        </fieldset>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div>
          <button type="submit" className="button" disabled={busy}>
            {busy ? "Sending..." : usingApi ? "Send recommendation" : "Preview draft"}
          </button>
        </div>
      </form>

      {result?.kind === "saved" && (
        <section className="result" aria-live="polite">
          <h2>Draft received</h2>
          <p>
            Saved as <code>{result.recommendation.id}</code> with status {result.recommendation.status}. It is not
            published until it is reviewed.
          </p>
        </section>
      )}
      {result?.kind === "local" && (
        <section className="result" aria-live="polite">
          <h2>Draft (not sent)</h2>
          <p>No API is configured (NEXT_PUBLIC_API_URL is unset), so nothing was sent. This is what would be posted:</p>
          <pre>{JSON.stringify(result.draft, null, 2)}</pre>
        </section>
      )}
    </>
  );
}
