"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

function clientLoginError(status: number): string {
  if (status === 429) return "Too many attempts. Try again later.";
  if (status === 401 || status === 400) return "Invalid email or password.";
  return "Unable to sign in.";
}

export function LoginForm({ nextPath }: { nextPath: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    // Prefer FormData so browser autofill still works even when React state
    // has not caught up with the filled inputs.
    const formData = new FormData(event.currentTarget);
    const emailValue = String(formData.get("email") ?? "").trim();
    const passwordValue = String(formData.get("password") ?? "");

    if (!emailValue || !passwordValue) {
      setError("Email and password are required.");
      return;
    }

    setEmail(emailValue);
    setPassword(passwordValue);
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailValue, password: passwordValue }),
      });

      if (!response.ok) {
        setError(clientLoginError(response.status));
        setSubmitting(false);
        return;
      }

      router.replace(nextPath);
      router.refresh();
    } catch {
      setError("Unable to sign in.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="login-form" noValidate>
      <div className="login-field">
        <label htmlFor="email" className="login-label">
          Email
        </label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          autoFocus
          required
          invalid={error !== null}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="Email"
          className="login-input"
        />
      </div>

      <div className="login-field">
        <label htmlFor="password" className="login-label">
          Password
        </label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          invalid={error !== null}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Password"
          className="login-input"
        />
      </div>

      {error ? (
        <p role="alert" className="login-error">
          {error}
        </p>
      ) : null}

      <Button type="submit" loading={submitting} className="login-submit w-full">
        {submitting ? "Signing in" : "Sign in"}
      </Button>
    </form>
  );
}
