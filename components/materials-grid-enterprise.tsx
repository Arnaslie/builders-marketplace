"use client";

// AG Grid Enterprise version of the materials grid, used only when the page has a licence key
// (lib/ag-grid-license.ts). components/materials-grid.tsx lazy-loads this file, so keyless
// deploys never download ag-grid-enterprise. Same columns, theme and cells as the Community grid;
// the difference is that grouping, subtotals and the total come from the grid itself instead of
// synthetic rows. Docs this file follows (AG Grid React Data Grid, v36):
//   Licence key:               https://www.ag-grid.com/react-data-grid/license-install/
//   Row grouping:              https://www.ag-grid.com/react-data-grid/grouping/
//   Group order:               https://www.ag-grid.com/react-data-grid/grouping-sorting/
//   Aggregation (aggFunc):     https://www.ag-grid.com/react-data-grid/aggregation/
//   Group / grand total rows:  https://www.ag-grid.com/react-data-grid/aggregation-total-rows/
import { useMemo, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  type CellValueChangedEvent,
  type ColDef,
  type InitialGroupOrderComparatorParams,
  type RowClassParams,
  type RowStyle,
  type ValueFormatterParams,
  type ValueGetterParams,
  type ValueParserParams,
} from "ag-grid-community";
import { LicenseManager, RowGroupingModule } from "ag-grid-enterprise";
import { compareGroupKeys, groupLabel, lineCents, totalCents as sumCents } from "../lib/grid-totals";
import { formatCents, formatMoney } from "../lib/money";
import {
  EmptyCell,
  ImageCell,
  RetailerCell,
  theme,
  toRow,
  type MaterialsGridProps,
  type Row,
} from "./materials-grid";

ModuleRegistry.registerModules([AllCommunityModule, RowGroupingModule]);

// setLicenseKey is static and must run before the grid mounts; only call it when the key changes.
let appliedKey: string | undefined;
function applyLicense(key: string) {
  if (appliedKey === key) return;
  LicenseManager.setLicenseKey(key);
  appliedKey = key;
}

// Tools group before materials, however the user sorts the columns.
const initialGroupOrderComparator = ({ nodeA, nodeB }: InitialGroupOrderComparatorParams<Row>) =>
  compareGroupKeys(nodeA.key, nodeB.key);

// Group rows and total rows have no `data`; only real lines do.
const isLine = (p: { data?: Row; node?: { group?: boolean } | null }) => !!p.data && !p.node?.group;

// Same palette as the Community grid (app/tokens.css): grey group rows, bold subtotals, a ruled total.
function getRowStyle({ node }: RowClassParams<Row>): RowStyle | undefined {
  if (node.footer && node.level === -1) return { background: "#c0c0c0", fontWeight: 700, borderTop: "2px solid #000000" };
  if (node.footer) return { fontWeight: 700 };
  if (node.group) return { background: "#c0c0c0", fontWeight: 700 };
  return undefined;
}

export function EnterpriseMaterialsGrid({ lines, currency, licenseKey }: MaterialsGridProps & { licenseKey: string }) {
  applyLicense(licenseKey);
  const [rows, setRows] = useState<Row[]>(() => lines.map(toRow));

  const columnDefs = useMemo<ColDef<Row>[]>(
    () => [
      { colId: "image", headerName: "", width: 72, sortable: false, resizable: false, cellRenderer: ImageCell },
      { field: "name", headerName: "Item", flex: 2, minWidth: 220, wrapText: true, autoHeight: true },
      // The grouping column. Hidden, because the group column on the left already shows it.
      { field: "category", headerName: "Category", rowGroup: true, hide: true, valueFormatter: (p) => groupLabel(p.value) },
      {
        field: "qty",
        headerName: "Qty",
        width: 90,
        editable: isLine,
        cellEditor: "agNumberCellEditor",
        cellEditorParams: { min: 1, precision: 0, step: 1 },
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
      {
        field: "owned",
        headerName: "Already own it",
        width: 140,
        editable: isLine,
        cellDataType: "boolean",
        cellRendererSelector: (p) => (isLine(p) ? undefined : { component: EmptyCell }),
      },
      {
        colId: "lineTotal",
        headerName: "Line total",
        width: 120,
        // Integer cents per line; the grid sums them into group subtotals and the grand total.
        valueGetter: (p: ValueGetterParams<Row>) => (p.data ? lineCents(p.data) : undefined),
        aggFunc: "sum",
        valueFormatter: (p: ValueFormatterParams<Row, number | undefined>) =>
          p.value == null ? "" : formatCents(p.value, currency),
      },
    ],
    [currency],
  );

  const autoGroupColumnDef = useMemo<ColDef<Row>>(() => ({ headerName: "Group", minWidth: 170 }), []);

  const onCellValueChanged = (event: CellValueChangedEvent<Row>) => {
    const updated = event.data;
    setRows((current) => current.map((row) => (row.id === updated.id ? { ...updated } : row)));
  };

  const totalCents = sumCents(rows);
  const ownedCount = rows.filter((row) => row.owned).length;

  return (
    <div id="materials-grid" data-grid-edition="enterprise">
      <div className="grid-wrap">
        <AgGridReact<Row>
          theme={theme}
          rowData={rows}
          columnDefs={columnDefs}
          defaultColDef={{ sortable: true, resizable: true }}
          autoGroupColumnDef={autoGroupColumnDef}
          groupDefaultExpanded={-1}
          groupTotalRow="bottom"
          grandTotalRow="pinnedBottom"
          suppressAggFuncInHeader
          initialGroupOrderComparator={initialGroupOrderComparator}
          getRowId={(p) => p.data.id}
          getRowStyle={getRowStyle}
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
