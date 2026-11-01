import { isMockProject } from "../../lib/mock/ids";

// Marks mock listings so nobody mistakes them for real priced projects. Renders nothing for real ones.
export function SampleBadge({ id, className = "badge badge-sample" }: { id: string; className?: string }) {
  if (!isMockProject(id)) return null;
  return (
    <li className={className} title="Mock listing: placeholder data until the real catalog grows">
      sample
    </li>
  );
}
