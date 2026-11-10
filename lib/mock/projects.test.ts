import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mockProjects } from "./projects";

// getProject() answers a mock slug without asking the API, so a mock must never reuse the slug
// or id of a real project.
describe("mock catalog", () => {
  const dir = join(__dirname, "../../contract/fixtures");
  const fixtures = readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(join(dir, name), "utf8")) as { id: string; slug: string });

  it("reads the fixtures", () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  it("shares no slug or id with contract/fixtures", () => {
    const slugs = new Set(fixtures.map((f) => f.slug));
    const ids = new Set(fixtures.map((f) => f.id));
    expect(mockProjects.filter((m) => slugs.has(m.slug) || ids.has(m.id))).toEqual([]);
  });

  it("has unique slugs and ids", () => {
    expect(new Set(mockProjects.map((m) => m.slug)).size).toBe(mockProjects.length);
    expect(new Set(mockProjects.map((m) => m.id)).size).toBe(mockProjects.length);
  });
});
