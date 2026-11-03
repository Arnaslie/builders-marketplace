import type { ProjectSummary } from "../../lib/api/client";

// Props for the project index on the home page.
export type ListingViewProps = {
  // The ten (or fewer) projects on this page.
  projects: ProjectSummary[];
  // 0-based position of projects[0] in the whole catalog, for running numbers ("No. 011").
  offset: number;
};
