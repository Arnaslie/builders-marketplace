// Tiny helpers for telling mock listings apart from real ones. Kept separate from
// lib/mock/projects.ts so components that only need the check do not pull in the whole
// mock catalog.
export const MOCK_ID_PREFIX = "mock-";

export function isMockProject(id: string): boolean {
  return id.startsWith(MOCK_ID_PREFIX);
}
