import { notFound } from "next/navigation";
import type { ComponentType } from "react";
import { ClassicView } from "../components/listing/classic";
import { IndustrialView } from "../components/listing/industrial";
import { OffGridView } from "../components/listing/offgrid";
import { Pagination } from "../components/listing/pagination";
import { PostModernView } from "../components/listing/postmodern";
import type { ListingViewProps } from "../components/listing/types";
import { ViewSwitcher } from "../components/listing/view-switcher";
import { listProjects } from "../lib/api/client";
import { PAGE_SIZE, parsePage, parseView, type ViewId } from "../lib/listing";

const VIEW_COMPONENTS: Record<ViewId, ComponentType<ListingViewProps>> = {
  classic: ClassicView,
  industrial: IndustrialView,
  offgrid: OffGridView,
  postmodern: PostModernView,
};

// Next 15: searchParams arrive as a Promise. Reading them makes "/" render per request
// instead of being prerendered once, which is what lets ?page and ?view change the output.
type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function Home({ searchParams }: Props) {
  const params = await searchParams;
  const view = parseView(params.view);
  const page = parsePage(params.page);

  const projects = await listProjects();
  const totalPages = Math.max(1, Math.ceil(projects.length / PAGE_SIZE));
  if (page > totalPages) notFound();

  const offset = (page - 1) * PAGE_SIZE;
  const View = VIEW_COMPONENTS[view];

  // The wrapper class is the hook each proposal's stylesheet scopes itself under.
  return (
    <main className={`listing listing--${view}`}>
      <div className="container">
        <header className="listing-header">
          <h1>DIY Wikipedia</h1>
          <p className="lede">
            Hands-on projects with every material and tool priced out. Pick one, tick what you already own, and see
            what is left to buy.
          </p>
          <ViewSwitcher view={view} page={page} />
        </header>
        <View projects={projects.slice(offset, offset + PAGE_SIZE)} offset={offset} />
        <Pagination view={view} page={page} totalPages={totalPages} total={projects.length} pageSize={PAGE_SIZE} />
      </div>
    </main>
  );
}
