import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// usingApi is read from the env when the module loads, so each test imports a fresh copy.
async function loadClient() {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.test");
  return import("./client");
}

const summaries = [{ id: "p1", slug: "from-api", title: "From API" }];
const json = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });

describe("read-only API calls while the API wakes up", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("retries a 503 and returns the API's answer", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json(503)).mockResolvedValueOnce(json(200, summaries));
    vi.stubGlobal("fetch", fetchMock);
    const { listProjects } = await loadClient();

    const pending = listProjects();
    await vi.runAllTimersAsync();

    expect(await pending).toEqual(summaries);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("falls back to fixtures when every attempt fails", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);
    const { listProjects, getProject } = await loadClient();

    const list = listProjects();
    await vi.runAllTimersAsync();
    const projects = await list;
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(projects.map((p) => p.slug)).toContain("simple-wooden-chair");

    const one = getProject("simple-wooden-chair");
    await vi.runAllTimersAsync();
    expect((await one)?.slug).toBe("simple-wooden-chair");
  });

  it("does not retry or fall back on a 404", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(404));
    vi.stubGlobal("fetch", fetchMock);
    const { getProject } = await loadClient();

    expect(await getProject("nope")).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never retries a POST", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(503, { detail: "down" }));
    vi.stubGlobal("fetch", fetchMock);
    const { createCheckoutOrder } = await loadClient();

    await expect(createCheckoutOrder({ projectSlug: "x" } as never)).rejects.toThrow("HTTP 503");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // Render's proxy answers 429 while the free API is waking (seen in production logs).
  describe("429 from Render's proxy", () => {
    const chair = { id: "p1", slug: "simple-wooden-chair", title: "From API" };

    it("listProjects retries a 429 and returns the API's answer", async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce(json(429)).mockResolvedValueOnce(json(200, summaries));
      vi.stubGlobal("fetch", fetchMock);
      const { listProjects } = await loadClient();

      const pending = listProjects();
      await vi.runAllTimersAsync();

      expect(await pending).toEqual(summaries);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("getProject retries a 429 and returns the API's answer", async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce(json(429)).mockResolvedValueOnce(json(200, chair));
      vi.stubGlobal("fetch", fetchMock);
      const { getProject } = await loadClient();

      const pending = getProject("simple-wooden-chair");
      await vi.runAllTimersAsync();

      expect(await pending).toEqual(chair);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("listProjects falls back to fixtures when every attempt gets a 429", async () => {
      const fetchMock = vi.fn().mockImplementation(async () => json(429));
      vi.stubGlobal("fetch", fetchMock);
      const { listProjects } = await loadClient();

      const pending = listProjects();
      await vi.runAllTimersAsync();

      expect((await pending).map((p) => p.slug)).toContain("simple-wooden-chair");
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("getProject falls back to fixtures when every attempt gets a 429", async () => {
      const fetchMock = vi.fn().mockImplementation(async () => json(429));
      vi.stubGlobal("fetch", fetchMock);
      const { getProject } = await loadClient();

      const pending = getProject("simple-wooden-chair");
      await vi.runAllTimersAsync();

      expect((await pending)?.slug).toBe("simple-wooden-chair");
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("honours a short Retry-After instead of the full backoff", async () => {
      const limited = new Response("{}", { status: 429, headers: { "Retry-After": "1" } });
      const fetchMock = vi.fn().mockResolvedValueOnce(limited).mockResolvedValueOnce(json(200, summaries));
      vi.stubGlobal("fetch", fetchMock);
      const { listProjects } = await loadClient();

      const pending = listProjects();
      await vi.advanceTimersByTimeAsync(999);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(await pending).toEqual(summaries);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("caps a long Retry-After at the existing backoff slot", async () => {
      const limited = new Response("{}", { status: 429, headers: { "Retry-After": "120" } });
      const fetchMock = vi.fn().mockResolvedValueOnce(limited).mockResolvedValueOnce(json(200, summaries));
      vi.stubGlobal("fetch", fetchMock);
      const { listProjects } = await loadClient();

      const pending = listProjects();
      await vi.advanceTimersByTimeAsync(1_999);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(await pending).toEqual(summaries);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("never retries a POST on 429", async () => {
      const fetchMock = vi.fn().mockResolvedValue(json(429, { detail: "slow down" }));
      vi.stubGlobal("fetch", fetchMock);
      const { createCheckoutOrder } = await loadClient();

      await expect(createCheckoutOrder({ projectSlug: "x" } as never)).rejects.toThrow("HTTP 429");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
