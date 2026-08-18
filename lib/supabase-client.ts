import type {
  SupabaseDataResponse,
  SupabaseOverviewResponse,
  SupabaseTablesResponse,
} from "@/lib/supabase-types";

export class SupabaseClientError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "SupabaseClientError";
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

async function request<T>(path: string): Promise<T> {
  let response: Response;

  try {
    response = await fetch(path, { cache: "no-store", credentials: "same-origin" });
  } catch {
    throw new SupabaseClientError("Network error — the server could not be reached.");
  }

  if (response.status === 401) {
    redirectToLogin();
    throw new SupabaseClientError("Session expired. Redirecting to sign in.", 401);
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
    throw new SupabaseClientError(
      readErrorMessage(body) ?? `Request failed with status ${response.status}.`,
      response.status,
    );
  }

  if (body === null) {
    throw new SupabaseClientError("The server returned an unexpected response.");
  }

  return body as T;
}

export function listSupabaseTables(): Promise<SupabaseTablesResponse> {
  return request<SupabaseTablesResponse>("/api/supabase/tables");
}

export function getSupabaseOverview(): Promise<SupabaseOverviewResponse> {
  return request<SupabaseOverviewResponse>("/api/supabase/overview");
}

export function fetchSupabaseTableData(
  table: string,
  page: number,
  pageSize: number,
): Promise<SupabaseDataResponse> {
  const params = new URLSearchParams({
    table,
    page: String(page),
    pageSize: String(pageSize),
  });
  return request<SupabaseDataResponse>(`/api/supabase/data?${params.toString()}`);
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return "Something went wrong.";
}
