import { afterEach, describe, expect, it, vi } from "vitest";
import { agGridLicenseKey, normalizeLicenseKey } from "./ag-grid-license";

describe("normalizeLicenseKey", () => {
  it("treats missing, empty and whitespace-only keys as no licence", () => {
    expect(normalizeLicenseKey(undefined)).toBeUndefined();
    expect(normalizeLicenseKey(null)).toBeUndefined();
    expect(normalizeLicenseKey("")).toBeUndefined();
    expect(normalizeLicenseKey("   \n")).toBeUndefined();
  });

  it("trims a pasted key", () => {
    expect(normalizeLicenseKey("  abc123\n")).toBe("abc123");
  });
});

describe("agGridLicenseKey", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("reads AG_GRID_LICENSE_KEY", () => {
    vi.stubEnv("AG_GRID_LICENSE_KEY", " key-from-render ");
    expect(agGridLicenseKey()).toBe("key-from-render");
  });

  it("is undefined when the variable is blank", () => {
    vi.stubEnv("AG_GRID_LICENSE_KEY", "");
    expect(agGridLicenseKey()).toBeUndefined();
  });
});