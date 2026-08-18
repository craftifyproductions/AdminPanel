import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const ENV_KEYS = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
  "R2_PUBLIC_URL",
  "ADMIN_PASSWORD",
  "AUTH_SECRET",
  "OPENROUTER_API_KEY",
  "OPENROUTER_MODEL_ID",
  "OPENROUTER_IMAGE_MODEL_ID",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_TABLES",
] as const;

export type EnvKey = (typeof ENV_KEYS)[number];

const OPENROUTER_MODEL_ID_MAX = 200;
const OPENROUTER_MODEL_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9/_.-]*$/;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export class EnvConfigError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "EnvConfigError";
    this.status = status;
  }
}

type EnvSpec = {
  key: EnvKey;
  required: boolean;
  secret: boolean;
  label: string;
  description: string;
};

export const ENV_SPEC: readonly EnvSpec[] = [
  {
    key: "R2_ACCOUNT_ID",
    required: true,
    secret: false,
    label: "Account ID",
    description: "Cloudflare account ID used to build the R2 S3 endpoint.",
  },
  {
    key: "R2_ACCESS_KEY_ID",
    required: true,
    secret: false,
    label: "Access key ID",
    description: "R2 API token access key ID.",
  },
  {
    key: "R2_SECRET_ACCESS_KEY",
    required: true,
    secret: true,
    label: "Secret access key",
    description: "R2 API token secret. Never leaves the server.",
  },
  {
    key: "R2_BUCKET_NAME",
    required: true,
    secret: false,
    label: "Bucket name",
    description: "Bucket this panel manages.",
  },
  {
    key: "R2_PUBLIC_URL",
    required: false,
    secret: false,
    label: "Public URL",
    description: "Optional public base URL used to build object links.",
  },
  {
    key: "ADMIN_PASSWORD",
    required: false,
    secret: true,
    label: "Admin password (legacy)",
    description:
      "Emergency password login only when ALLOW_LEGACY_ADMIN_LOGIN=true and Supabase Auth is unset. Prefer Supabase email/password.",
  },
  {
    key: "AUTH_SECRET",
    required: true,
    secret: true,
    label: "Auth secret",
    description: "HMAC key for signing the session cookie.",
  },
  {
    key: "OPENROUTER_API_KEY",
    required: false,
    secret: true,
    label: "OpenRouter API key",
    description: "API key from openrouter.ai. Optional; not required for R2 or login.",
  },
  {
    key: "OPENROUTER_MODEL_ID",
    required: false,
    secret: false,
    label: "Chat model ID",
    description: "OpenRouter chat model id, e.g. openai/gpt-4o-mini.",
  },
  {
    key: "OPENROUTER_IMAGE_MODEL_ID",
    required: false,
    secret: false,
    label: "Image model ID",
    description: "OpenRouter vision/image model id used when chat messages include images.",
  },
  {
    key: "SUPABASE_URL",
    required: false,
    secret: false,
    label: "Supabase URL",
    description: "Supabase project URL (https://xxxx.supabase.co). Required for Auth login and data browse.",
  },
  {
    key: "SUPABASE_ANON_KEY",
    required: false,
    secret: true,
    label: "Supabase anon key",
    description:
      "Anon key used server-side for signInWithPassword (email/password login). Also optional RLS-limited data fallback.",
  },
  {
    key: "SUPABASE_SERVICE_ROLE_KEY",
    required: false,
    secret: true,
    label: "Supabase service role key",
    description:
      "Service role key — server only for admin data browse and activity logs. Never sent to the browser.",
  },
  {
    key: "SUPABASE_TABLES",
    required: false,
    secret: false,
    label: "Supabase table allowlist",
    description: "Comma-separated public tables used when schema introspection fails.",
  },
];

export const REQUIRED_ENV_KEYS: readonly EnvKey[] = ENV_SPEC.filter((spec) => spec.required).map(
  (spec) => spec.key,
);

export class MissingEnvError extends Error {
  readonly missing: readonly EnvKey[];

  constructor(missing: readonly EnvKey[]) {
    const list = missing.join(", ");
    super(
      `Missing required environment variable${missing.length > 1 ? "s" : ""}: ${list}. ` +
        `Add ${missing.length > 1 ? "them" : "it"} to .env.local (see .env.example) and restart the dev server.`,
    );
    this.name = "MissingEnvError";
    this.missing = missing;
  }
}

function assertServer(): void {
  if (typeof window !== "undefined") {
    throw new Error("lib/env.ts is server-only and must not be imported into client code.");
  }
}

function rawEnv(key: EnvKey): string | undefined {
  switch (key) {
    case "R2_ACCOUNT_ID":
      return process.env.R2_ACCOUNT_ID;
    case "R2_ACCESS_KEY_ID":
      return process.env.R2_ACCESS_KEY_ID;
    case "R2_SECRET_ACCESS_KEY":
      return process.env.R2_SECRET_ACCESS_KEY;
    case "R2_BUCKET_NAME":
      return process.env.R2_BUCKET_NAME;
    case "R2_PUBLIC_URL":
      return process.env.R2_PUBLIC_URL;
    case "ADMIN_PASSWORD":
      return process.env.ADMIN_PASSWORD;
    case "AUTH_SECRET":
      return process.env.AUTH_SECRET;
    case "OPENROUTER_API_KEY":
      return process.env.OPENROUTER_API_KEY;
    case "OPENROUTER_MODEL_ID":
      return process.env.OPENROUTER_MODEL_ID;
    case "OPENROUTER_IMAGE_MODEL_ID":
      return process.env.OPENROUTER_IMAGE_MODEL_ID;
    case "SUPABASE_URL":
      return process.env.SUPABASE_URL;
    case "SUPABASE_ANON_KEY":
      return process.env.SUPABASE_ANON_KEY;
    case "SUPABASE_SERVICE_ROLE_KEY":
      return process.env.SUPABASE_SERVICE_ROLE_KEY;
    case "SUPABASE_TABLES":
      return process.env.SUPABASE_TABLES;
  }
}

function read(key: EnvKey): string {
  assertServer();
  const raw = rawEnv(key);
  return typeof raw === "string" ? raw.trim() : "";
}

export function requireEnv(key: EnvKey): string {
  const value = read(key);
  if (!value) throw new MissingEnvError([key]);
  return value;
}

export function optionalEnv(key: EnvKey): string | null {
  return read(key) || null;
}

export function assertEnv(keys: readonly EnvKey[] = REQUIRED_ENV_KEYS): void {
  const missing = keys.filter((key) => !read(key));
  if (missing.length > 0) throw new MissingEnvError(missing);
}

export type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  endpoint: string;
  publicUrl: string | null;
};

export function getR2Config(): R2Config {
  assertEnv(["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"]);
  const accountId = requireEnv("R2_ACCOUNT_ID");
  return {
    accountId,
    accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
    secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
    bucket: requireEnv("R2_BUCKET_NAME"),
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    publicUrl: optionalEnv("R2_PUBLIC_URL")?.replace(/\/+$/, "") ?? null,
  };
}

export type EnvVarStatus = {
  key: EnvKey;
  label: string;
  description: string;
  required: boolean;
  secret: boolean;
  isSet: boolean;
  masked: string | null;
};

function maskValue(value: string, secret: boolean): string {
  if (secret) return "•".repeat(12);
  if (value.length <= 6) return `${value.slice(0, 1)}${"•".repeat(Math.max(value.length - 1, 1))}`;
  return `${value.slice(0, 4)}${"•".repeat(8)}${value.slice(-3)}`;
}

export function getEnvStatus(): EnvVarStatus[] {
  return ENV_SPEC.map((spec) => {
    const value = read(spec.key);
    return {
      key: spec.key,
      label: spec.label,
      description: spec.description,
      required: spec.required,
      secret: spec.secret,
      isSet: value.length > 0,
      masked: value
        ? spec.key === "SUPABASE_URL"
          ? value
          : maskValue(value, spec.secret)
        : null,
    };
  });
}

export async function upsertEnvLocalKey(key: string, value: string): Promise<void> {
  assertServer();
  if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
    throw new EnvConfigError("Invalid environment variable name.", 400);
  }
  if (CONTROL_CHARS.test(value) || value.includes("\n") || value.includes("\r")) {
    throw new EnvConfigError("Environment value must not contain control characters.", 400);
  }

  const envPath = path.join(process.cwd(), ".env.local");
  let content = "";
  try {
    content = await readFile(envPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const line = `${key}=${value}`;
  const keyPattern = new RegExp(`^${key}=.*$`, "m");
  if (keyPattern.test(content)) {
    content = content.replace(keyPattern, line);
  } else if (content.length === 0 || content.endsWith("\n")) {
    content = `${content}${line}\n`;
  } else {
    content = `${content}\n${line}\n`;
  }

  await writeFile(envPath, content, "utf8");
}

export function validateOpenRouterModelId(raw: string): string {
  assertServer();
  if (typeof raw !== "string") {
    throw new EnvConfigError("Model ID must be a string.", 400);
  }
  const modelId = raw.trim();
  if (modelId.length === 0) return "";
  if (modelId.length > OPENROUTER_MODEL_ID_MAX) {
    throw new EnvConfigError(
      `Model ID must be at most ${OPENROUTER_MODEL_ID_MAX} characters.`,
      400,
    );
  }
  if (CONTROL_CHARS.test(modelId)) {
    throw new EnvConfigError("Model ID must not contain control characters.", 400);
  }
  if (!OPENROUTER_MODEL_ID_PATTERN.test(modelId)) {
    throw new EnvConfigError(
      "Model ID may only use letters, digits, and / - _ . (e.g. openai/gpt-4o-mini).",
      400,
    );
  }
  return modelId;
}

export async function setOpenRouterModelId(raw: string): Promise<string> {
  const modelId = validateOpenRouterModelId(raw);
  await upsertEnvLocalKey("OPENROUTER_MODEL_ID", modelId);
  process.env.OPENROUTER_MODEL_ID = modelId;
  return modelId;
}

export async function setOpenRouterImageModelId(raw: string): Promise<string> {
  const modelId = validateOpenRouterModelId(raw);
  await upsertEnvLocalKey("OPENROUTER_IMAGE_MODEL_ID", modelId);
  process.env.OPENROUTER_IMAGE_MODEL_ID = modelId;
  return modelId;
}
