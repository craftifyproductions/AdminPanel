import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ActivityLogGroup, ActivityLogRow } from "@/lib/activity-log-types";
import type { SessionPayload } from "@/lib/auth";
import { MissingEnvError, optionalEnv } from "@/lib/env";
import { getSession } from "@/lib/require-session";

export type { ActivityLogGroup, ActivityLogRow } from "@/lib/activity-log-types";

export const ACTIVITY_LOGS_TABLE = "admin_activity_logs";

export const ACTIVITY_LOGS_SETUP_HINT =
  "Activity logs require SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY and the admin_activity_logs table. " +
  "Run supabase/admin_activity_logs.sql in the Supabase SQL Editor, then restart the server.";

export type ActivityLogInput = {
  userId: string;
  email: string;
  action: string;
  summary?: string | null;
  path?: string | null;
  metadata?: Record<string, unknown>;
};

export class ActivityLogError extends Error {
  readonly status: number;
  readonly code: "not_configured" | "table_missing" | "query_failed";

  constructor(
    message: string,
    code: "not_configured" | "table_missing" | "query_failed",
    status = 503,
  ) {
    super(message);
    this.name = "ActivityLogError";
    this.code = code;
    this.status = status;
  }
}

function assertServer(): void {
  if (typeof window !== "undefined") {
    throw new Error("lib/activity-log.ts is server-only and must not be imported into client code.");
  }
}

function getServiceRoleClient(): SupabaseClient {
  assertServer();
  const url = optionalEnv("SUPABASE_URL");
  const key = optionalEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    const missing: Array<"SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY"> = [];
    if (!url) missing.push("SUPABASE_URL");
    if (!key) missing.push("SUPABASE_SERVICE_ROLE_KEY");
    throw new MissingEnvError(missing);
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

function isMissingTableError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("admin_activity_logs") &&
    (lower.includes("does not exist") ||
      lower.includes("could not find") ||
      lower.includes("schema cache") ||
      lower.includes("relation"))
  );
}

function normalizeUuid(userId: string): string {
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (uuidPattern.test(userId)) return userId;
  return "00000000-0000-4000-8000-000000000001";
}

export async function logActivity(input: ActivityLogInput): Promise<void> {
  assertServer();
  try {
    const client = getServiceRoleClient();
    const { error } = await client.from(ACTIVITY_LOGS_TABLE).insert({
      user_id: normalizeUuid(input.userId),
      user_email: input.email,
      action: input.action,
      summary: input.summary ?? null,
      path: input.path ?? null,
      metadata: input.metadata ?? {},
    });

    if (error) {
      if (isMissingTableError(error.message)) {
        console.warn(`[activity-log] table missing — ${ACTIVITY_LOGS_SETUP_HINT}`);
        return;
      }
      console.warn("[activity-log] insert failed:", error.message);
    }
  } catch (error) {
    if (error instanceof MissingEnvError) {
      console.warn(`[activity-log] not configured — ${ACTIVITY_LOGS_SETUP_HINT}`);
      return;
    }
    console.warn("[activity-log] insert failed unexpectedly", error);
  }
}

export async function logSessionActivity(
  session: SessionPayload | null | undefined,
  action: string,
  options?: {
    summary?: string | null;
    path?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  if (!session) return;
  await logActivity({
    userId: session.sub,
    email: session.email,
    action,
    summary: options?.summary,
    path: options?.path,
    metadata: options?.metadata,
  });
}

export async function logRequestActivity(
  request: Request,
  action: string,
  options?: {
    summary?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const session = await getSession();
  await logSessionActivity(session, action, {
    summary: options?.summary,
    path: new URL(request.url).pathname,
    metadata: options?.metadata,
  });
}

function asMetadata(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function mapRow(row: Record<string, unknown>): ActivityLogRow | null {
  const id = row.id;
  const userId = row.user_id;
  const email = row.user_email;
  const action = row.action;
  const createdAt = row.created_at;
  if (
    typeof id !== "string" ||
    typeof userId !== "string" ||
    typeof email !== "string" ||
    typeof action !== "string" ||
    typeof createdAt !== "string"
  ) {
    return null;
  }

  return {
    id,
    user_id: userId,
    user_email: email,
    action,
    summary: typeof row.summary === "string" ? row.summary : null,
    path: typeof row.path === "string" ? row.path : null,
    metadata: asMetadata(row.metadata),
    created_at: createdAt,
  };
}

export async function fetchActivityLogsGrouped(options?: {
  email?: string | null;
  limit?: number;
}): Promise<ActivityLogGroup[]> {
  assertServer();

  let client: SupabaseClient;
  try {
    client = getServiceRoleClient();
  } catch (error) {
    if (error instanceof MissingEnvError) {
      throw new ActivityLogError(ACTIVITY_LOGS_SETUP_HINT, "not_configured", 503);
    }
    throw error;
  }

  const limit = Math.min(Math.max(options?.limit ?? 500, 1), 2000);
  let query = client
    .from(ACTIVITY_LOGS_TABLE)
    .select("id,user_id,user_email,action,summary,path,metadata,created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  const emailFilter = options?.email?.trim();
  if (emailFilter) {
    query = query.eq("user_email", emailFilter);
  }

  const { data, error } = await query;
  if (error) {
    if (isMissingTableError(error.message)) {
      throw new ActivityLogError(ACTIVITY_LOGS_SETUP_HINT, "table_missing", 503);
    }
    throw new ActivityLogError(
      error.message || "Failed to load activity logs.",
      "query_failed",
      502,
    );
  }

  const rows = (Array.isArray(data) ? data : [])
    .map((row) => mapRow(row as Record<string, unknown>))
    .filter((row): row is ActivityLogRow => row !== null);

  const groups = new Map<string, ActivityLogGroup>();
  for (const row of rows) {
    const key = row.user_email.toLowerCase();
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        userId: row.user_id,
        email: row.user_email,
        count: 1,
        lastActivityAt: row.created_at,
        events: [row],
      });
      continue;
    }
    existing.count += 1;
    existing.events.push(row);
    if (row.created_at > existing.lastActivityAt) {
      existing.lastActivityAt = row.created_at;
      existing.userId = row.user_id;
    }
  }

  return [...groups.values()].sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
}

export function truncateForLog(value: string, max = 160): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}
