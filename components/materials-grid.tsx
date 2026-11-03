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
import { useMemo, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type CellValueChangedEvent,
  type ColDef,
  type ICellRendererParams,
  type ValueFormatterParams,
  type ValueGetterParams,
  type ValueParserParams,
} from "ag-grid-community";
import type { MaterialLine } from "../lib/api/client";
import { formatCents, formatMoney, toCents } from "../lib/money";

// Registers every Community feature once for this module (a grid with no modules throws).
ModuleRegistry.registerModules([AllCommunityModule]);

// The grid theme cannot read CSS variables, so these are the values from app/tokens.css as
// literals. Keep them in sync with that file. The look is a 1994 bordered <table>: grey header
// row, grey rules, Times, square corners.
const theme = themeQuartz.withParams({
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

// One grid row. `owned` starts from the API's ownedDefault; qty and owned are user-editable.
type Row = {
  id: string;
  name: string;
  category: MaterialLine["category"];
  qty: number;
  unit: string;
  price: string; // contract money string, e.g. "3.28"
  retailer: string;
  productUrl: string;
  imageUrl: string | null;
  owned: boolean;
};

const toRow = (line: MaterialLine): Row => ({
  id: line.id,
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

// Cell renderers live outside the component so their identity is stable between renders.
function ImageCell({ data }: ICellRendererParams<Row>) {
  if (!data) return null;
  if (data.imageUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={data.imageUrl} alt="" width={40} height={40} style={{ objectFit: "cover", borderRadius: 4 }} />;
  }
  return (
    <span aria-hidden="true" style={{ display: "inline-flex", width: 40, height: 40, alignItems: "center", justifyContent: "center", background: "#c0c0c0", color: "#000000", fontWeight: 700 }}>
      {data.name.charAt(0).toUpperCase()}
    </span>
  );
}

function RetailerCell({ data }: ICellRendererParams<Row>) {
  if (!data) return null;
  // Only link http(s) URLs; anything else (javascript:, data:) is shown as plain text.
  if (!/^https?:\/\//i.test(data.productUrl)) return <span>{data.retailer}</span>;
  return (
    <a href={data.productUrl} target="_blank" rel="noopener noreferrer">
      {data.retailer}
    </a>
  );
}

export function MaterialsGrid({ lines, currency }: { lines: MaterialLine[]; currency: string }) {
  const [rows, setRows] = useState<Row[]>(() => lines.map(toRow));

  const columnDefs = useMemo<ColDef<Row>[]>(
    () => [
      { colId: "image", headerName: "", width: 72, sortable: false, resizable: false, cellRenderer: ImageCell },
      { field: "name", headerName: "Item", flex: 2, minWidth: 220, wrapText: true, autoHeight: true },
      { field: "category", headerName: "Category", width: 110 },
      {
        field: "qty",
        headerName: "Qty",
        width: 90,
        editable: true,
        cellEditor: "agNumberCellEditor",
        cellEditorParams: { min: 1, precision: 0, step: 1 },
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
      { field: "retailer", headerName: "Retailer", width: 160, cellRenderer: RetailerCell },
      // cellDataType "boolean" gives a checkbox; editable lets a click toggle it.
      { field: "owned", headerName: "Already own it", width: 140, editable: true, cellDataType: "boolean" },
      {
        colId: "lineTotal",
        headerName: "Line total",
        width: 120,
        // Computed, not stored: an owned line costs nothing. Integer cents avoid float drift.
        valueGetter: (p: ValueGetterParams<Row>) => (!p.data || p.data.owned ? 0 : p.data.qty * toCents(p.data.price)),
        valueFormatter: (p: ValueFormatterParams<Row, number>) => formatCents(p.value ?? 0, currency),
      },
    ],
    [currency],
  );

  // Mirror grid edits into React state so the total below recomputes.
  const onCellValueChanged = (event: CellValueChangedEvent<Row>) => {
    const updated = event.data;
    setRows((current) => current.map((row) => (row.id === updated.id ? { ...updated } : row)));
  };

  const totalCents = rows.reduce((sum, row) => (row.owned ? sum : sum + row.qty * toCents(row.price)), 0);
  const ownedCount = rows.filter((row) => row.owned).length;

  return (
    <div id="materials-grid">
      <div className="grid-wrap">
        <AgGridReact<Row>
          theme={theme}
          rowData={rows}
          columnDefs={columnDefs}
          defaultColDef={{ sortable: true, resizable: true }}
          getRowId={(p) => p.data.id}
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
