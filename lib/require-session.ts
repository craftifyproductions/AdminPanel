import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, type SessionPayload, verifySessionToken } from "@/lib/auth";
import type { ApiError } from "@/lib/types";

export async function getSession(): Promise<SessionPayload | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return verifySessionToken(token);
}

export async function requireSession(): Promise<NextResponse<ApiError> | null> {
  const session = await getSession();
  if (session) return null;
  return NextResponse.json<ApiError>({ error: "Unauthorized" }, { status: 401 });
}

export async function requireSessionUser(): Promise<
  { session: SessionPayload; error?: undefined } | { session?: undefined; error: NextResponse<ApiError> }
> {
  const session = await getSession();
  if (session) return { session };
  return { error: NextResponse.json<ApiError>({ error: "Unauthorized" }, { status: 401 }) };
}
