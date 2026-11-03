import Link from "next/link";
import { formatMoney } from "../../lib/money";
import { isMockProject } from "../../lib/mock/ids";
import { ProjectImage } from "../project-image";
import { SampleBadge } from "./sample-badge";
import type { ListingViewProps } from "./types";
import "./industrial.css";

// Proposal 1, "Industrial Revolution": a factory manifest. Each project is a riveted spec plate
// with a stamped serial number and a ledger of figures. Styles are scoped under .listing--industrial.
export function IndustrialView({ projects, offset }: ListingViewProps) {
  return (
    <ul className="ind-manifest">
      {projects.map((project, index) => (
        <li key={project.id}>
          <Link href={`/projects/${project.slug}`} className="ind-plate">
            <div className="ind-strip">
              <p className="ind-serial">
                <span className="ind-serial-label">No.</span>
                {String(offset + index + 1).padStart(3, "0")}
              </p>
              {/* A list is only rendered when it has an item, so real projects get no empty <ul>. */}
              {isMockProject(project.id) ? (
                <ul className="ind-tags">
                  <SampleBadge id={project.id} className="ind-sample" />
                </ul>
              ) : null}
            </div>
            <div className="ind-body">
              <div className="ind-window">
                <ProjectImage title={project.title} imageUrl={project.imageUrl} ratio="1 / 1" />
              </div>
              <div className="ind-text">
                <h2>{project.title}</h2>
                <p>{project.summary}</p>
              </div>
            </div>
            <dl className="ind-spec">
              <div>
                <dt>Grade</dt>
                <dd>{project.difficulty}</dd>
              </div>
              <div>
                <dt>Shift</dt>
                <dd>{project.estimatedHours} h</dd>
              </div>
              <div>
                <dt>Parts</dt>
                <dd>{project.lineCount}</dd>
              </div>
              <div>
                <dt>Cost</dt>
                <dd>{formatMoney(project.estimatedTotal, project.currency)}</dd>
              </div>
            </dl>
          </Link>
        </li>
      ))}
    </ul>
  );
}
