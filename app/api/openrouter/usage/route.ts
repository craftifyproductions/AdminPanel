import { NextResponse } from "next/server";
import { fetchOpenRouterUsage } from "@/lib/openrouter-usage";
import { requireSession } from "@/lib/require-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const usage = await fetchOpenRouterUsage();
  return NextResponse.json(usage, {
    headers: { "cache-control": "no-store" },
  });
}
