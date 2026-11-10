import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// usingApi is read from the env when the module loads, so each test imports a fresh copy.
async function loadClient() {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.test");
  const client = await import("./client");
  // getProject loads the mock catalog before its first fetch. Load it now so the fake-timer
  // tests below do not have to wait for that import (a mock slug never calls fetch).
  await client.getProject("floating-wall-shelf");
  return client;
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

    expect((await pending).slice(0, summaries.length)).toEqual(summaries);
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

    await expect(createCheckoutOrder({ projectId: "p1" } as never)).rejects.toThrow("HTTP 503");
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

      expect((await pending).slice(0, summaries.length)).toEqual(summaries);
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
      expect((await pending).slice(0, summaries.length)).toEqual(summaries);
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
      expect((await pending).slice(0, summaries.length)).toEqual(summaries);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("never retries a POST on 429", async () => {
      const fetchMock = vi.fn().mockResolvedValue(json(429, { detail: "slow down" }));
      vi.stubGlobal("fetch", fetchMock);
      const { createCheckoutOrder } = await loadClient();

      await expect(createCheckoutOrder({ projectId: "p1" } as never)).rejects.toThrow("HTTP 429");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});

describe("sample mock listings", () => {
  const apiList = [
    { id: "proj-chair", slug: "simple-wooden-chair", title: "Chair" },
    { id: "mock-floating-wall-shelf", slug: "floating-wall-shelf", title: "API copy of a mock" },
  ];

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

  it("healthy API: real projects first, then mocks, with the API entry winning a duplicate", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(200, apiList)));
    const { listProjects } = await loadClient();

    const list = await listProjects();

    expect(list.slice(0, 2)).toEqual(apiList);
    expect(list).toHaveLength(2 + 46); // 47 mocks, one of them taken by the API's copy
    expect(list.filter((p) => p.slug === "floating-wall-shelf")).toHaveLength(1);
    expect(list.slice(2).every((p) => p.id.startsWith("mock-") && p.lineCount > 0)).toBe(true);
  });

  it("API down: the same set of listings, with fixtures standing in for the real projects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const { listProjects } = await loadClient();

    const pending = listProjects();
    await vi.runAllTimersAsync();
    const list = await pending;

    expect(list).toHaveLength(50);
    expect(list.slice(3).every((p) => p.id.startsWith("mock-"))).toBe(true);
    expect(list.slice(0, 3).every((p) => !p.id.startsWith("mock-"))).toBe(true);
  });

  it("no API: fixtures plus mocks", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_API_URL", "");
    const { listProjects } = await import("./client");
    expect(await listProjects()).toHaveLength(50);
  });

  it("a mock slug resolves without calling the API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { getProject } = await loadClient();

    const project = await getProject("floating-wall-shelf");

    expect(project?.id).toBe("mock-floating-wall-shelf");
    expect(project?.materials.length).toBeGreaterThan(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("an unknown slug is still null, and a real slug still calls the API", async () => {
    const chair = { id: "proj-chair", slug: "simple-wooden-chair" };
    const fetchMock = vi.fn().mockResolvedValueOnce(json(404)).mockResolvedValueOnce(json(200, chair));
    vi.stubGlobal("fetch", fetchMock);
    const { getProject } = await loadClient();

    expect(await getProject("nope")).toBeNull();
    expect(await getProject("simple-wooden-chair")).toEqual(chair);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://api.test/projects/nope",
      "https://api.test/projects/simple-wooden-chair",
    ]);
  });

  it("never sends a mock project to the cart, agent or PayPal endpoints", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { buildCart, priceCart, createCheckoutOrder } = await loadClient();
    const request = { projectId: "mock-floating-wall-shelf", owned: [] };

    await expect(buildCart(request)).rejects.toThrow(/Sample project/);
    await expect(priceCart(request)).rejects.toThrow(/Sample project/);
    await expect(createCheckoutOrder(request)).rejects.toThrow(/Sample project/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("submitRecommendation", () => {
  const idea = { title: "Pine Stool", description: "A small three-legged stool." };

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("POSTs the idea once and returns the draft", async () => {
    const draft = { id: "rec_1", status: "draft", materials: [], estimatedTotal: "0.00" };
    const fetchMock = vi.fn().mockResolvedValueOnce(json(201, draft));
    vi.stubGlobal("fetch", fetchMock);
    const { submitRecommendation } = await loadClient();

    await expect(submitRecommendation(idea)).resolves.toEqual(draft);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.test/recommendations");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual(idea);
  });

  it("surfaces the server's message on a 502 and does not retry the POST", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(502, { detail: "The drafting model did not respond" }));
    vi.stubGlobal("fetch", fetchMock);
    const { submitRecommendation } = await loadClient();

    await expect(submitRecommendation(idea)).rejects.toThrow(/HTTP 502.*drafting model did not respond/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails clearly when no API is configured", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_API_URL", "");
    const { submitRecommendation } = await import("./client");
    await expect(submitRecommendation(idea)).rejects.toThrow(/NEXT_PUBLIC_API_URL/);
  });
});
