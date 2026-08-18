import type { BucketsResponse, ListResponse, StatsResponse } from "@/lib/types";

export const ROOT_PREFIX = "";
export const ROOT_LABEL = "Bucket root";

export class R2ClientError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "R2ClientError";
    this.status = status;
  }
}

function readErrorMessage(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const candidate = (body as { error?: unknown }).error;
  return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
}

function redirectToLogin(): void {
  if (typeof window === "undefined") return;
  const next = `${window.location.pathname}${window.location.search}`;
  window.location.assign(`/login?next=${encodeURIComponent(next)}`);
}

const FULL_STATS_TIMEOUT_MS = 45_000;

function isAbortError(error: unknown): boolean {
  return (
    (typeof DOMException !== "undefined" &&
      error instanceof DOMException &&
      error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;

  try {
    response = await fetch(path, {
      ...init,
      cache: "no-store",
      headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    });
  } catch (error) {
    if (isAbortError(error) || init?.signal?.aborted) {
      throw new R2ClientError("Request timed out. Try again.");
    }
    throw new R2ClientError("Network error — the server could not be reached.");
  }

  if (response.status === 401) {
    redirectToLogin();
    throw new R2ClientError("Session expired. Redirecting to sign in.", 401);
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
    throw new R2ClientError(
      readErrorMessage(body) ?? `Request failed with status ${response.status}.`,
      response.status,
    );
  }

  if (body === null) {
    throw new R2ClientError("The server returned an unexpected response.");
  }

  return body as T;
}

export type FetchObjectResult = {
  kind: string;
  contentType: string;
  size: number;
  blob: Blob;
};

function readObjectHeaders(response: Response, blob: Blob): Omit<FetchObjectResult, "blob"> {
  const kind = response.headers.get("X-R2-Kind")?.trim() || "binary";
  const contentType =
    response.headers.get("X-R2-Content-Type")?.trim() ||
    blob.type ||
    "application/octet-stream";
  const parsedSize = Number(response.headers.get("X-R2-Size"));
  const size = Number.isFinite(parsedSize) && parsedSize >= 0 ? parsedSize : blob.size;
  return { kind, contentType, size };
}

async function readFailedResponse(response: Response): Promise<never> {
  if (response.status === 401) {
    redirectToLogin();
    throw new R2ClientError("Session expired. Redirecting to sign in.", 401);
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

  throw new R2ClientError(
    readErrorMessage(body) ?? `Request failed with status ${response.status}.`,
    response.status,
  );
}

export async function fetchObject(
  key: string,
  options?: { download?: boolean },
): Promise<FetchObjectResult> {
  const params = new URLSearchParams({ key });
  if (options?.download) params.set("download", "1");

  let response: Response;
  try {
    response = await fetch(`/api/r2/object?${params.toString()}`, {
      cache: "no-store",
      credentials: "same-origin",
    });
  } catch {
    throw new R2ClientError("Network error — the server could not be reached.");
  }

  if (!response.ok) await readFailedResponse(response);

  const blob = await response.blob();
  return { ...readObjectHeaders(response, blob), blob };
}

export async function saveObjectText(
  key: string,
  content: string,
  contentType?: string,
): Promise<{ ok: true }> {
  return request("/api/r2/object", {
    method: "PUT",
    body: JSON.stringify({
      key,
      content,
      ...(contentType !== undefined ? { contentType } : {}),
    }),
  });
}

export async function downloadObject(key: string, filename: string): Promise<void> {
  const result = await fetchObject(key, { download: true });
  const url = URL.createObjectURL(result.blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return "Something went wrong.";
}

export function listFolder(prefix: string): Promise<ListResponse> {
  return request<ListResponse>(`/api/r2/list?prefix=${encodeURIComponent(prefix)}`);
}

export function getQuickStats(): Promise<StatsResponse> {
  return request<StatsResponse>("/api/r2/stats?quick=1");
}

export async function getFullStats(options?: {
  fresh?: boolean;
  signal?: AbortSignal;
}): Promise<StatsResponse> {
  const params = new URLSearchParams();
  if (options?.fresh) params.set("fresh", "1");
  const query = params.toString();
  const path = query ? `/api/r2/stats?${query}` : "/api/r2/stats";

  const controller = new AbortController();
  const onAbort = () => controller.abort();
  options?.signal?.addEventListener("abort", onAbort, { once: true });
  if (options?.signal?.aborted) controller.abort();

  const timer = setTimeout(() => controller.abort(), FULL_STATS_TIMEOUT_MS);
  try {
    return await request<StatsResponse>(path, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
    options?.signal?.removeEventListener("abort", onAbort);
  }
}

export function getStats(): Promise<StatsResponse> {
  return getFullStats();
}

export function listBuckets(): Promise<BucketsResponse> {
  return request<BucketsResponse>("/api/r2/bucket");
}

export function switchBucket(name: string): Promise<{ ok: true; bucket: string }> {
  return request("/api/r2/bucket", {
    method: "PUT",
    body: JSON.stringify({ name }),
  });
}

export function createBucket(name: string): Promise<{ ok: true; bucket: string }> {
  return request("/api/r2/bucket", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export function deleteBucket(name: string): Promise<{ ok: true }> {
  return request("/api/r2/bucket", {
    method: "DELETE",
    body: JSON.stringify({ name }),
  });
}

export function createFolder(
  parentPrefix: string,
  name: string,
): Promise<{ ok: true; prefix: string }> {
  return request("/api/r2/folder", {
    method: "POST",
    body: JSON.stringify({ parentPrefix, name }),
  });
}

export function renameFolder(
  prefix: string,
  newName: string,
): Promise<{ ok: true; prefix: string; moved: number }> {
  return request("/api/r2/folder", {
    method: "PATCH",
    body: JSON.stringify({ prefix, newName }),
  });
}

export function deleteFolder(prefix: string): Promise<{ ok: true; deleted: number }> {
  return request("/api/r2/folder", {
    method: "DELETE",
    body: JSON.stringify({ prefix }),
  });
}

export function renameObject(key: string, newName: string): Promise<{ ok: true; key: string }> {
  return request("/api/r2/object", {
    method: "PATCH",
    body: JSON.stringify({ key, newName }),
  });
}

export function deleteObject(key: string): Promise<{ ok: true }> {
  return request("/api/r2/object", {
    method: "DELETE",
    body: JSON.stringify({ key }),
  });
}

export function deleteObjects(keys: string[]): Promise<{ ok: true; deleted: number }> {
  return request("/api/r2/object", {
    method: "DELETE",
    body: JSON.stringify({ keys }),
  });
}

export type BulkDeleteResponse = {
  ok: true;
  deletedFiles: number;
  deletedFolders: number;
  deletedObjects: number;
};

export function bulkDelete(input: {
  files?: string[];
  folders?: string[];
}): Promise<BulkDeleteResponse> {
  return request("/api/r2/bulk", {
    method: "DELETE",
    body: JSON.stringify({
      ...(input.files !== undefined ? { files: input.files } : {}),
      ...(input.folders !== undefined ? { folders: input.folders } : {}),
    }),
  });
}

export type HubSelectItem =
  | { kind: "file"; key: string }
  | { kind: "folder"; prefix: string };

export function hubSelectId(item: HubSelectItem): string {
  return item.kind === "file" ? `file:${item.key}` : `folder:${item.prefix}`;
}

export function parseHubSelectId(id: string): HubSelectItem | null {
  if (id.startsWith("file:")) return { kind: "file", key: id.slice("file:".length) };
  if (id.startsWith("folder:")) return { kind: "folder", prefix: id.slice("folder:".length) };
  return null;
}

export function normalizePrefix(value: string): string {
  const trimmed = value.replace(/^\/+/, "").replace(/\/+$/, "");
  return trimmed.length === 0 ? ROOT_PREFIX : `${trimmed}/`;
}

export type PrefixSegment = { name: string; prefix: string };

export function prefixSegments(prefix: string): PrefixSegment[] {
  const trimmed = prefix.replace(/^\/+/, "").replace(/\/+$/, "");
  if (trimmed.length === 0) return [];

  let accumulated = "";
  return trimmed.split("/").map((name) => {
    accumulated += `${name}/`;
    return { name, prefix: accumulated };
  });
}

export function folderNameOf(prefix: string): string {
  const segments = prefixSegments(prefix);
  return segments.length > 0 ? segments[segments.length - 1].name : ROOT_LABEL;
}

export function parentPrefixOf(prefix: string): string {
  const segments = prefixSegments(prefix);
  return segments.length > 1 ? segments[segments.length - 2].prefix : ROOT_PREFIX;
}

export function ancestorPrefixes(prefix: string): string[] {
  const segments = prefixSegments(prefix);
  const chain: string[] = [ROOT_PREFIX];
  for (let index = 0; index < segments.length - 1; index += 1) {
    chain.push(segments[index].prefix);
  }
  return chain;
}

export function depthOf(prefix: string): number {
  return prefixSegments(prefix).length;
}

export function isInside(prefix: string, ancestor: string): boolean {
  if (ancestor === ROOT_PREFIX) return prefix !== ROOT_PREFIX;
  return prefix === ancestor || prefix.startsWith(ancestor);
}

export type EntryKind = "file" | "folder";

export function validateEntryName(name: string, kind: EntryKind): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return `Enter a ${kind} name.`;
  if (trimmed.includes("/") || trimmed.includes("\\")) {
    return `A ${kind} name cannot contain / or \\.`;
  }
  if (trimmed === "." || trimmed === "..") return "That name is not allowed.";
  return null;
}

export function validateFolderName(name: string): string | null {
  return validateEntryName(name, "folder");
}
