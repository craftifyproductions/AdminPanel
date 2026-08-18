import { NextResponse } from "next/server";
import {
  ActivityLogError,
  fetchActivityLogsGrouped,
  type ActivityLogGroup,
} from "@/lib/activity-log";
import { requireSession } from "@/lib/require-session";
import type { ApiError } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type LogsResponse = {
  groups: ActivityLogGroup[];
  note: string;
};

export async function GET(request: Request) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const email = new URL(request.url).searchParams.get("email");

  try {
    const groups = await fetchActivityLogsGrouped({ email });
    return NextResponse.json<LogsResponse>(
      {
        groups,
        note: "Any authenticated admin can view all logs (service role read). MVP access model.",
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof ActivityLogError) {
      return NextResponse.json<ApiError>(
        { error: error.message },
        { status: error.status },
      );
    }
    console.error("[api/logs] GET failed", error);
    return NextResponse.json<ApiError>(
      { error: "Failed to load activity logs." },
      { status: 500 },
    );
  }
}
