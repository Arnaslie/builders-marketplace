"use client";

// Read-only AG Grid (Community) for a drafted recommendation. It is not MaterialsGrid: that grid
// is editable, needs a price on every row, and tracks "I own this"; a draft has unpriced rows and
// nothing to edit. It reuses MaterialsGrid's theme so the two look the same.
import { useMemo } from "react";
import { AgGridReact } from "ag-grid-react";
import type { ColDef, ICellRendererParams } from "ag-grid-community";
import type { DraftMaterial } from "../lib/api/client";
import { formatMoney } from "../lib/money";
import { theme } from "./materials-grid";

// Unpriced rows say so in words; colour is only a second cue.
function StatusCell({ data }: ICellRendererParams<DraftMaterial>) {
  if (!data) return null;
  return data.priced ? <span>Priced</span> : <em>Unpriced</em>;
}

function RetailerCell({ data }: ICellRendererParams<DraftMaterial>) {
  if (!data?.retailer) return <span>-</span>;
  // Only link http(s) URLs; anything else is shown as plain text.
  if (!data.productUrl || !/^https?:\/\//i.test(data.productUrl)) return <span>{data.retailer}</span>;
  return (
    <a href={data.productUrl} target="_blank" rel="noopener noreferrer">
      {data.retailer}
    </a>
  );
}

export function DraftGrid({ lines, currency }: { lines: DraftMaterial[]; currency: string }) {
  const columnDefs = useMemo<ColDef<DraftMaterial>[]>(
    () => [
      { field: "name", headerName: "Item", flex: 2, minWidth: 220, wrapText: true, autoHeight: true },
      { field: "category", headerName: "Category", width: 110 },
      { field: "qty", headerName: "Qty", width: 80 },
      { field: "unit", headerName: "Unit", width: 90 },
      { colId: "status", headerName: "Price", width: 110, cellRenderer: StatusCell },
      {
        field: "unitPrice",
        headerName: "Unit price",
        width: 110,
        valueFormatter: (p) => (p.value ? formatMoney(p.value, currency) : "-"),
      },
      { field: "retailer", headerName: "Retailer", width: 150, cellRenderer: RetailerCell },
      {
        field: "lineTotal",
        headerName: "Line total",
        width: 120,
        valueFormatter: (p) => (p.value ? formatMoney(p.value, currency) : "-"),
      },
    ],
    [currency],
  );

  return (
    <div className="grid-wrap" id="draft-grid">
      <AgGridReact<DraftMaterial>
        theme={theme}
        rowData={lines}
        columnDefs={columnDefs}
        defaultColDef={{ sortable: true, resizable: true, editable: false }}
        getRowId={(p) => p.data.name}
        rowClassRules={{ "draft-unpriced": (p) => p.data?.priced === false }}
        domLayout="autoHeight"
      />
    </div>
  );
}
