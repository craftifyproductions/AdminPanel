import { optionalEnv } from "@/lib/env";
import {
  MAX_TEXT_BYTES,
  R2Error,
  deleteObject,
  getObject,
  getObjectMeta,
  getStats,
  listBuckets,
  listLevel,
  normalizePrefix,
  putObjectText,
  renameObject,
  resolveR2Error,
  switchBucket,
} from "@/lib/r2";
import type { ChatMessage } from "@/lib/chat/types";

export const MAX_TOOL_STEPS = 8;

const CONFIRM_RE =
  /^(yes|yep|yeah|confirm(?:ed)?|go ahead|do it|proceed|approved|ok(?:ay)?)([,!]?\s+.*)?$/i;

export type ToolContext = {
  messages: ChatMessage[];
  apiKey: string;
  chatModelId: string;
  imageModelId: string | null;
  emitStatus?: (detail: string) => void;
};

type ToolDef = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  destructive?: boolean;
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
};

function asString(args: Record<string, unknown>, key: string, required = true): string {
  const value = args[key];
  if (typeof value === "string") return value;
  if (!required) return "";
  throw new R2Error(`"${key}" must be a string.`, 400);
}

function asBoolean(args: Record<string, unknown>, key: string): boolean {
  return args[key] === true;
}

function lastUserText(messages: ChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role !== "user") continue;
    if (typeof message.content === "string") return message.content;
    if (Array.isArray(message.content)) {
      return message.content
        .filter((part): part is { type: "text"; text: string } => part.type === "text")
        .map((part) => part.text)
        .join("\n");
    }
  }
  return "";
}

function userConfirmed(messages: ChatMessage[]): boolean {
  const text = lastUserText(messages).trim();
  if (!text || text.length > 120) return false;
  return CONFIRM_RE.test(text);
}

function needsConfirmation(action: string): Record<string, unknown> {
  return {
    ok: false,
    needsConfirmation: true,
    message: `This action (${action}) needs an explicit yes/confirm from the user in chat, then call again with confirmed=true.`,
  };
}

async function readObjectText(key: string): Promise<{ key: string; content: string; bytes: number }> {
  const object = await getObject(key);
  if (object.size > MAX_TEXT_BYTES) {
    throw new R2Error("Text content cannot be larger than 2 MiB.", 413);
  }

  const reader = object.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_TEXT_BYTES) {
      throw new R2Error("Text content cannot be larger than 2 MiB.", 413);
    }
    chunks.push(value);
  }

  const content = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
  return { key: object.key, content, bytes: total };
}

async function generateImageViaOpenRouter(
  prompt: string,
  ctx: ToolContext,
): Promise<Record<string, unknown>> {
  const model = ctx.imageModelId || ctx.chatModelId;
  if (!model) {
    return {
      ok: false,
      message:
        "Image generation is not configured. Set OPENROUTER_IMAGE_MODEL_ID (or OPENROUTER_MODEL_ID) in Settings.",
    };
  }

  ctx.emitStatus?.("generating_image");

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ctx.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://localhost/craftify-ai-admin-panel",
      "X-Title": "Craftify AI Admin Panel Chat",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      modalities: ["image", "text"],
    }),
  });

  const raw = await response.text();
  let body: unknown = null;
  try {
    body = raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    body = null;
  }

  if (!response.ok) {
    const err =
      typeof body === "object" &&
      body !== null &&
      typeof (body as { error?: { message?: unknown } }).error?.message === "string"
        ? (body as { error: { message: string } }).error.message
        : `OpenRouter image request failed (${response.status}).`;
    return {
      ok: false,
      message: `Image generation failed: ${err}. This model may not support image output — pick an image-capable model ID in Settings.`,
    };
  }

  const message = (body as { choices?: Array<{ message?: Record<string, unknown> }> })?.choices?.[0]
    ?.message;
  const images = message?.images;
  if (Array.isArray(images) && images.length > 0) {
    const first = images[0] as { image_url?: { url?: string }; url?: string };
    const url = first.image_url?.url ?? first.url;
    if (typeof url === "string" && url.length > 0) {
      return { ok: true, imageUrl: url, model };
    }
  }

  const content = message?.content;
  if (typeof content === "string" && content.startsWith("data:image/")) {
    return { ok: true, imageUrl: content, model };
  }

  return {
    ok: false,
    message:
      "The model responded but did not return an image. Choose an OpenRouter model that supports image generation, or attach images for vision instead.",
  };
}

const TOOLS: ToolDef[] = [
  {
    name: "list_folder",
    description: "List folders and files at an R2 prefix. Use empty string or omit for bucket root.",
    parameters: {
      type: "object",
      properties: {
        prefix: {
          type: "string",
          description: 'Folder prefix ending with "/", or empty for root.',
        },
      },
    },
    async execute(args) {
      const raw = asString(args, "prefix", false);
      const prefix = raw ? normalizePrefix(raw.endsWith("/") ? raw : `${raw}/`) : "";
      const listing = await listLevel(prefix);
      return {
        ok: true,
        prefix: listing.prefix,
        folders: listing.folders.slice(0, 200),
        files: listing.files.slice(0, 200).map((file) => ({
          name: file.name,
          key: file.key,
          size: file.size,
          lastModified: file.lastModified,
        })),
        truncated: listing.folders.length > 200 || listing.files.length > 200,
      };
    },
  },
  {
    name: "get_object_text",
    description: "Read a text object from R2 by key (max 2 MiB).",
    parameters: {
      type: "object",
      properties: {
        key: { type: "string", description: "Full object key." },
      },
      required: ["key"],
    },
    async execute(args) {
      const key = asString(args, "key");
      const result = await readObjectText(key);
      const previewLimit = 80_000;
      const truncated = result.content.length > previewLimit;
      return {
        ok: true,
        key: result.key,
        bytes: result.bytes,
        truncated,
        content: truncated ? result.content.slice(0, previewLimit) : result.content,
      };
    },
  },
  {
    name: "put_object_text",
    description:
      "Create or overwrite a text object in R2. Overwrites require confirmed=true after the user says yes.",
    destructive: true,
    parameters: {
      type: "object",
      properties: {
        key: { type: "string" },
        content: { type: "string" },
        contentType: { type: "string" },
        confirmed: { type: "boolean" },
      },
      required: ["key", "content"],
    },
    async execute(args, ctx) {
      const key = asString(args, "key");
      const content = asString(args, "content");
      const contentType = asString(args, "contentType", false) || undefined;
      const confirmed = asBoolean(args, "confirmed");

      let exists = false;
      try {
        await getObjectMeta(key);
        exists = true;
      } catch (error) {
        if (!(error instanceof R2Error) || error.status !== 404) throw error;
      }

      if (exists && (!confirmed || !userConfirmed(ctx.messages))) {
        return needsConfirmation(`overwrite "${key}"`);
      }

      await putObjectText(key, content, contentType);
      return { ok: true, key, bytes: Buffer.byteLength(content, "utf8"), overwritten: exists };
    },
  },
  {
    name: "rename_object",
    description: "Rename a file in its current folder. Requires confirmed=true after user yes.",
    destructive: true,
    parameters: {
      type: "object",
      properties: {
        key: { type: "string" },
        newName: { type: "string", description: "New file name without path separators." },
        confirmed: { type: "boolean" },
      },
      required: ["key", "newName"],
    },
    async execute(args, ctx) {
      if (!asBoolean(args, "confirmed") || !userConfirmed(ctx.messages)) {
        return needsConfirmation(`rename "${asString(args, "key")}"`);
      }
      const next = await renameObject(asString(args, "key"), asString(args, "newName"));
      return { ok: true, key: next };
    },
  },
  {
    name: "delete_object",
    description: "Delete a file from R2. Requires confirmed=true after user yes.",
    destructive: true,
    parameters: {
      type: "object",
      properties: {
        key: { type: "string" },
        confirmed: { type: "boolean" },
      },
      required: ["key"],
    },
    async execute(args, ctx) {
      const key = asString(args, "key");
      if (!asBoolean(args, "confirmed") || !userConfirmed(ctx.messages)) {
        return needsConfirmation(`delete "${key}"`);
      }
      await deleteObject(key);
      return { ok: true, deleted: key };
    },
  },
  {
    name: "get_stats",
    description: "Get active bucket connection stats (object count and total size when available).",
    parameters: {
      type: "object",
      properties: {
        fresh: { type: "boolean", description: "Bypass short-lived cache." },
      },
    },
    async execute(args) {
      const stats = await getStats({ fresh: args.fresh === true });
      return { ok: true, ...stats };
    },
  },
  {
    name: "list_buckets",
    description: "List R2 buckets visible to the configured credentials.",
    parameters: { type: "object", properties: {} },
    async execute() {
      const buckets = await listBuckets();
      return {
        ok: true,
        activeBucket: optionalEnv("R2_BUCKET_NAME"),
        buckets,
      };
    },
  },
  {
    name: "switch_bucket",
    description:
      "Switch the active panel bucket (writes R2_BUCKET_NAME). Requires confirmed=true after user yes.",
    destructive: true,
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        confirmed: { type: "boolean" },
      },
      required: ["name"],
    },
    async execute(args, ctx) {
      const name = asString(args, "name");
      if (!asBoolean(args, "confirmed") || !userConfirmed(ctx.messages)) {
        return needsConfirmation(`switch active bucket to "${name}"`);
      }
      const active = await switchBucket(name);
      return { ok: true, bucket: active };
    },
  },
  {
    name: "get_settings_overview",
    description:
      "Summarize which env keys are set (secrets masked). Does not return secret values.",
    parameters: { type: "object", properties: {} },
    async execute() {
      const { getEnvStatus } = await import("@/lib/env");
      return {
        ok: true,
        variables: getEnvStatus().map((entry) => ({
          key: entry.key,
          label: entry.label,
          required: entry.required,
          isSet: entry.isSet,
          masked: entry.masked,
          description: entry.description,
        })),
      };
    },
  },
  {
    name: "generate_image",
    description: "Generate an image via OpenRouter when the user asks for image generation.",
    parameters: {
      type: "object",
      properties: {
        prompt: { type: "string" },
      },
      required: ["prompt"],
    },
    async execute(args, ctx) {
      return generateImageViaOpenRouter(asString(args, "prompt"), ctx);
    },
  },
];

export function openRouterToolDefinitions() {
  return TOOLS.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

export async function executeChatTool(
  name: string,
  rawArgs: string,
  ctx: ToolContext,
): Promise<string> {
  const tool = TOOLS.find((entry) => entry.name === name);
  if (!tool) {
    return JSON.stringify({ ok: false, message: `Unknown tool: ${name}` });
  }

  let args: Record<string, unknown> = {};
  try {
    const parsed = rawArgs ? (JSON.parse(rawArgs) as unknown) : {};
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      args = parsed as Record<string, unknown>;
    }
  } catch {
    return JSON.stringify({ ok: false, message: "Tool arguments were not valid JSON." });
  }

  try {
    const result = await tool.execute(args, ctx);
    return JSON.stringify(result);
  } catch (error) {
    const { message } = resolveR2Error(error);
    return JSON.stringify({ ok: false, message });
  }
}
