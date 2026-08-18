import { NextResponse } from "next/server";
import { requireSession } from "@/lib/require-session";
import { getStats, probeBucket, resolveR2Error } from "@/lib/r2";
import type { ApiError, StatsResponse } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  try {
    const url = new URL(request.url);
    const quick = url.searchParams.get("quick") === "1";
    const fresh = url.searchParams.get("fresh") === "1";

    const stats = quick ? await probeBucket() : await getStats({ fresh });
    return NextResponse.json<StatsResponse>(stats, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    console.error("[api/r2/stats] failed", error);
    const { status, message } = resolveR2Error(error);
    return NextResponse.json<ApiError>({ error: message }, { status });
  }
}
