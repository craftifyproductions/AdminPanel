import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { MissingEnvError, optionalEnv, type EnvKey } from "@/lib/env";
import type { TableDiscoverySource } from "@/lib/supabase-types";

export const TABLE_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export class SupabaseConfigError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "SupabaseConfigError";
    this.status = status;
  }
}

export type SupabaseConnection = {
  configured: boolean;
  url: string | null;
  usingServiceRole: boolean;
  usingAnonFallback: boolean;
  missing: EnvKey[];
};

export function getSupabaseConnection(): SupabaseConnection {
  const url = optionalEnv("SUPABASE_URL");
  const serviceRole = optionalEnv("SUPABASE_SERVICE_ROLE_KEY");
  const anon = optionalEnv("SUPABASE_ANON_KEY");
  const missing: EnvKey[] = [];
  if (!url) missing.push("SUPABASE_URL");
  if (!serviceRole && !anon) missing.push("SUPABASE_SERVICE_ROLE_KEY");

  return {
    configured: missing.length === 0,
    url,
    usingServiceRole: Boolean(url && serviceRole),
    usingAnonFallback: Boolean(url && !serviceRole && anon),
    missing,
  };
}

export function isSupabaseConfigured(): boolean {
  return getSupabaseConnection().configured;
}

function assertServer(): void {
  if (typeof window !== "undefined") {
    throw new Error("lib/supabase.ts is server-only and must not be imported into client code.");
  }
}

export function getSupabaseAdmin(): SupabaseClient {
  assertServer();
  const connection = getSupabaseConnection();
  if (!connection.configured || !connection.url) {
    throw new MissingEnvError(
      connection.missing.length > 0 ? connection.missing : ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"],
    );
  }

  const key =
    optionalEnv("SUPABASE_SERVICE_ROLE_KEY") ?? optionalEnv("SUPABASE_ANON_KEY");
  if (!key) {
    throw new MissingEnvError(["SUPABASE_SERVICE_ROLE_KEY"]);
  }

  return createClient(connection.url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export function parseTableAllowlist(raw: string | null): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const tables: string[] = [];
  for (const part of raw.split(",")) {
    const name = part.trim();
    if (!name || !TABLE_NAME_PATTERN.test(name) || seen.has(name)) continue;
    seen.add(name);
    tables.push(name);
  }
  return tables.sort((a, b) => a.localeCompare(b));
}

export function isValidTableName(name: string): boolean {
  return TABLE_NAME_PATTERN.test(name);
}

function extractTablesFromOpenApi(body: unknown): string[] {
  if (typeof body !== "object" || body === null) return [];
  const paths = (body as { paths?: unknown }).paths;
  if (typeof paths !== "object" || paths === null) return [];

  const tables: string[] = [];
  const seen = new Set<string>();
  for (const path of Object.keys(paths)) {
    if (!path.startsWith("/") || path.includes("{")) continue;
    const name = path.slice(1);
    if (!name || name === "rpc" || name.startsWith("rpc/") || !TABLE_NAME_PATTERN.test(name)) {
      continue;
    }
    if (seen.has(name)) continue;
    seen.add(name);
    tables.push(name);
  }
  return tables.sort((a, b) => a.localeCompare(b));
}

async function listTablesViaOpenApi(url: string, key: string): Promise<string[] | null> {
  const endpoint = `${url.replace(/\/+$/, "")}/rest/v1/`;
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "GET",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: "application/openapi+json",
      },
      cache: "no-store",
    });
  } catch {
    return null;
  }

  if (!response.ok) return null;

  try {
    const body = (await response.json()) as unknown;
    const tables = extractTablesFromOpenApi(body);
    return tables.length > 0 ? tables : null;
  } catch {
    return null;
  }
}

async function listTablesViaInformationSchema(client: SupabaseClient): Promise<string[] | null> {
  try {
    const { data, error } = await client
      .schema("information_schema")
      .from("tables")
      .select("table_name")
      .eq("table_schema", "public")
      .eq("table_type", "BASE TABLE");

    if (error || !Array.isArray(data)) return null;

    const tables = data
      .map((row) => {
        const name = (row as { table_name?: unknown }).table_name;
        return typeof name === "string" ? name : null;
      })
      .filter((name): name is string => Boolean(name && TABLE_NAME_PATTERN.test(name)));

    const unique = [...new Set(tables)].sort((a, b) => a.localeCompare(b));
    return unique.length > 0 ? unique : null;
  } catch {
    return null;
  }
}

export type TableDiscoveryResult = {
  tables: string[];
  source: TableDiscoverySource;
  usingServiceRole: boolean;
};

const DISCOVERY_CACHE_TTL_MS = 30_000;
let discoveryCache: { expiresAt: number; result: TableDiscoveryResult; cacheKey: string } | null =
  null;

function discoveryCacheKey(url: string, usingServiceRole: boolean, allowlistRaw: string | null): string {
  return `${url}\u0000${usingServiceRole ? "1" : "0"}\u0000${allowlistRaw ?? ""}`;
}

export async function discoverTables(): Promise<TableDiscoveryResult> {
  assertServer();
  const connection = getSupabaseConnection();
  if (!connection.configured || !connection.url) {
    throw new MissingEnvError(
      connection.missing.length > 0 ? connection.missing : ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"],
    );
  }

  const key =
    optionalEnv("SUPABASE_SERVICE_ROLE_KEY") ?? optionalEnv("SUPABASE_ANON_KEY");
  if (!key) throw new MissingEnvError(["SUPABASE_SERVICE_ROLE_KEY"]);

  const allowlistRaw = optionalEnv("SUPABASE_TABLES");
  const cacheKey = discoveryCacheKey(connection.url, connection.usingServiceRole, allowlistRaw);
  if (discoveryCache && discoveryCache.cacheKey === cacheKey && discoveryCache.expiresAt > Date.now()) {
    return discoveryCache.result;
  }

  const fromOpenApi = await listTablesViaOpenApi(connection.url, key);
  if (fromOpenApi) {
    const result: TableDiscoveryResult = {
      tables: fromOpenApi,
      source: "openapi",
      usingServiceRole: connection.usingServiceRole,
    };
    discoveryCache = { expiresAt: Date.now() + DISCOVERY_CACHE_TTL_MS, result, cacheKey };
    return result;
  }

  const client = getSupabaseAdmin();
  const fromSchema = await listTablesViaInformationSchema(client);
  if (fromSchema) {
    const result: TableDiscoveryResult = {
      tables: fromSchema,
      source: "information_schema",
      usingServiceRole: connection.usingServiceRole,
    };
    discoveryCache = { expiresAt: Date.now() + DISCOVERY_CACHE_TTL_MS, result, cacheKey };
    return result;
  }

  const allowlist = parseTableAllowlist(allowlistRaw);
  if (allowlist.length > 0) {
    const result: TableDiscoveryResult = {
      tables: allowlist,
      source: "allowlist",
      usingServiceRole: connection.usingServiceRole,
    };
    discoveryCache = { expiresAt: Date.now() + DISCOVERY_CACHE_TTL_MS, result, cacheKey };
    return result;
  }

  throw new SupabaseConfigError(
    "Could not discover tables via the Data API. Set SUPABASE_TABLES=table1,table2 in .env.local and restart, or ensure the service role key can read the OpenAPI schema.",
    502,
  );
}

export async function assertAllowedTable(table: string): Promise<string> {
  if (!isValidTableName(table)) {
    throw new SupabaseConfigError("Invalid table name.", 400);
  }
  const { tables } = await discoverTables();
  if (!tables.includes(table)) {
    throw new SupabaseConfigError("Table is not in the allowed set.", 403);
  }
  return table;
}

export function resolveSupabaseError(error: unknown): { status: number; message: string } {
  if (error instanceof MissingEnvError) {
    return { status: 503, message: error.message };
  }
  if (error instanceof SupabaseConfigError) {
    return { status: error.status, message: error.message };
  }
  if (error && typeof error === "object" && "message" in error) {
    const message = String((error as { message: unknown }).message);
    if (message.length > 0) return { status: 502, message };
  }
  return { status: 500, message: "Supabase request failed." };
}
