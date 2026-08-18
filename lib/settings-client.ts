export class SettingsClientError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "SettingsClientError";
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

type SaveResult = { ok: true; modelId: string; imageModelId: string };

async function patchOpenRouter(body: {
  modelId?: string;
  imageModelId?: string;
}): Promise<SaveResult> {
  let response: Response;

  try {
    response = await fetch("/api/settings/openrouter", {
      method: "PATCH",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new SettingsClientError("Network error — the server could not be reached.");
  }

  if (response.status === 401) {
    redirectToLogin();
    throw new SettingsClientError("Session expired. Redirecting to sign in.", 401);
  }

  const raw = await response.text().catch(() => "");
  let parsed: unknown = null;
  if (raw.length > 0) {
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      parsed = null;
    }
  }

  if (!response.ok) {
    throw new SettingsClientError(
      readErrorMessage(parsed) ?? `Request failed with status ${response.status}.`,
      response.status,
    );
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as { ok?: unknown }).ok !== true ||
    typeof (parsed as { modelId?: unknown }).modelId !== "string" ||
    typeof (parsed as { imageModelId?: unknown }).imageModelId !== "string"
  ) {
    throw new SettingsClientError("The server returned an unexpected response.");
  }

  return {
    ok: true,
    modelId: (parsed as { modelId: string }).modelId,
    imageModelId: (parsed as { imageModelId: string }).imageModelId,
  };
}

export async function saveOpenRouterModelId(modelId: string): Promise<SaveResult> {
  return patchOpenRouter({ modelId });
}

export async function saveOpenRouterImageModelId(imageModelId: string): Promise<SaveResult> {
  return patchOpenRouter({ imageModelId });
}
