import { NextResponse } from "next/server";
import { requireSession } from "@/lib/require-session";
import {
  discoverTables,
  getSupabaseAdmin,
  getSupabaseConnection,
  resolveSupabaseError,
} from "@/lib/supabase";
import type { ApiError } from "@/lib/types";
import type { SupabaseOverviewResponse, SupabaseTableStat } from "@/lib/supabase-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_TABLES = 20;
const COUNT_CONCURRENCY = 4;

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  async function run(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index]!, index);
    }
  }

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, () => run());
  await Promise.all(runners);
  return results;
}

function hostFromUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export async function GET() {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const connection = getSupabaseConnection();
  if (!connection.configured) {
    return NextResponse.json<SupabaseOverviewResponse>(
      {
        configured: false,
        url: null,
        host: null,
        tables: [],
        tableCount: 0,
        listedTableCount: 0,
        totalRows: 0,
        usingServiceRole: false,
        usingAnonFallback: false,
        missing: connection.missing,
        message:
          "Supabase is not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to .env.local and restart the server.",
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const discovery = await discoverTables();
    const listed = discovery.tables.slice(0, MAX_TABLES);
    const client = getSupabaseAdmin();

    const tables = await mapWithConcurrency(
      listed,
      COUNT_CONCURRENCY,
      async (name): Promise<SupabaseTableStat> => {
        try {
          const { count, error } = await client
            .from(name)
            .select("*", { count: "exact", head: true });
          if (error) return { name, rowCount: null };
          return { name, rowCount: typeof count === "number" ? count : null };
        } catch {
          return { name, rowCount: null };
        }
      },
    );

    const totalRows = tables.reduce(
      (sum, table) => sum + (typeof table.rowCount === "number" ? table.rowCount : 0),
      0,
    );

    return NextResponse.json<SupabaseOverviewResponse>(
      {
        configured: true,
        url: connection.url,
        host: hostFromUrl(connection.url),
        tables,
        tableCount: discovery.tables.length,
        listedTableCount: listed.length,
        totalRows,
        usingServiceRole: discovery.usingServiceRole,
        usingAnonFallback: connection.usingAnonFallback,
        missing: [],
        message: discovery.usingServiceRole
          ? null
          : "Using anon key — row counts may be limited by RLS. Prefer SUPABASE_SERVICE_ROLE_KEY on the server.",
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const { status, message } = resolveSupabaseError(error);
    if (status >= 500) console.error("[api/supabase/overview] failed", error);
    return NextResponse.json<ApiError>({ error: message }, { status });
  }
}
