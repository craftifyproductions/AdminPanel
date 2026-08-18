import { NextResponse } from "next/server";
import { logRequestActivity } from "@/lib/activity-log";
import { requireSession } from "@/lib/require-session";
import {
  assertAllowedTable,
  getSupabaseAdmin,
  getSupabaseConnection,
  isValidTableName,
  resolveSupabaseError,
  SupabaseConfigError,
} from "@/lib/supabase";
import type { ApiError } from "@/lib/types";
import type { SupabaseDataResponse } from "@/lib/supabase-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

function parsePositiveInt(raw: string | null, fallback: number): number {
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export async function GET(request: Request) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const connection = getSupabaseConnection();
  if (!connection.configured) {
    return NextResponse.json<ApiError>(
      {
        error:
          "Supabase is not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to .env.local and restart the server.",
      },
      { status: 503 },
    );
  }

  const params = new URL(request.url).searchParams;
  const tableParam = params.get("table")?.trim() ?? "";
  if (!tableParam) {
    return NextResponse.json<ApiError>({ error: "Missing table query parameter." }, { status: 400 });
  }
  if (!isValidTableName(tableParam)) {
    return NextResponse.json<ApiError>({ error: "Invalid table name." }, { status: 400 });
  }

  const page = parsePositiveInt(params.get("page"), DEFAULT_PAGE);
  const pageSize = Math.min(
    parsePositiveInt(params.get("pageSize"), DEFAULT_PAGE_SIZE),
    MAX_PAGE_SIZE,
  );

  try {
    const table = await assertAllowedTable(tableParam);
    const client = getSupabaseAdmin();
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const { data, error, count } = await client
      .from(table)
      .select("*", { count: "exact" })
      .range(from, to);

    if (error) {
      throw new SupabaseConfigError(error.message || "Failed to load table data.", 502);
    }

    const rows = Array.isArray(data) ? data : [];
    const total = typeof count === "number" ? count : rows.length;
    const columns =
      rows.length > 0 && typeof rows[0] === "object" && rows[0] !== null
        ? Object.keys(rows[0] as Record<string, unknown>)
        : [];

    if (page === 1) {
      await logRequestActivity(request, "supabase.table.open", {
        summary: `Opened table ${table}`,
        metadata: { table, page, pageSize, total },
      });
    }

    return NextResponse.json<SupabaseDataResponse>(
      {
        table,
        page,
        pageSize,
        total,
        columns,
        rows: rows as Record<string, unknown>[],
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const { status, message } = resolveSupabaseError(error);
    if (status >= 500) console.error("[api/supabase/data] failed", error);
    return NextResponse.json<ApiError>({ error: message }, { status });
  }
}
