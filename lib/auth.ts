import { requireEnv } from "@/lib/env";

export const SESSION_COOKIE = "r2_admin_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24;

export type SessionPayload = {
  sub: string;
  email: string;
  iat: number;
  exp: number;
};

export type CreateSessionOptions = {
  sub: string;
  email: string;
  nowMs?: number;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): ArrayBuffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  const binary = atob(padded);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return buffer;
}

async function importSigningKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(requireEnv("AUTH_SECRET")),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function isSessionPayload(value: unknown): value is SessionPayload {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.sub === "string" &&
    candidate.sub.length > 0 &&
    typeof candidate.email === "string" &&
    candidate.email.length > 0 &&
    typeof candidate.iat === "number" &&
    typeof candidate.exp === "number"
  );
}

export async function createSessionToken(options: CreateSessionOptions): Promise<string> {
  const issuedAt = Math.floor((options.nowMs ?? Date.now()) / 1000);
  const payload: SessionPayload = {
    sub: options.sub,
    email: options.email,
    iat: issuedAt,
    exp: issuedAt + SESSION_MAX_AGE_SECONDS,
  };
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const key = await importSigningKey();
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return `${body}.${toBase64Url(new Uint8Array(signature))}`;
}

export async function verifySessionToken(
  token: string | undefined | null,
  nowMs: number = Date.now(),
): Promise<SessionPayload | null> {
  if (!token) return null;
  const separator = token.lastIndexOf(".");
  if (separator <= 0 || separator === token.length - 1) return null;

  const body = token.slice(0, separator);
  const signature = token.slice(separator + 1);

  try {
    const key = await importSigningKey();
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      fromBase64Url(signature),
      encoder.encode(body),
    );
    if (!valid) return null;

    const payload: unknown = JSON.parse(decoder.decode(fromBase64Url(body)));
    if (!isSessionPayload(payload)) return null;
    if (payload.exp * 1000 <= nowMs) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Omit `maxAge` for a browser session cookie; pass `0` to clear. */
export function sessionCookieOptions(maxAge?: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    ...(typeof maxAge === "number" ? { maxAge } : {}),
  };
}
