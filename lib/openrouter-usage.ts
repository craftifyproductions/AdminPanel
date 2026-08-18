import { optionalEnv } from "@/lib/env";

const OPENROUTER_KEY_URL = "https://openrouter.ai/api/v1/key";
const OPENROUTER_CREDITS_URL = "https://openrouter.ai/api/v1/credits";
const FETCH_TIMEOUT_MS = 12_000;

export type OpenRouterAccountCredits = {
  available: boolean;
  totalCredits: number | null;
  totalUsage: number | null;
};

export type OpenRouterUsageResponse = {
  configured: boolean;
  label: string | null;
  usage: number | null;
  usageDaily: number | null;
  usageWeekly: number | null;
  usageMonthly: number | null;
  limit: number | null;
  limitRemaining: number | null;
  limitReset: string | null;
  isFreeTier: boolean | null;
  creditsRemaining: number | null;
  accountCredits: OpenRouterAccountCredits;
  chatModelId: string | null;
  imageModelId: string | null;
  message: string | null;
  error?: string;
};

type OpenRouterKeyData = {
  label?: unknown;
  usage?: unknown;
  usage_daily?: unknown;
  usage_weekly?: unknown;
  usage_monthly?: unknown;
  limit?: unknown;
  limit_remaining?: unknown;
  limit_reset?: unknown;
  is_free_tier?: unknown;
};

type OpenRouterCreditsData = {
  total_credits?: unknown;
  total_usage?: unknown;
};

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function sanitizeKeyLabel(label: string | null, apiKey: string): string | null {
  if (!label) return null;
  if (label === apiKey) return "API key";
  if (/^sk-or-/i.test(label)) {
    const tail = label.slice(-4);
    return tail.length === 4 ? `API key ···${tail}` : "API key";
  }
  return label;
}

function emptyUsage(partial: Partial<OpenRouterUsageResponse> = {}): OpenRouterUsageResponse {
  return {
    configured: false,
    label: null,
    usage: null,
    usageDaily: null,
    usageWeekly: null,
    usageMonthly: null,
    limit: null,
    limitRemaining: null,
    limitReset: null,
    isFreeTier: null,
    creditsRemaining: null,
    accountCredits: {
      available: false,
      totalCredits: null,
      totalUsage: null,
    },
    chatModelId: optionalEnv("OPENROUTER_MODEL_ID"),
    imageModelId: optionalEnv("OPENROUTER_IMAGE_MODEL_ID"),
    message: null,
    ...partial,
  };
}

function readOpenRouterError(body: unknown, fallback: string): string {
  if (typeof body !== "object" || body === null) return fallback;
  const error = (body as { error?: unknown }).error;
  if (typeof error === "string" && error.length > 0) return error;
  if (typeof error === "object" && error !== null) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  return fallback;
}

async function fetchJson(
  url: string,
  apiKey: string,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: controller.signal,
    });

    const raw = await response.text().catch(() => "");
    let body: unknown = null;
    if (raw.length > 0) {
      try {
        body = JSON.parse(raw) as unknown;
      } catch {
        body = null;
      }
    }

    return { ok: response.ok, status: response.status, body };
  } finally {
    clearTimeout(timer);
  }
}

function parseAccountCredits(body: unknown): OpenRouterAccountCredits {
  if (typeof body !== "object" || body === null) {
    return { available: false, totalCredits: null, totalUsage: null };
  }

  const data = (body as { data?: OpenRouterCreditsData }).data;
  if (!data || typeof data !== "object") {
    return { available: false, totalCredits: null, totalUsage: null };
  }

  const totalCredits = asNumber(data.total_credits);
  const totalUsage = asNumber(data.total_usage);
  if (totalCredits === null && totalUsage === null) {
    return { available: false, totalCredits: null, totalUsage: null };
  }

  return {
    available: true,
    totalCredits,
    totalUsage,
  };
}

function computeCreditsRemaining(
  limitRemaining: number | null,
  accountCredits: OpenRouterAccountCredits,
): number | null {
  if (limitRemaining !== null) return limitRemaining;
  if (
    accountCredits.available &&
    accountCredits.totalCredits !== null &&
    accountCredits.totalUsage !== null
  ) {
    return accountCredits.totalCredits - accountCredits.totalUsage;
  }
  return null;
}

export async function fetchOpenRouterUsage(): Promise<OpenRouterUsageResponse> {
  const apiKey = optionalEnv("OPENROUTER_API_KEY");
  const chatModelId = optionalEnv("OPENROUTER_MODEL_ID");
  const imageModelId = optionalEnv("OPENROUTER_IMAGE_MODEL_ID");

  if (!apiKey) {
    return emptyUsage({
      configured: false,
      chatModelId,
      imageModelId,
      message:
        "OpenRouter is not configured. Add OPENROUTER_API_KEY to .env.local and restart the server.",
    });
  }

  try {
    const [keyResult, creditsResult] = await Promise.all([
      fetchJson(OPENROUTER_KEY_URL, apiKey),
      fetchJson(OPENROUTER_CREDITS_URL, apiKey).catch(() => ({
        ok: false,
        status: 0,
        body: null,
      })),
    ]);

    if (!keyResult.ok) {
      const message = readOpenRouterError(
        keyResult.body,
        keyResult.status === 401 || keyResult.status === 403
          ? "OpenRouter rejected the API key."
          : `OpenRouter key lookup failed (${keyResult.status || "network"}).`,
      );
      return emptyUsage({
        configured: true,
        chatModelId,
        imageModelId,
        error: message,
        message,
      });
    }

    const keyPayload =
      typeof keyResult.body === "object" && keyResult.body !== null
        ? (keyResult.body as { data?: OpenRouterKeyData }).data
        : undefined;

    if (!keyPayload || typeof keyPayload !== "object") {
      return emptyUsage({
        configured: true,
        chatModelId,
        imageModelId,
        error: "OpenRouter returned an unexpected key response.",
        message: "OpenRouter returned an unexpected key response.",
      });
    }

    const accountCredits =
      creditsResult.ok && creditsResult.status === 200
        ? parseAccountCredits(creditsResult.body)
        : { available: false, totalCredits: null, totalUsage: null };

    const limitRemaining = asNumber(keyPayload.limit_remaining);
    const limit = asNumber(keyPayload.limit);

    return {
      configured: true,
      label: sanitizeKeyLabel(asString(keyPayload.label), apiKey),
      usage: asNumber(keyPayload.usage),
      usageDaily: asNumber(keyPayload.usage_daily),
      usageWeekly: asNumber(keyPayload.usage_weekly),
      usageMonthly: asNumber(keyPayload.usage_monthly),
      limit,
      limitRemaining,
      limitReset: asString(keyPayload.limit_reset),
      isFreeTier: asBoolean(keyPayload.is_free_tier),
      creditsRemaining: computeCreditsRemaining(limitRemaining, accountCredits),
      accountCredits,
      chatModelId,
      imageModelId,
      message: accountCredits.available
        ? null
        : "Account credits are unavailable for this key (management key may be required).",
    };
  } catch (error) {
    const aborted =
      typeof error === "object" &&
      error !== null &&
      "name" in error &&
      (error as { name?: unknown }).name === "AbortError";
    const message = aborted
      ? "OpenRouter request timed out."
      : "Could not reach OpenRouter.";
    return emptyUsage({
      configured: true,
      chatModelId,
      imageModelId,
      error: message,
      message,
    });
  }
}
