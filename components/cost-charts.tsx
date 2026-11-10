"use client";

// Cost-breakdown charts (issue #8): tools vs materials, and spend by retailer. The numbers come
// from lib/cost-breakdown.ts, which reads the grid's owned toggles and the agent's swaps, so the
// charts redraw whenever either changes (state lives in components/project-shopping.tsx).
// AG Charts Community only, unless a licence key (AG_CHARTS_LICENSE_KEY, passed in by the page) is
// present: then ag-charts-enterprise is lazy-loaded and registered. Without a key this file never
// loads Enterprise code. Docs this file follows (AG Charts React):
//   Quick start / modules:  https://www.ag-grid.com/charts/react/quick-start/
//   Donut series:           https://www.ag-grid.com/charts/react/donut-series/
//   Bar series:             https://www.ag-grid.com/charts/react/bar-series/
import { useEffect, useMemo, useState } from "react";
import { AgCharts } from "ag-charts-react";
import { AllCommunityModule, ModuleRegistry, type AgCartesianChartOptions, type AgPolarChartOptions } from "ag-charts-community";
import type { CostBreakdown } from "../lib/cost-breakdown";
import { formatCents } from "../lib/money";

ModuleRegistry.registerModules([AllCommunityModule]);

// Palette from app/tokens.css (charts cannot read CSS variables).
const FILLS = ["#0000ee", "#808080", "#c0c0c0", "#551a8b", "#000000"];

type Props = { breakdown: CostBreakdown; currency: string; licenseKey?: string };

// Registers Enterprise once a key is present; resolves true when it is ready.
function useEnterprise(licenseKey: string | undefined): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!licenseKey) return;
    let cancelled = false;
    import("ag-charts-enterprise").then(({ AllEnterpriseModule, LicenseManager }) => {
      LicenseManager.setLicenseKey(licenseKey);
      ModuleRegistry.registerModules([AllEnterpriseModule]);
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [licenseKey]);
  return ready;
}

export function CostCharts({ breakdown, currency, licenseKey }: Props) {
  const enterprise = useEnterprise(licenseKey);
  const money = (cents: number) => formatCents(cents, currency);

  const categoryOptions = useMemo<AgPolarChartOptions>(
    () => ({
      data: breakdown.byCategory.filter((s) => s.cents > 0),
      title: { text: "Tools vs materials" },
      series: [
        {
          type: "donut",
          angleKey: "cents",
          legendItemKey: "label",
          fills: FILLS,
          tooltip: { renderer: ({ datum }) => ({ heading: String(datum.label), data: [{ label: "Spend", value: money(Number(datum.cents)) }] }) },
        },
      ],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [breakdown, currency, enterprise],
  );

  const retailerOptions = useMemo<AgCartesianChartOptions>(
    () => ({
      data: breakdown.byRetailer,
      title: { text: "Spend by retailer" },
      series: [
        {
          type: "bar",
          direction: "horizontal",
          xKey: "label",
          yKey: "cents",
          yName: "Spend",
          fill: FILLS[0],
          tooltip: { renderer: ({ datum }) => ({ heading: String(datum.label), data: [{ label: "Spend", value: money(Number(datum.cents)) }] }) },
        },
      ],
      axes: {
        category: { position: "left" },
        number: { position: "bottom", label: { formatter: ({ value }) => money(Number(value)) } },
      },
      legend: { enabled: false },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [breakdown, currency, enterprise],
  );

  return (
    <div id="cost-charts" data-charts={enterprise ? "enterprise" : "community"}>
      {breakdown.totalCents === 0 ? (
        <p id="cost-charts-empty">Nothing left to buy, so there is no cost to chart.</p>
      ) : (
        <div className="chart-row">
          <div className="chart-box" id="cost-by-category">
            <AgCharts options={categoryOptions} />
          </div>
          <div className="chart-box" id="cost-by-retailer">
            <AgCharts options={retailerOptions} />
          </div>
        </div>
      )}
      <p id="cost-charts-summary">
        <small>
          {breakdown.byCategory.map((s) => `${s.label}: ${money(s.cents)}`).join(", ")}. Total to buy:{" "}
          {money(breakdown.totalCents)}.
          {breakdown.byRetailer.length > 0 && ` By retailer: ${breakdown.byRetailer.map((s) => `${s.label} ${money(s.cents)}`).join(", ")}.`}
        </small>
      </p>
    </div>
  );
}
