const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

type Entry = { count: number; resetAt: number };

const failuresByIp = new Map<string, Entry>();

export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  return "local";
}

export function isLoginRateLimited(ip: string): boolean {
  const entry = failuresByIp.get(ip);
  if (!entry) return false;
  if (Date.now() >= entry.resetAt) {
    failuresByIp.delete(ip);
    return false;
  }
  return entry.count >= MAX_FAILURES;
}

export function recordLoginFailure(ip: string): void {
  const now = Date.now();
  const entry = failuresByIp.get(ip);
  if (!entry || now >= entry.resetAt) {
    failuresByIp.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  entry.count += 1;
}

export function clearLoginFailures(ip: string): void {
  failuresByIp.delete(ip);
}
