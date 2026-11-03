import type { ProjectSummary } from "../../lib/api/client";

// Every listing view takes the same props, so app/page.tsx can swap views without branching.
export type ListingViewProps = {
  // The ten (or fewer) projects on this page.
  projects: ProjectSummary[];
  // 0-based position of projects[0] in the whole catalog, for running numbers ("No. 011").
  offset: number;
};
