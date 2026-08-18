import { NextResponse } from "next/server";
import { logRequestActivity } from "@/lib/activity-log";
import { assertSameOrigin } from "@/lib/csrf";
import { requireSession } from "@/lib/require-session";
import { R2Error, createFolder, deleteFolder, renameFolder, resolveR2Error } from "@/lib/r2";
import type { ApiError } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = Record<string, unknown>;

async function readBody(request: Request): Promise<Body> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    throw new R2Error("Request body must be JSON.", 400);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new R2Error("Request body must be a JSON object.", 400);
  }
  return parsed as Body;
}

function readString(body: Body, field: string): string {
  const value = body[field];
  if (typeof value !== "string") throw new R2Error(`"${field}" is required.`, 400);
  return value;
}

function readOptionalString(body: Body, field: string): string {
  const value = body[field];
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new R2Error(`"${field}" must be a string.`, 400);
  return value;
}

function failure(route: string, error: unknown) {
  const { status, message } = resolveR2Error(error);
  if (status >= 500) console.error(`[api/r2/folder] ${route} failed`, error);
  return NextResponse.json<ApiError>({ error: message }, { status });
}

async function guard(request: Request) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;
  return assertSameOrigin(request);
}

export async function POST(request: Request) {
  const denied = await guard(request);
  if (denied) return denied;

  try {
    const body = await readBody(request);
    const name = readString(body, "name");
    const prefix = await createFolder(readOptionalString(body, "parentPrefix"), name);
    await logRequestActivity(request, "r2.folder.create", {
      summary: `Created folder ${name}`,
      metadata: { prefix },
    });
    return NextResponse.json({ ok: true as const, prefix });
  } catch (error) {
    return failure("POST", error);
  }
}

export async function PATCH(request: Request) {
  const denied = await guard(request);
  if (denied) return denied;

  try {
    const body = await readBody(request);
    const prefix = readString(body, "prefix");
    const newName = readString(body, "newName");
    const result = await renameFolder(prefix, newName);
    await logRequestActivity(request, "r2.folder.rename", {
      summary: `Renamed folder to ${newName}`,
      metadata: { from: prefix, to: result.prefix, moved: result.moved },
    });
    return NextResponse.json({ ok: true as const, prefix: result.prefix, moved: result.moved });
  } catch (error) {
    return failure("PATCH", error);
  }
}

export async function DELETE(request: Request) {
  const denied = await guard(request);
  if (denied) return denied;

  try {
    const body = await readBody(request);
    const prefix = readString(body, "prefix");
    const deleted = await deleteFolder(prefix);
    await logRequestActivity(request, "r2.folder.delete", {
      summary: `Deleted folder ${prefix}`,
      metadata: { prefix, deleted },
    });
    return NextResponse.json({ ok: true as const, deleted });
  } catch (error) {
    return failure("DELETE", error);
  }
}
