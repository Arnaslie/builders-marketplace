"use client";

import { useState, type FormEvent } from "react";
import { submitRecommendation, type Recommendation, type RecommendationRequest } from "../lib/api/client";
import { formatMoney } from "../lib/money";
import { DraftGrid } from "./draft-grid";

type SkillLevel = NonNullable<RecommendationRequest["skillLevel"]>;

export function RecommendForm() {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [skillLevel, setSkillLevel] = useState<SkillLevel | "">("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Recommendation | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setDraft(null);

    const idea: RecommendationRequest = { title: title.trim(), description: description.trim() };
    if (skillLevel) idea.skillLevel = skillLevel;
    if (imageUrl.trim()) idea.imageUrl = imageUrl.trim();

    setBusy(true);
    try {
      setDraft(await submitRecommendation(idea));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not draft this idea.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form className="form" onSubmit={onSubmit} aria-busy={busy}>
        <div className="field">
          <label htmlFor="rec-title">Your idea</label>
          <input id="rec-title" required minLength={3} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="rec-description">Description</label>
          <textarea id="rec-description" required minLength={10} rows={5} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="rec-image">Reference image URL (optional)</label>
          <input id="rec-image" type="url" maxLength={500} placeholder="https://" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="rec-skill">Skill level (optional)</label>
          <select id="rec-skill" value={skillLevel} onChange={(e) => setSkillLevel(e.target.value as SkillLevel | "")}>
            <option value="">Not sure</option>
            <option value="beginner">beginner</option>
            <option value="intermediate">intermediate</option>
            <option value="advanced">advanced</option>
          </select>
        </div>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div>
          <button type="submit" className="button" disabled={busy}>
            {busy ? "Drafting..." : "Draft materials"}
          </button>
        </div>
        {busy && (
          <p role="status">Drafting the materials list. This can take up to half a minute.</p>
        )}
      </form>

      {draft && (
        <section className="result draft" aria-live="polite" aria-label="Draft project">
          <h2>
            {draft.title} <span className="badge-draft">DRAFT</span>
          </h2>
          <p>{draft.description}</p>
          {draft.skillLevel && <p>Skill level: {draft.skillLevel}</p>}
          <DraftGrid lines={draft.materials} currency={draft.currency} />
          <p className="grid-total">
            Estimated total: <output id="draft-total">{formatMoney(draft.estimatedTotal, draft.currency)}</output>{" "}
            <small>
              ({draft.pricedCount} priced, {draft.unpricedCount} unpriced)
            </small>
          </p>
          {draft.unpricedCount > 0 && (
            <p>
              <small>
                Unpriced items have no price in our cache yet and are not in the total. Nothing here is a quote.
              </small>
            </p>
          )}
          <p>
            <small>
              Saved as <code>{draft.id}</code>. A draft is read-only and is not published or listed as a project.
            </small>
          </p>
        </section>
      )}
    </>
  );
}
