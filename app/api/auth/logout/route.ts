import { NextResponse } from "next/server";
import { logSessionActivity } from "@/lib/activity-log";
import { SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth";
import { assertSameOrigin } from "@/lib/csrf";
import { getSession } from "@/lib/require-session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  // Logout only clears this request's session cookie (idempotent). Tolerate missing
  // Origin/Referer so pagehide sendBeacon / keepalive fetch can succeed; still reject
  // explicit cross-origin Origin/Referer mismatches.
  const forbidden = assertSameOrigin(request);
  if (forbidden) {
    const origin = request.headers.get("origin");
    const referer = request.headers.get("referer");
    if (origin || referer) return forbidden;
  }

  const session = await getSession();
  await logSessionActivity(session, "logout", {
    summary: "Signed out",
    path: "/api/auth/logout",
  });

  const response = NextResponse.json({ ok: true as const });
  response.cookies.set(SESSION_COOKIE, "", sessionCookieOptions(0));
  return response;
}
