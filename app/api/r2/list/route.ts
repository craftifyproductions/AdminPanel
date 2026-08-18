import { NextResponse } from "next/server";
import { requireSession } from "@/lib/require-session";
import { listLevel, resolveR2Error } from "@/lib/r2";
import type { ApiError, ListResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const prefix = new URL(request.url).searchParams.get("prefix") ?? "";

  try {
    const data = await listLevel(prefix);
    return NextResponse.json<ListResponse>(data, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    const { status, message } = resolveR2Error(error);
    if (status >= 500) console.error("[api/r2/list] failed", error);
    return NextResponse.json<ApiError>({ error: message }, { status });
  }
}
