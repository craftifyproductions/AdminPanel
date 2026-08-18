import { NextResponse } from "next/server";
import type { ApiError } from "@/lib/types";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function hostFromHeaderValue(value: string): string | null {
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}

export function assertSameOrigin(request: Request): NextResponse<ApiError> | null {
  if (!MUTATING.has(request.method.toUpperCase())) return null;

  const requestHost = new URL(request.url).host;
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");

  if (origin) {
    const originHost = hostFromHeaderValue(origin);
    if (!originHost || originHost !== requestHost) {
      return NextResponse.json<ApiError>({ error: "Forbidden" }, { status: 403 });
    }
    return null;
  }

  if (referer) {
    const refererHost = hostFromHeaderValue(referer);
    if (!refererHost || refererHost !== requestHost) {
      return NextResponse.json<ApiError>({ error: "Forbidden" }, { status: 403 });
    }
    return null;
  }

  if (process.env.NODE_ENV === "production") {
    return NextResponse.json<ApiError>({ error: "Forbidden" }, { status: 403 });
  }

  return null;
}
