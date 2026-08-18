import { clientIp } from "@/lib/login-rate-limit";

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 24;

type Entry = { count: number; resetAt: number };

const hitsByIp = new Map<string, Entry>();

export { clientIp };

export function isChatRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = hitsByIp.get(ip);
  if (!entry || now >= entry.resetAt) {
    hitsByIp.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_REQUESTS;
}
