// The one place the frontend gets data from.
//
// NEXT_PUBLIC_API_URL unset -> read contract/fixtures/*.json (same shapes the API returns).
// NEXT_PUBLIC_API_URL set   -> call the FastAPI service.
// Types come from lib/api/schema.d.ts, generated from contract/openapi.json (npm run gen:types).
// Money fields are strings in the contract and stay strings here; format them at display time
// (lib/money.ts).
import { toCents } from "../money";
import type { components } from "./schema";

export type Project = components["schemas"]["Project"];
export type ProjectSummary = components["schemas"]["ProjectSummary"];
export type MaterialLine = components["schemas"]["MaterialLine"];
export type DraftLine = components["schemas"]["DraftLine"];
export type RecommendationRequest = components["schemas"]["RecommendationRequest"];
export type Recommendation = components["schemas"]["Recommendation"];
export type BuildCartRequest = components["schemas"]["BuildCartRequest"];
export type Cart = components["schemas"]["Cart"];
export type CartLine = components["schemas"]["CartLine"];
export type CartRequest = components["schemas"]["CartRequest"];
export type SwapPick = components["schemas"]["SwapPick"];
export type CheckoutConfig = components["schemas"]["CheckoutConfig"];
export type Order = components["schemas"]["Order"];
export type PayPalOrder = components["schemas"]["PayPalOrder"];

// Next inlines NEXT_PUBLIC_* at build time, so this works in server and client components.
const API_URL = process.env.NEXT_PUBLIC_API_URL?.replace(/\/+$/, "") || undefined;
export const usingApi = API_URL !== undefined;

// Fixtures are imported lazily so a client component that only needs submitRecommendation
// does not load them. Next cannot glob JSON, so a new fixture file must be added here too
// (order matches the API: files sorted by name).
async function loadFixtures(): Promise<Project[]> {
  const files = await Promise.all([
    import("../../contract/fixtures/chair.json"),
    import("../../contract/fixtures/knife.json"),
    import("../../contract/fixtures/squat-rack.json"),
  ]);
  // The JSON is validated against the Project model by the API's own tests; TypeScript only
  // sees string literals here, so we assert the contract type.
  const real = files.map((file) => file.default as unknown as Project);
  // Mock listings pad the gallery to five pages until the real catalog grows (lib/mock/projects.ts).
  // Imported lazily for the same reason as the fixtures: client components that import this
  // module (recommend-form) must not bundle the mock catalog.
  const { mockProjects } = await import("../mock/projects");
  return [...real, ...mockProjects];
}

// Mirrors api/app/main.py list_projects: summary plus lineCount and estimatedTotal
// (sum of qty x price over every line, owned or not).
function summarise(project: Project): ProjectSummary {
  const cents = project.materials.reduce((sum, line) => sum + line.qty * toCents(line.price), 0);
  const whole = Math.floor(cents / 100);
  const frac = String(cents % 100).padStart(2, "0");
  return {
    id: project.id,
    slug: project.slug,
    title: project.title,
    summary: project.summary,
    difficulty: project.difficulty,
    estimatedHours: project.estimatedHours,
    imageUrl: project.imageUrl,
    lineCount: project.materials.length,
    estimatedTotal: `${whole}.${frac}`,
    currency: project.currency,
  };
}

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? "GET").toUpperCase();
  // Only GET is retried. A retried POST could charge twice (checkout) or save a draft twice.
  if (method !== "GET") return fetch(`${API_URL}${path}`, { cache: "no-store", ...init });
  return getWithRetry(`${API_URL}${path}`, init);
}

// Render's free plan spins the API down when idle and takes up to ~50s to wake it. In that window
// requests hang or get 502/503/504. Worst case here: 3 x 14s + 2s + 4s = 48s.
const ATTEMPTS = 3;
const ATTEMPT_TIMEOUT_MS = 14_000;
const BACKOFF_MS = [2_000, 4_000];
const RETRYABLE = new Set([502, 503, 504]);

async function getWithRetry(url: string, init?: RequestInit): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, BACKOFF_MS[attempt - 1]));
    try {
      const res = await fetch(url, { cache: "no-store", ...init, signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS) });
      // On the last attempt hand back whatever came, so the caller sees the real status.
      if (!RETRYABLE.has(res.status) || attempt === ATTEMPTS - 1) return res;
    } catch (err) {
      lastError = err; // network error or timeout
    }
  }
  throw lastError;
}

// True for "the API is not answering" (network error, timeout, 5xx), as opposed to a real
// answer such as 404. Read-only listings fall back to the fixtures for these.
function isUnavailable(err: unknown): boolean {
  return !(err instanceof ApiUnavailableStatus) || err.status >= 500;
}

class ApiUnavailableStatus extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export async function listProjects(): Promise<ProjectSummary[]> {
  if (!usingApi) return (await loadFixtures()).map(summarise);
  try {
    const res = await apiFetch("/projects");
    if (!res.ok) throw new ApiUnavailableStatus(res.status, `GET /projects failed: HTTP ${res.status}`);
    return (await res.json()) as ProjectSummary[];
  } catch (err) {
    if (!isUnavailable(err)) throw err;
    console.warn("API unavailable for GET /projects, serving fixtures:", err);
    return (await loadFixtures()).map(summarise);
  }
}

// Returns null for an unknown slug so the page can call notFound().
export async function getProject(slug: string): Promise<Project | null> {
  if (!usingApi) return (await loadFixtures()).find((p) => p.slug === slug) ?? null;
  try {
    const res = await apiFetch(`/projects/${encodeURIComponent(slug)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new ApiUnavailableStatus(res.status, `GET /projects/${slug} failed: HTTP ${res.status}`);
    return (await res.json()) as Project;
  } catch (err) {
    if (!isUnavailable(err)) throw err;
    console.warn(`API unavailable for GET /projects/${slug}, serving fixtures:`, err);
    return (await loadFixtures()).find((p) => p.slug === slug) ?? null;
  }
}

export type RecommendationResult =
  | { kind: "saved"; recommendation: Recommendation }
  | { kind: "local"; draft: RecommendationRequest };

// With an API: POST /recommendations. Without one: nothing is sent; the caller shows the draft.
export async function submitRecommendation(draft: RecommendationRequest): Promise<RecommendationResult> {
  if (!usingApi) return { kind: "local", draft };
  const res = await apiFetch("/recommendations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(draft),
  });
  if (!res.ok) {
    let detail = "";
    try {
      const body = (await res.json()) as { detail?: unknown };
      if (Array.isArray(body.detail) && body.detail[0]?.msg) detail = `: ${body.detail[0].msg}`;
    } catch {
      // Non-JSON error body; the status code is enough.
    }
    throw new Error(`The API rejected the draft (HTTP ${res.status})${detail}`);
  }
  return { kind: "saved", recommendation: (await res.json()) as Recommendation };
}

// --- Cart and PayPal checkout -------------------------------------------------------------
// These need the API: there is no fixture fallback for payments. Callers check usingApi first.

// An API error with the HTTP status and FastAPI's string detail, so the PayPal buttons can tell
// a declined card (402, restart the flow) from everything else.
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(detail ? `HTTP ${status}: ${detail}` : `HTTP ${status}`);
  }
}

async function postJson<T>(path: string, body?: unknown): Promise<T> {
  const res = await apiFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw await apiError(res);
  return (await res.json()) as T;
}

async function apiError(res: Response): Promise<ApiError> {
  let detail = "";
  try {
    const body = (await res.json()) as { detail?: unknown };
    if (typeof body.detail === "string") detail = body.detail;
    else if (Array.isArray(body.detail) && body.detail[0]?.msg) detail = String(body.detail[0].msg);
  } catch {
    // Non-JSON error body; the status code is enough.
  }
  return new ApiError(res.status, detail);
}

export function buildCart(request: BuildCartRequest): Promise<Cart> {
  return postJson<Cart>("/agent/build-cart", request);
}

// null when the server has no PayPal credentials (503), so the page can say so plainly.
export async function getCheckoutConfig(): Promise<CheckoutConfig | null> {
  const res = await apiFetch("/checkout/config");
  if (res.status === 503) return null;
  if (!res.ok) throw await apiError(res);
  return (await res.json()) as CheckoutConfig;
}

// POST /cart: price a cart with no LLM call. With request.swaps, exactly those swaps (re-checked
// by the server); without it, the deterministic budget rules. Checkout charges this same cart.
export function priceCart(request: CartRequest): Promise<Cart> {
  return postJson<Cart>("/cart", request);
}

// The server rebuilds the cart from the same request and creates the PayPal order for its total.
export function createCheckoutOrder(request: CartRequest): Promise<PayPalOrder> {
  return postJson<PayPalOrder>("/checkout/orders", request);
}

export function captureCheckoutOrder(paypalOrderId: string): Promise<Order> {
  return postJson<Order>(`/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`);
}

// Returns null for an unknown order (the API keeps orders in memory; a restart forgets them).
export async function getCheckoutOrder(paypalOrderId: string): Promise<Order | null> {
  const res = await apiFetch(`/checkout/orders/${encodeURIComponent(paypalOrderId)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw await apiError(res);
  return (await res.json()) as Order;
}
