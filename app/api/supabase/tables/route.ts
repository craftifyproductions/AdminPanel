import { NextResponse } from "next/server";
import { requireSession } from "@/lib/require-session";
import {
  discoverTables,
  getSupabaseConnection,
  resolveSupabaseError,
} from "@/lib/supabase";
import type { ApiError } from "@/lib/types";
import type { SupabaseTablesResponse } from "@/lib/supabase-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const connection = getSupabaseConnection();
  if (!connection.configured) {
    return NextResponse.json<SupabaseTablesResponse>(
      {
        configured: false,
        tables: [],
        source: null,
        usingServiceRole: false,
        usingAnonFallback: false,
        url: null,
        missing: connection.missing,
        message:
          "Supabase is not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to .env.local and restart the server.",
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  try {
    const discovery = await discoverTables();
    return NextResponse.json<SupabaseTablesResponse>(
      {
        configured: true,
        tables: discovery.tables,
        source: discovery.source,
        usingServiceRole: discovery.usingServiceRole,
        usingAnonFallback: connection.usingAnonFallback,
        url: connection.url,
        missing: [],
        message: discovery.usingServiceRole
          ? null
          : "Using anon key — results are limited by RLS. Prefer SUPABASE_SERVICE_ROLE_KEY on the server.",
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const { status, message } = resolveSupabaseError(error);
    if (status >= 500) console.error("[api/supabase/tables] failed", error);
    return NextResponse.json<ApiError>({ error: message }, { status });
  }
}
