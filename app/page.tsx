import Link from "next/link";
import { ProjectImage } from "../components/project-image";
import { listProjects } from "../lib/api/client";
import { formatMoney } from "../lib/money";

// Different image ratios give the CSS-columns masonry uneven card heights to pack.
const RATIOS = ["4 / 3", "1 / 1", "3 / 4"];

export default async function Home() {
  const projects = await listProjects();
  return (
    <main className="container">
      <h1>DIY Wikipedia</h1>
      <p className="lede">
        Hands-on projects with every material and tool priced out. Pick one, tick what you already own, and see what
        is left to buy.
      </p>
      <ul className="masonry">
        {projects.map((project, index) => (
          <li key={project.id}>
            <Link href={`/projects/${project.slug}`} className="card">
              <ProjectImage title={project.title} imageUrl={project.imageUrl} ratio={RATIOS[index % RATIOS.length]} />
              <div className="card-body">
                <h2>{project.title}</h2>
                <p>{project.summary}</p>
                <ul className="meta">
                  <li className="badge">{project.difficulty}</li>
                  <li className="badge">{project.estimatedHours} h</li>
                  <li className="badge">{project.lineCount} items</li>
                  <li className="badge">about {formatMoney(project.estimatedTotal, project.currency)}</li>
                </ul>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
