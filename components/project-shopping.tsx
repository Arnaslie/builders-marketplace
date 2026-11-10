"use client";

// The materials grid and the shopping agent panel share two pieces of state, so they live under
// one client component: which lines the user ticked "Already own it" (grid -> panel, sent as
// owned[]) and which lines the agent swapped (panel -> grid, highlighted).
import { useCallback, useMemo, useState } from "react";
import type { MaterialLine, Swap } from "../lib/api/client";
import { costBreakdown, toBreakdownLines } from "../lib/cost-breakdown";
import { AgentPanel } from "./agent-panel";
import { CostCharts } from "./cost-charts";
import { MaterialsGrid } from "./materials-grid";

type Props = {
  projectId: string;
  slug: string;
  lines: MaterialLine[];
  currency: string;
  licenseKey?: string;
  chartsLicenseKey?: string;
};

export function ProjectShopping({ projectId, slug, lines, currency, licenseKey, chartsLicenseKey }: Props) {
  const [owned, setOwned] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(lines.map((line) => [line.id, line.ownedDefault])),
  );
  const [swappedIds, setSwappedIds] = useState<string[]>([]);
  const [swaps, setSwaps] = useState<Swap[]>([]);
  const highlightIds = useMemo(() => new Set(swappedIds), [swappedIds]);
  // Same owned toggles and agent swaps the grid and panel use, so the charts follow both.
  const breakdown = useMemo(() => costBreakdown(toBreakdownLines(lines, owned), swaps), [lines, owned, swaps]);
  const onOwnedChange = useCallback((lineId: string, value: boolean) => setOwned((current) => ({ ...current, [lineId]: value })), []);

  return (
    <>
      <h2>Materials and Tools</h2>
      <MaterialsGrid lines={lines} currency={currency} licenseKey={licenseKey} onOwnedChange={onOwnedChange} highlightIds={highlightIds} />

      <h2>Cost Breakdown</h2>
      <CostCharts breakdown={breakdown} currency={currency} licenseKey={chartsLicenseKey} />

      <h2>Shopping Agent</h2>
      <AgentPanel
        projectId={projectId}
        slug={slug}
        lines={lines}
        currency={currency}
        owned={owned}
        onSwapsChange={setSwappedIds}
        onSwapDetails={setSwaps}
      />
    </>
  );
}
