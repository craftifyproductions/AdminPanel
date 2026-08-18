import { HardDrive } from "lucide-react";
import type { Metadata } from "next";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = {
  title: "Sign in · Craftify AI Admin Panel",
};

function safeNextPath(value: string | string[] | undefined): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (typeof candidate !== "string" || candidate.length === 0) return "/";
  if (candidate.includes("\\")) return "/";
  if (!candidate.startsWith("/") || candidate.startsWith("//")) return "/";
  if (!/^\/[A-Za-z0-9._~!$&'()*+,;=:@/?%-]*$/.test(candidate)) return "/";

  let decoded: string;
  try {
    decoded = decodeURIComponent(candidate);
  } catch {
    return "/";
  }
  if (decoded.includes("\\") || !decoded.startsWith("/") || decoded.startsWith("//")) {
    return "/";
  }
  if (decoded.includes("://")) return "/";
  return candidate;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  return (
    <main className="login-shell">
      <div aria-hidden className="login-bg">
        <div className="login-bg-base" />
        <div className="login-bg-grid" />
        <div className="login-bg-orb login-bg-orb-a" />
        <div className="login-bg-orb login-bg-orb-b" />
        <div className="login-bg-noise" />
      </div>

      <div className="login-stage">
        <div className="login-card">
          <header className="login-brand">
            <span className="login-brand-mark">
              <HardDrive aria-hidden className="size-4" />
            </span>
            <h1 className="login-brand-title">Craftify AI Admin Panel</h1>
          </header>

          <LoginForm nextPath={safeNextPath(params.next)} />
        </div>
      </div>
    </main>
  );
}
