import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MaterialsGrid } from "../../../components/materials-grid";
import { ProjectImage } from "../../../components/project-image";
import { getProject } from "../../../lib/api/client";

// Next 15: route params arrive as a Promise.
type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const project = await getProject(slug);
  return project ? { title: `${project.title} | DIY Wikipedia`, description: project.summary } : {};
}

export default async function ProjectPage({ params }: Props) {
  const { slug } = await params;
  const project = await getProject(slug);
  if (!project) notFound(); // renders the 404 page with HTTP status 404

  return (
    <main className="container">
      <section className="hero">
        <ProjectImage title={project.title} imageUrl={project.imageUrl} />
        <div>
          <h1>{project.title}</h1>
          <p className="lede">{project.summary}</p>
          <ul className="meta">
            <li className="badge">{project.difficulty}</li>
            <li className="badge">{project.estimatedHours} h</li>
            <li className="badge">{project.materials.length} items</li>
          </ul>
        </div>
      </section>

      <h2>Materials and tools</h2>
      <MaterialsGrid lines={project.materials} currency={project.currency} />

      <h2>Steps</h2>
      <ol className="steps">
        {project.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </main>
  );
}
