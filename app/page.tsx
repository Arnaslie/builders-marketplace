import { notFound } from "next/navigation";
import { Pagination } from "../components/listing/pagination";
import { ProjectIndex } from "../components/listing/project-index";
import { listProjects } from "../lib/api/client";
import { PAGE_SIZE, parsePage } from "../lib/listing";

// Next 15: searchParams arrive as a Promise. Reading them makes "/" render per request
// instead of being prerendered once, which is what lets ?page change the output.
type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function Home({ searchParams }: Props) {
  const params = await searchParams;
  const page = parsePage(params.page);

  const projects = await listProjects();
  const totalPages = Math.max(1, Math.ceil(projects.length / PAGE_SIZE));
  if (page > totalPages) notFound();

  const offset = (page - 1) * PAGE_SIZE;

  // Section order follows the 1994 CIA server page: a caps mission heading and plain paragraphs,
  // a rule, then the "Publications..." style list.
  return (
    <main className="listing">
      <h1>BUILDERS MARKETPLACE MISSION</h1>
      <p>
        In support of the home builder&apos;s fundamental role as principal maker of things around the house, the
        Server&apos;s mission is to:
      </p>
      <p>
        Provide builders with accurate, comprehensive, and timely project instructions, with every material and
        tool priced out; and to let each builder tick what they already own and see what is left to buy.
      </p>
      <hr />
      <h3>Builders Marketplace Projects...</h3>
      <ProjectIndex projects={projects.slice(offset, offset + PAGE_SIZE)} offset={offset} />
      <hr />
      <Pagination page={page} totalPages={totalPages} total={projects.length} pageSize={PAGE_SIZE} />
    </main>
  );
}
