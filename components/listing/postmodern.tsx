// Proposal 3, "Post-Modern Architecture": each page is one facade of ten blocks (Graves, Venturi, Memphis).
// Styles live in components/listing/postmodern.css, scoped under .listing--postmodern.
import Link from "next/link";
import { isMockProject } from "../../lib/mock/ids";
import { formatMoney } from "../../lib/money";
import { ProjectImage } from "../project-image";
import type { ListingViewProps } from "./types";
import "./postmodern.css";

type Shape = "hero" | "arch" | "pediment" | "plain" | "colonnade" | "wide";
type Tone = "salmon" | "sky" | "butter" | "mint" | "lilac";

// Ten fixed slots per page, so every page is the same composition. Tones are picked so no two
// touching blocks share a colour on the six-column layout. Grid spans live in the CSS (.pm-slot-N).
const SLOTS: { shape: Shape; tone: Tone }[] = [
  { shape: "hero", tone: "salmon" },
  { shape: "arch", tone: "sky" },
  { shape: "pediment", tone: "butter" },
  { shape: "plain", tone: "mint" },
  { shape: "colonnade", tone: "lilac" },
  { shape: "wide", tone: "sky" },
  { shape: "arch", tone: "mint" },
  { shape: "pediment", tone: "salmon" },
  { shape: "plain", tone: "butter" },
  { shape: "wide", tone: "lilac" },
];

// Only some blocks get a window, so the page reads as a building rather than a photo wall.
const WINDOW_RATIO: Partial<Record<Shape, string>> = { hero: "4 / 3", arch: "1 / 1", colonnade: "4 / 3" };

export function PostModernView({ projects, offset }: ListingViewProps) {
  return (
    <ul className="pm-facade">
      {projects.map((project, index) => {
        const slot = index % SLOTS.length;
        const { shape, tone } = SLOTS[slot];
        const ratio = WINDOW_RATIO[shape];
        return (
          <li key={project.id} className={`pm-tile pm-slot-${slot} pm-tile--${shape} pm-tone--${tone}`}>
            <Link href={`/projects/${project.slug}`} className="pm-card">
              {/* Pediment, keystone, checkerboard or colonnade, drawn entirely in CSS. */}
              <span className="pm-ornament" aria-hidden="true" />
              {ratio && (
                <div className="pm-window">
                  <ProjectImage title={project.title} imageUrl={project.imageUrl} ratio={ratio} />
                </div>
              )}
              <div className="pm-body">
                <span className="pm-numeral" aria-hidden="true">
                  {String(offset + index + 1).padStart(2, "0")}
                </span>
                {/* Title and summary share one wrapper so patterned blocks can put a solid plate behind them. */}
                <div className="pm-copy">
                  <h2>{project.title}</h2>
                  <p>{project.summary}</p>
                </div>
                <div className="pm-foot">
                  <ul className="pm-stats">
                    <li className="pm-stat">{project.difficulty}</li>
                    <li className="pm-stat">{project.estimatedHours} h</li>
                    <li className="pm-stat">{project.lineCount} items</li>
                  </ul>
                  {/* The price is the one figure people compare, so it gets its own tilted sticker. */}
                  <span className="pm-price">about {formatMoney(project.estimatedTotal, project.currency)}</span>
                </div>
              </div>
              {/* Mock listings get a small plaque in the block's corner instead of one more chip. */}
              {isMockProject(project.id) && (
                <span className="pm-sample" title="Mock listing: placeholder data until the real catalog grows">
                  sample
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
