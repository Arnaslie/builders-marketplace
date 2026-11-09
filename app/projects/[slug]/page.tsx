import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProjectImage } from "../../../components/project-image";
import { ProjectShopping } from "../../../components/project-shopping";
import { agGridLicenseKey } from "../../../lib/ag-grid-license";
import { getProject } from "../../../lib/api/client";
import { isMockProject } from "../../../lib/mock/ids";

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
    <main>
      <h1>{project.title}</h1>
      {isMockProject(project.id) && (
        <p className="sample-note">
          <b>NOTE:</b> Sample project: placeholder materials and prices, not a real listing.
        </p>
      )}
      {/* Only a real picture is shown; a lettered placeholder would not belong on a 1994 page. */}
      {project.imageUrl && <ProjectImage title={project.title} imageUrl={project.imageUrl} />}
      <p>{project.summary}</p>
      <ul>
        <li>Difficulty: {project.difficulty}</li>
        <li>Time: {project.estimatedHours} hours</li>
        <li>Items: {project.materials.length}</li>
      </ul>
      <hr />

      {/* The licence key is read here, at request time, so a change on Render needs no rebuild. */}
      <ProjectShopping
        projectId={project.id}
        slug={project.slug}
        lines={project.materials}
        currency={project.currency}
        licenseKey={agGridLicenseKey()}
      />

      <h2>Steps</h2>
      <ol className="steps">
        {project.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      <hr />
      <p>
        <Link href="/">Return to the Project Index</Link>
      </p>
    </main>
  );
}
