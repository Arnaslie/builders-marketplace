import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mockProjects } from "./projects";

// The API prices the SAMPLE projects from contract/samples.json (api/app/store.py). The TypeScript
// catalog is the source of truth: after editing lib/mock/projects.ts run
// `node scripts/export-samples.mjs` and commit the result.
describe("contract/samples.json", () => {
  it("matches lib/mock/projects.ts", () => {
    const committed = JSON.parse(readFileSync(join(process.cwd(), "contract", "samples.json"), "utf8"));
    expect(committed).toEqual(JSON.parse(JSON.stringify(mockProjects)));
  });
});
