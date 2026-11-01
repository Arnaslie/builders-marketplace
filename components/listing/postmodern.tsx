// STUB: proposal 3, "Post-Modern Architecture". Owned by the engineer building this proposal.
// Styles live in components/listing/postmodern.css, scoped under .listing--postmodern.
import { ClassicView } from "./classic";
import type { ListingViewProps } from "./types";
import "./postmodern.css";

export function PostModernView(props: ListingViewProps) {
  return <ClassicView {...props} />;
}
