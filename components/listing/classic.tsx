import Link from "next/link";
import { formatMoney } from "../../lib/money";
import { ProjectImage } from "../project-image";
import { SampleBadge } from "./sample-badge";
import type { ListingViewProps } from "./types";

// Different image ratios give the CSS-columns masonry uneven card heights to pack.
const RATIOS = ["4 / 3", "1 / 1", "3 / 4"];

// The original masonry gallery, kept as the default while the proposals are compared.
export function ClassicView({ projects, offset }: ListingViewProps) {
  return (
    <ul className="masonry">
      {projects.map((project, index) => (
        <li key={project.id}>
          <Link href={`/projects/${project.slug}`} className="card">
            <ProjectImage
              title={project.title}
              imageUrl={project.imageUrl}
              ratio={RATIOS[(offset + index) % RATIOS.length]}
            />
            <div className="card-body">
              <h2>{project.title}</h2>
              <p>{project.summary}</p>
              <ul className="meta">
                <li className="badge">{project.difficulty}</li>
                <li className="badge">{project.estimatedHours} h</li>
                <li className="badge">{project.lineCount} items</li>
                <li className="badge">about {formatMoney(project.estimatedTotal, project.currency)}</li>
                <SampleBadge id={project.id} />
              </ul>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
