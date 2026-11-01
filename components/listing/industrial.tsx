// STUB: proposal 1, "Industrial Revolution". Owned by the engineer building this proposal.
// Styles live in components/listing/industrial.css, scoped under .listing--industrial.
import { ClassicView } from "./classic";
import type { ListingViewProps } from "./types";
import "./industrial.css";

export function IndustrialView(props: ListingViewProps) {
  return <ClassicView {...props} />;
}
