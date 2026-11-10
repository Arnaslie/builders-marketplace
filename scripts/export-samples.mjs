// Writes contract/samples.json from lib/mock/projects.ts so the API can price the SAMPLE projects.
// The TypeScript catalog stays the source of truth; lib/mock/samples-contract.test.ts fails when
// the committed JSON drifts from it. Run: node scripts/export-samples.mjs
import { build } from "esbuild";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const out = await mkdtemp(join(tmpdir(), "samples-"));
try {
  const bundle = join(out, "projects.mjs");
  await build({ entryPoints: ["lib/mock/projects.ts"], bundle: true, platform: "node", format: "esm", outfile: bundle, logLevel: "error" });
  const { mockProjects } = await import(pathToFileURL(bundle).href);
  await writeFile("contract/samples.json", JSON.stringify(mockProjects, null, 2) + "\n");
  console.log(`wrote contract/samples.json (${mockProjects.length} projects)`);
} finally {
  await rm(out, { recursive: true, force: true });
}
