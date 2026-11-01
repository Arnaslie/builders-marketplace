// Proposal 2, "Off the Grid": the catalog as a homesteader's field journal.
// On wide screens entries hang off a twine trail in two staggered columns; each entry's top sits
// halfway down the one before it, so DOM order, tab order and top-to-bottom reading order agree.
// Styles live in components/listing/offgrid.css, scoped under .listing--offgrid.
import Link from "next/link";
import type { CSSProperties } from "react";
import { formatMoney } from "../../lib/money";
import { isMockProject } from "../../lib/mock/ids";
import { ProjectImage } from "../project-image";
import type { ListingViewProps } from "./types";
import "./offgrid.css";

// Fixed tilts (degrees) cycled by catalog position, so a photo keeps the same angle on every render
// instead of jumping around like Math.random() would (and the server and client markup agree).
const TILTS = [-1.6, 1.2, -0.7, 1.8, -1.2];

// "011" style entry numbers, counted across the whole catalog rather than per page.
function entryNumber(position: number): string {
  return String(position).padStart(3, "0");
}

export function OffGridView({ projects, offset }: ListingViewProps) {
  return (
    <ol className="journal">
      {projects.map((project, index) => {
        const position = offset + index + 1;
        // --row places the entry on the staggered grid: each one spans two rows, starting one row
        // below the previous entry, which is what makes neighbours overlap vertically.
        const row = { "--row": index + 1 } as CSSProperties;
        const tilt = { "--tilt": `${TILTS[(position - 1) % TILTS.length]}deg` } as CSSProperties;
        return (
          <li key={project.id} className="journal-item" style={row}>
            <Link href={`/projects/${project.slug}`} className="journal-entry" style={tilt}>
              <p className="journal-number">Entry {entryNumber(position)}</p>
              <div className="journal-photo">
                <ProjectImage title={project.title} imageUrl={project.imageUrl} ratio="4 / 3" />
              </div>
              <div className="journal-text">
                <h2>{project.title}</h2>
                <p className="journal-summary">{project.summary}</p>
                <div className="journal-supplies">
                  <p className="journal-supplies-label">Supplies</p>
                  <ul>
                    <li>{project.difficulty}</li>
                    <li>{project.estimatedHours} h</li>
                    <li>{project.lineCount} items</li>
                    <li>about {formatMoney(project.estimatedTotal, project.currency)}</li>
                  </ul>
                </div>
              </div>
              {/* Mock marker, stamped across the page corner. Last in the DOM so it is read after the
                  details; same text and title as the shared SampleBadge. */}
              {isMockProject(project.id) && (
                <span className="journal-stamp" title="Mock listing: placeholder data until the real catalog grows">
                  sample
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
