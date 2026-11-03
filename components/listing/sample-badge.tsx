import { isMockProject } from "../../lib/mock/ids";

// Marks mock listings so nobody mistakes them for real priced projects. Renders nothing for real ones.
export function SampleBadge({ id }: { id: string }) {
  if (!isMockProject(id)) return null;
  return (
    <>
      {" "}
      <strong className="sample-tag" title="Mock listing: placeholder data until the real catalog grows">
        [SAMPLE LISTING]
      </strong>
    </>
  );
}
