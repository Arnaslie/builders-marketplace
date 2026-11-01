// STUB: proposal 2, "Off the Grid". Owned by the engineer building this proposal.
// Styles live in components/listing/offgrid.css, scoped under .listing--offgrid.
import { ClassicView } from "./classic";
import type { ListingViewProps } from "./types";
import "./offgrid.css";

export function OffGridView(props: ListingViewProps) {
  return <ClassicView {...props} />;
}
