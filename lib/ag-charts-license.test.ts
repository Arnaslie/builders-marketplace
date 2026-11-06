import { afterEach, describe, expect, it, vi } from "vitest";
import { agChartsLicenseKey } from "./ag-charts-license";

afterEach(() => vi.unstubAllEnvs());

describe("agChartsLicenseKey", () => {
  it("is undefined when AG_CHARTS_LICENSE_KEY is unset", () => {
    vi.stubEnv("AG_CHARTS_LICENSE_KEY", undefined as unknown as string);
    expect(agChartsLicenseKey()).toBeUndefined();
  });

  it("is undefined when blank or whitespace", () => {
    vi.stubEnv("AG_CHARTS_LICENSE_KEY", "   ");
    expect(agChartsLicenseKey()).toBeUndefined();
  });

  it("returns the trimmed key when set", () => {
    vi.stubEnv("AG_CHARTS_LICENSE_KEY", "  KEY123 ");
    expect(agChartsLicenseKey()).toBe("KEY123");
  });
});
