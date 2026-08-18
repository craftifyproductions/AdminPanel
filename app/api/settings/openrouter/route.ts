import { NextResponse } from "next/server";
import { logRequestActivity } from "@/lib/activity-log";
import { assertSameOrigin } from "@/lib/csrf";
import {
  EnvConfigError,
  optionalEnv,
  setOpenRouterImageModelId,
  setOpenRouterModelId,
} from "@/lib/env";
import { requireSession } from "@/lib/require-session";
import type { ApiError } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = Record<string, unknown>;

async function readBody(request: Request): Promise<Body> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    throw new EnvConfigError("Request body must be JSON.", 400);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new EnvConfigError("Request body must be a JSON object.", 400);
  }
  return parsed as Body;
}

async function guard(request: Request) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;
  return assertSameOrigin(request);
}

export async function PATCH(request: Request) {
  const denied = await guard(request);
  if (denied) return denied;

  try {
    const body = await readBody(request);
    const hasModelId = typeof body.modelId === "string";
    const hasImageModelId = typeof body.imageModelId === "string";

    if (!hasModelId && !hasImageModelId) {
      throw new EnvConfigError('Provide "modelId" and/or "imageModelId".', 400);
    }

    let modelId = optionalEnv("OPENROUTER_MODEL_ID") ?? "";
    let imageModelId = optionalEnv("OPENROUTER_IMAGE_MODEL_ID") ?? "";

    if (hasModelId) {
      modelId = await setOpenRouterModelId(body.modelId as string);
    }
    if (hasImageModelId) {
      imageModelId = await setOpenRouterImageModelId(body.imageModelId as string);
    }

    await logRequestActivity(request, "settings.model.update", {
      summary: "Updated OpenRouter model settings",
      metadata: {
        modelId: hasModelId ? modelId || "(cleared)" : undefined,
        imageModelId: hasImageModelId ? imageModelId || "(cleared)" : undefined,
      },
    });

    return NextResponse.json({ ok: true as const, modelId, imageModelId });
  } catch (error) {
    if (error instanceof EnvConfigError) {
      return NextResponse.json<ApiError>({ error: error.message }, { status: error.status });
    }
    console.error("[api/settings/openrouter] PATCH failed", error);
    return NextResponse.json<ApiError>(
      { error: "Could not update OpenRouter model settings." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  return PATCH(request);
}
