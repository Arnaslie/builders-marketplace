"use client";

// AG Grid Community only (no Enterprise features: no row grouping, pivoting, range selection,
// context menu or charts). Docs this file follows (AG Grid React Data Grid):
//   Modules / ModuleRegistry:  https://www.ag-grid.com/react-data-grid/modules/
//   Theming API (withParams):  https://www.ag-grid.com/react-data-grid/theming/
//   Cell data types (boolean): https://www.ag-grid.com/react-data-grid/cell-data-types/
//   Value getters / parsers:   https://www.ag-grid.com/react-data-grid/value-getters/
//                              https://www.ag-grid.com/react-data-grid/value-parsers/
//   Cell renderers (React):    https://www.ag-grid.com/react-data-grid/cell-rendering/
//   Row IDs (getRowId):        https://www.ag-grid.com/react-data-grid/row-object/
//   Auto height / wrap text:   https://www.ag-grid.com/react-data-grid/row-height/
//   Pinned total row:          https://www.ag-grid.com/react-data-grid/row-pinning/
//   Sorting (postSortRows):    https://www.ag-grid.com/react-data-grid/row-sorting/
//   Row styles (getRowStyle):  https://www.ag-grid.com/react-data-grid/row-styles/
//   Row grouping (Enterprise): https://www.ag-grid.com/react-data-grid/grouping/
//
// Two grids sit behind MaterialsGrid:
//   - With an AG Grid licence key (AG_GRID_LICENSE_KEY, passed in by the page) it lazy-loads
//     components/materials-grid-enterprise.tsx, which uses real Enterprise row grouping.
//   - Without one it renders CommunityMaterialsGrid below. Real row grouping is Enterprise, so
//     this is the fallback: a flat list holding the lines plus a header row and a subtotal row
//     per group (lib/grid-totals.ts builds them); postSortRows puts them back in
//     tools-then-materials order after every sort, so columns sort within each group.
// This file never imports ag-grid-enterprise, so a keyless deploy never downloads it.
import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type CellValueChangedEvent,
  type ColDef,
  type ICellRendererParams,
  type PostSortRowsParams,
  type RowClassParams,
  type RowStyle,
  type ValueFormatterParams,
  type ValueGetterParams,
  type ValueParserParams,
} from "ag-grid-community";
import type { MaterialLine } from "../lib/api/client";
import {
  arrangeGroups,
  groupSummaryRows,
  lineCents,
  totalCents as sumCents,
  totalRow,
  type SummaryRow,
} from "../lib/grid-totals";
import { formatCents, formatMoney } from "../lib/money";

// Registers every Community feature once for this module (a grid with no modules throws).
ModuleRegistry.registerModules([AllCommunityModule]);

// The grid theme cannot read CSS variables, so these are the values from app/tokens.css as
// literals. Keep them in sync with that file. The look is a 1994 bordered <table>: grey header
// row, grey rules, Times, square corners.
export const theme = themeQuartz.withParams({
  accentColor: "#0000ee", // --color-link
  backgroundColor: "#ffffff", // --color-bg
  foregroundColor: "#000000", // --color-text
  borderColor: "#808080", // --color-chrome-dark
  headerBackgroundColor: "#c0c0c0", // --color-chrome
  fontFamily: 'Times, "Times New Roman", "Liberation Serif", serif', // --font-serif
  fontSize: 15,
  borderRadius: 0,
  wrapperBorderRadius: 0,
  spacing: 6,
});

// One grid row. kind "line" is a real material line (`owned` starts from the API's ownedDefault;
// qty and owned are user-editable). The other kinds are synthetic: a group header, a group
// subtotal, and the pinned total. Synthetic rows carry blank fields and a precomputed `cents`.
export type Row = {
  id: string;
  kind: "line" | "header" | "subtotal" | "total";
  group?: MaterialLine["category"]; // which group the row sits in (not set on the total)
  name: string;
  category: MaterialLine["category"]; // only shown for lines
  qty: number;
  unit: string;
  price: string; // contract money string, e.g. "3.28"
  retailer: string;
  productUrl: string;
  imageUrl: string | null;
  owned: boolean;
  cents?: number; // synthetic rows only
};

export const toRow = (line: MaterialLine): Row => ({
  id: line.id,
  kind: "line",
  group: line.category,
  name: line.name,
  category: line.category,
  qty: line.qty,
  unit: line.unit,
  price: line.price,
  retailer: line.retailer,
  productUrl: line.productUrl,
  imageUrl: line.imageUrl,
  owned: line.ownedDefault,
});

const toSummaryRow = (s: SummaryRow): Row => ({
  id: s.id,
  kind: s.kind,
  group: s.group,
  name: s.name,
  category: s.group ?? "material", // never displayed: the Category cell is blank off lines
  qty: 0,
  unit: "",
  price: "",
  retailer: "",
  productUrl: "",
  imageUrl: null,
  owned: false,
  cents: s.cents,
});

const rowKind = (row: Row | undefined): "line" | "header" | "subtotal" =>
  row?.kind === "header" || row?.kind === "subtotal" ? row.kind : "line";

// Runs after the grid's own sort (module-level so its identity is stable): sorting orders the
// lines by the clicked column, then this regroups them as tools then materials.
function postSortRows({ nodes }: PostSortRowsParams<Row>) {
  nodes.splice(0, nodes.length, ...arrangeGroups(nodes, (n) => n.data?.group, (n) => rowKind(n.data)));
}

// Group headers, subtotals and the total stand out from the lines; palette from app/tokens.css.
function getRowStyle({ data }: RowClassParams<Row>): RowStyle | undefined {
  if (data?.kind === "header") return { background: "#c0c0c0", fontWeight: 700 };
  if (data?.kind === "subtotal") return { fontWeight: 700 };
  if (data?.kind === "total") return { background: "#c0c0c0", fontWeight: 700, borderTop: "2px solid #000000" };
  return undefined;
}

// Cell renderers live outside the component so their identity is stable between renders.
// imageUrl comes from the Channel3 price cache (contract/prices.json) when a line is priced, and
// is null for unpriced fixture lines. A URL that fails to load (moved, hotlink-blocked) falls
// back to the same letter tile as a missing one, never a broken-image icon.
// Both cells render nothing on any non-line row, including Enterprise group rows (no data).
export function ImageCell({ data }: ICellRendererParams<Row>) {
  const [failed, setFailed] = useState(false);
  if (!data || data.kind !== "line") return null;
  if (data.imageUrl && /^https?:\/\//i.test(data.imageUrl) && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={data.imageUrl}
        alt=""
        width={40}
        height={40}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        style={{ objectFit: "contain", borderRadius: 4, background: "#ffffff" }}
      />
    );
  }
  return (
    <span aria-hidden="true" style={{ display: "inline-flex", width: 40, height: 40, alignItems: "center", justifyContent: "center", background: "#c0c0c0", color: "#000000", fontWeight: 700 }}>
      {data.name.charAt(0).toUpperCase()}
    </span>
  );
}

// The "buy link" column: a real link on lines, nothing on group/total rows.
export function BuyCell({ data }: ICellRendererParams<Row>) {
  if (!data || data.kind !== "line") return null;
  // Only link http(s) URLs; anything else (javascript:, data:) gets no link.
  if (!/^https?:\/\//i.test(data.productUrl)) return null;
  return (
    <a href={data.productUrl} target="_blank" rel="noopener noreferrer" aria-label={`Buy ${data.name} at ${data.retailer}`}>
      Buy
    </a>
  );
}

// Stands in for the "owned" checkbox on header, subtotal and total rows.
export function EmptyCell() {
  return null;
}

export type MaterialsGridProps = { lines: MaterialLine[]; currency: string };

// Loaded only when a licence key is present. No loading placeholder: the chunk is small next to
// the page and a flash of the Community grid would show the wrong layout.
const EnterpriseMaterialsGrid = dynamic(() =>
  import("./materials-grid-enterprise").then((m) => m.EnterpriseMaterialsGrid),
);

export function MaterialsGrid({ licenseKey, ...props }: MaterialsGridProps & { licenseKey?: string }) {
  return licenseKey ? <EnterpriseMaterialsGrid {...props} licenseKey={licenseKey} /> : <CommunityMaterialsGrid {...props} />;
}

export function CommunityMaterialsGrid({ lines, currency }: MaterialsGridProps) {
  // Only the real lines are state; the summary rows are derived from them below.
  const [rows, setRows] = useState<Row[]>(() => lines.map(toRow));

  const columnDefs = useMemo<ColDef<Row>[]>(
    () => [
      { colId: "image", headerName: "", width: 72, sortable: false, resizable: false, cellRenderer: ImageCell },
      { field: "name", headerName: "Item", flex: 2, minWidth: 220, wrapText: true, autoHeight: true },
      {
        field: "category",
        headerName: "Category",
        width: 110,
        valueFormatter: (p: ValueFormatterParams<Row, string>) => (p.data?.kind === "line" ? (p.value ?? "") : ""),
      },
      {
        field: "qty",
        headerName: "Qty",
        width: 90,
        editable: (p) => p.data?.kind === "line",
        cellEditor: "agNumberCellEditor",
        cellEditorParams: { min: 1, precision: 0, step: 1 },
        valueFormatter: (p: ValueFormatterParams<Row, number>) => (p.data?.kind === "line" ? String(p.value ?? "") : ""),
        // Keep the old value if the user types something that is not a whole number >= 1.
        valueParser: (p: ValueParserParams<Row>) => {
          const n = Math.floor(Number(p.newValue));
          return Number.isFinite(n) && n >= 1 ? n : p.oldValue;
        },
      },
      { field: "unit", headerName: "Unit", width: 90 },
      {
        field: "price",
        headerName: "Unit price",
        width: 110,
        valueFormatter: (p: ValueFormatterParams<Row, string>) => (p.value ? formatMoney(p.value, currency) : ""),
      },
      { field: "retailer", headerName: "Retailer", width: 140 },
      { colId: "buy", headerName: "Buy link", width: 90, sortable: false, resizable: false, cellRenderer: BuyCell },
      // cellDataType "boolean" gives a checkbox; editable lets a click toggle it. Synthetic rows
      // get an empty cell instead of a checkbox.
      {
        field: "owned",
        headerName: "Already own it",
        width: 140,
        editable: (p) => p.data?.kind === "line",
        cellDataType: "boolean",
        cellRendererSelector: (p) => (p.data?.kind === "line" ? undefined : { component: EmptyCell }),
      },
      {
        colId: "lineTotal",
        headerName: "Line total",
        width: 120,
        // Computed, not stored: an owned line costs nothing. Integer cents avoid float drift.
        // Subtotal and total rows show their precomputed sum; group headers show nothing.
        valueGetter: (p: ValueGetterParams<Row>) => {
          if (!p.data || p.data.kind === "header") return undefined;
          return p.data.kind === "line" ? lineCents(p.data) : p.data.cents;
        },
        valueFormatter: (p: ValueFormatterParams<Row, number | undefined>) =>
          p.value == null ? "" : formatCents(p.value, currency),
      },
    ],
    [currency],
  );

  // Mirror grid edits into React state so the totals recompute.
  const onCellValueChanged = (event: CellValueChangedEvent<Row>) => {
    const updated = event.data;
    setRows((current) => current.map((row) => (row.id === updated.id ? { ...updated } : row)));
  };

  const totalCents = sumCents(rows);
  const ownedCount = rows.filter((row) => row.owned).length;

  // Lines plus per-group header/subtotal rows, already in tools-then-materials order (the grid
  // keeps that order through sorts via postSortRows). Rebuilt on every qty edit or owned toggle.
  const gridRows = useMemo(
    () =>
      arrangeGroups([...rows, ...groupSummaryRows(rows).map(toSummaryRow)], (r) => r.group, rowKind),
    [rows],
  );
  const pinnedBottomRows = useMemo(() => [toSummaryRow(totalRow(totalCents))], [totalCents]);

  return (
    <div id="materials-grid">
      <div className="grid-wrap">
        <AgGridReact<Row>
          theme={theme}
          rowData={gridRows}
          pinnedBottomRowData={pinnedBottomRows}
          columnDefs={columnDefs}
          defaultColDef={{ sortable: true, resizable: true }}
          getRowId={(p) => p.data.id}
          getRowStyle={getRowStyle}
          postSortRows={postSortRows}
          onCellValueChanged={onCellValueChanged}
          domLayout="autoHeight"
        />
      </div>
      <p className="grid-total">
        Total to buy: <output id="materials-total">{formatCents(totalCents, currency)}</output>{" "}
        <small>
          ({ownedCount} of {rows.length} items already owned)
        </small>
      </p>
    </div>
  );
}
