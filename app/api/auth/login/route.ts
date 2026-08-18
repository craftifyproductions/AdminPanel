import { createHash, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { logActivity } from "@/lib/activity-log";
import {
  SESSION_COOKIE,
  createSessionToken,
  sessionCookieOptions,
} from "@/lib/auth";
import { optionalEnv, requireEnv } from "@/lib/env";
import {
  clearLoginFailures,
  clientIp,
  isLoginRateLimited,
  recordLoginFailure,
} from "@/lib/login-rate-limit";
import type { ApiError } from "@/lib/types";

export const runtime = "nodejs";

const LEGACY_ADMIN_SUB = "00000000-0000-4000-8000-000000000001";
const LEGACY_ADMIN_EMAIL = "admin@local";

type LoginBody = {
  email?: unknown;
  password?: unknown;
};

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function matchesPassword(submitted: string, expected: string): boolean {
  return timingSafeEqual(digest(submitted), digest(expected));
}

function isSupabaseAuthConfigured(): boolean {
  return Boolean(optionalEnv("SUPABASE_URL") && optionalEnv("SUPABASE_ANON_KEY"));
}

function legacyLoginAllowed(): boolean {
  return process.env.ALLOW_LEGACY_ADMIN_LOGIN === "true";
}

async function readBody(request: Request): Promise<LoginBody | null> {
  try {
    const body: unknown = await request.json();
    if (typeof body !== "object" || body === null) return null;
    return body as LoginBody;
  } catch {
    return null;
  }
}

async function issueSession(response: NextResponse, sub: string, email: string) {
  response.cookies.set(
    SESSION_COOKIE,
    await createSessionToken({ sub, email }),
    sessionCookieOptions(),
  );
}

export async function POST(request: Request) {
  const ip = clientIp(request);
  if (isLoginRateLimited(ip)) {
    return NextResponse.json<ApiError>(
      { error: "Too many attempts. Try again later." },
      { status: 429 },
    );
  }

  try {
    requireEnv("AUTH_SECRET");
  } catch {
    return NextResponse.json<ApiError>({ error: "Unable to sign in." }, { status: 500 });
  }

  const body = await readBody(request);
  const password = typeof body?.password === "string" ? body.password : null;
  const emailRaw = typeof body?.email === "string" ? body.email.trim() : "";

  if (!password) {
    return NextResponse.json<ApiError>({ error: "Password is required." }, { status: 400 });
  }

  if (isSupabaseAuthConfigured()) {
    if (!emailRaw) {
      return NextResponse.json<ApiError>({ error: "Email is required." }, { status: 400 });
    }

    const url = optionalEnv("SUPABASE_URL")!;
    const anon = optionalEnv("SUPABASE_ANON_KEY")!;
    const supabase = createClient(url, anon, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });

    const { data, error } = await supabase.auth.signInWithPassword({
      email: emailRaw,
      password,
    });

    if (error || !data.user) {
      recordLoginFailure(ip);
      return NextResponse.json<ApiError>(
        { error: "Invalid email or password" },
        { status: 401 },
      );
    }

    const userEmail = data.user.email?.trim() || emailRaw;
    clearLoginFailures(ip);

    const response = NextResponse.json({ ok: true as const, email: userEmail });
    await issueSession(response, data.user.id, userEmail);
    await logActivity({
      userId: data.user.id,
      email: userEmail,
      action: "login",
      summary: "Signed in with Supabase Auth",
      path: "/api/auth/login",
      metadata: { method: "supabase" },
    });
    return response;
  }

  if (!legacyLoginAllowed()) {
    return NextResponse.json<ApiError>({ error: "Unable to sign in." }, { status: 503 });
  }

  let expectedPassword: string;
  try {
    expectedPassword = requireEnv("ADMIN_PASSWORD");
  } catch {
    return NextResponse.json<ApiError>({ error: "Unable to sign in." }, { status: 500 });
  }

  if (!matchesPassword(password, expectedPassword)) {
    recordLoginFailure(ip);
    return NextResponse.json<ApiError>({ error: "Invalid email or password" }, { status: 401 });
  }

  clearLoginFailures(ip);
  const response = NextResponse.json({ ok: true as const, email: LEGACY_ADMIN_EMAIL });
  await issueSession(response, LEGACY_ADMIN_SUB, LEGACY_ADMIN_EMAIL);
  await logActivity({
    userId: LEGACY_ADMIN_SUB,
    email: LEGACY_ADMIN_EMAIL,
    action: "login",
    summary: "Signed in with legacy admin password",
    path: "/api/auth/login",
    metadata: { method: "legacy" },
  });
  return response;
}
