import Link from "next/link";
import { formatMoney } from "../../lib/money";
import { Banner } from "./banner";
import { SampleBadge } from "./sample-badge";
import type { ListingViewProps } from "./types";

// The project index, laid out like the "Publications..." list on the 1994 CIA server page:
// one row per project, a bordered banner and the title inside a single underlined link, then a
// plain paragraph of particulars. Plain HTML elements; the look comes from app/globals.css.
export function ProjectIndex({ projects, offset }: ListingViewProps) {
  return (
    <ul className="project-index">
      {projects.map((project, index) => {
        const number = offset + index + 1;
        return (
          <li key={project.id}>
            <Link href={`/projects/${project.slug}`} className="index-link">
              <Banner number={number} variant={number % 2 === 1 ? "olive" : "ivory"} />{" "}
              <span className="index-title">{project.title}</span>
            </Link>
            <p className="index-summary">{project.summary}</p>
            <p className="index-particulars">
              Difficulty: {project.difficulty}. Time: {project.estimatedHours} hours. Items: {project.lineCount}.
              Estimated cost: about {formatMoney(project.estimatedTotal, project.currency)}.
              <SampleBadge id={project.id} />
            </p>
          </li>
        );
      })}
    </ul>
  );
}
