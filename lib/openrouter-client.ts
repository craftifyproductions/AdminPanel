import type { OpenRouterUsageResponse } from "@/lib/openrouter-usage";

export class OpenRouterClientError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "OpenRouterClientError";
    this.status = status;
  }
}

function redirectToLogin(): void {
  if (typeof window === "undefined") return;
  const next = `${window.location.pathname}${window.location.search}`;
  window.location.assign(`/login?next=${encodeURIComponent(next)}`);
}

function readErrorMessage(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const candidate = (body as { error?: unknown }).error;
  return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
}

export async function getOpenRouterUsage(): Promise<OpenRouterUsageResponse> {
  let response: Response;

  try {
    response = await fetch("/api/openrouter/usage", {
      cache: "no-store",
      credentials: "same-origin",
    });
  } catch {
    throw new OpenRouterClientError("Network error — the server could not be reached.");
  }

  if (response.status === 401) {
    redirectToLogin();
    throw new OpenRouterClientError("Session expired. Redirecting to sign in.", 401);
  }

  const raw = await response.text().catch(() => "");
  let body: unknown = null;
  if (raw.length > 0) {
    try {
      body = JSON.parse(raw) as unknown;
    } catch {
      body = null;
    }
  }

  if (!response.ok) {
    throw new OpenRouterClientError(
      readErrorMessage(body) ?? `Request failed with status ${response.status}.`,
      response.status,
    );
  }

  if (body === null || typeof body !== "object") {
    throw new OpenRouterClientError("The server returned an unexpected response.");
  }

  return body as OpenRouterUsageResponse;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return "Something went wrong.";
}
