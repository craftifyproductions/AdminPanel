import { NextResponse } from "next/server";
import { logRequestActivity } from "@/lib/activity-log";
import { assertSameOrigin } from "@/lib/csrf";
import { getR2Config } from "@/lib/env";
import { requireSession } from "@/lib/require-session";
import {
  R2Error,
  createBucket,
  deleteBucket,
  listBuckets,
  resolveR2Error,
  switchBucket,
} from "@/lib/r2";
import type { ApiError, BucketsResponse } from "@/lib/types";

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

async function guard(request: Request) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;
  return assertSameOrigin(request);
}

export async function GET() {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  try {
    const buckets = await listBuckets();
    const active = getR2Config().bucket;
    return NextResponse.json<BucketsResponse>({ buckets, active });
  } catch (error) {
    const { status, message } = resolveR2Error(error);
    if (status >= 500) console.error("[api/r2/bucket] GET failed", error);
    return NextResponse.json<ApiError>({ error: message }, { status });
  }
}

export async function PUT(request: Request) {
  const denied = await guard(request);
  if (denied) return denied;

  try {
    const body = await readBody(request);
    const name = readString(body, "name");
    const bucket = await switchBucket(name);
    await logRequestActivity(request, "r2.bucket.switch", {
      summary: `Switched active bucket to ${bucket}`,
      metadata: { bucket },
    });
    return NextResponse.json({ ok: true as const, bucket });
  } catch (error) {
    const { status, message } = resolveR2Error(error);
    if (status >= 500) console.error("[api/r2/bucket] PUT failed", error);
    return NextResponse.json<ApiError>({ error: message }, { status });
  }
}

export async function POST(request: Request) {
  const denied = await guard(request);
  if (denied) return denied;

  try {
    const body = await readBody(request);
    const name = readString(body, "name");
    const bucket = await createBucket(name);
    await logRequestActivity(request, "r2.bucket.create", {
      summary: `Created bucket ${bucket}`,
      metadata: { bucket },
    });
    return NextResponse.json({ ok: true as const, bucket });
  } catch (error) {
    const { status, message } = resolveR2Error(error);
    if (status >= 500) console.error("[api/r2/bucket] POST failed", error);
    return NextResponse.json<ApiError>({ error: message }, { status });
  }
}

export async function DELETE(request: Request) {
  const denied = await guard(request);
  if (denied) return denied;

  try {
    const body = await readBody(request);
    const name = readString(body, "name");
    await deleteBucket(name);
    await logRequestActivity(request, "r2.bucket.delete", {
      summary: `Deleted bucket ${name}`,
      metadata: { bucket: name },
    });
    return NextResponse.json({ ok: true as const });
  } catch (error) {
    const { status, message } = resolveR2Error(error);
    if (status >= 500) console.error("[api/r2/bucket] DELETE failed", error);
    return NextResponse.json<ApiError>({ error: message }, { status });
  }
}
