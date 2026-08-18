import { NextResponse } from "next/server";
import { logRequestActivity } from "@/lib/activity-log";
import { assertSameOrigin } from "@/lib/csrf";
import { classifyFile } from "@/lib/file-kind";
import { requireSession } from "@/lib/require-session";
import {
  MAX_ARCHIVE_PREVIEW_BYTES,
  MAX_DOWNLOAD_BYTES,
  MAX_IMAGE_PREVIEW_BYTES,
  MAX_MODEL_PREVIEW_BYTES,
  MAX_TEXT_BYTES,
  R2Error,
  deleteObject,
  deleteObjects,
  getObject,
  getObjectMeta,
  putObjectText,
  renameObject,
  resolveR2Error,
} from "@/lib/r2";
import type { ApiError } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = Record<string, unknown>;

const SAFE_INLINE_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/bmp",
  "image/x-icon",
  "image/vnd.microsoft.icon",
]);

const SAFE_PREVIEW_TYPES = new Set([
  ...SAFE_INLINE_IMAGE_TYPES,
  "text/plain",
  "text/csv",
  "text/tab-separated-values",
  "text/markdown",
  "application/json",
  "application/ld+json",
]);

function baseMime(contentType: string): string {
  return contentType.split(";")[0]?.trim().toLowerCase() ?? "";
}

function sanitizeContentType(contentType: string): string {
  const mime = baseMime(contentType);
  if (!mime) return "application/octet-stream";

  if (
    mime === "text/html" ||
    mime === "application/xhtml+xml" ||
    mime === "image/svg+xml" ||
    mime === "text/javascript" ||
    mime === "application/javascript" ||
    mime === "application/x-javascript" ||
    mime === "text/ecmascript" ||
    mime === "application/ecmascript"
  ) {
    return "application/octet-stream";
  }

  if (SAFE_PREVIEW_TYPES.has(mime)) return mime;
  if (mime.startsWith("image/") && mime !== "image/svg+xml") return mime;
  if (mime === "application/json" || mime.endsWith("+json")) return mime;
  if (mime === "text/plain" || mime === "text/csv") return mime;

  return "application/octet-stream";
}

function isSafeInlineImage(mime: string): boolean {
  return SAFE_INLINE_IMAGE_TYPES.has(mime);
}

async function readBody(request: Request): Promise<Body> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    throw new R2Error("Request body must be JSON.", 400);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new R2Error("Request body must be a JSON object.", 400);
  }
  return parsed as Body;
}

function readString(body: Body, field: string): string {
  const value = body[field];
  if (typeof value !== "string") throw new R2Error(`"${field}" is required.`, 400);
  return value;
}

function failure(route: string, error: unknown) {
  const { status, message } = resolveR2Error(error);
  if (status >= 500) console.error(`[api/r2/object] ${route} failed`, error);
  return NextResponse.json<ApiError>({ error: message }, { status });
}

function attachmentFilename(key: string): string {
  const name = key.includes("/") ? key.slice(key.lastIndexOf("/") + 1) : key;
  const escaped = name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `attachment; filename="${escaped}"`;
}

function previewLimitMessage(kind: "image" | "text" | "model" | "archive" | "binary"): string {
  if (kind === "text") {
    return "This text file is larger than 2 MiB. Download it instead.";
  }
  if (kind === "image") {
    return "This image is larger than 20 MiB. Download it instead.";
  }
  if (kind === "model") {
    return "This model is larger than 20 MiB. Download it instead.";
  }
  if (kind === "archive") {
    return "This zip archive is larger than 50 MiB. Download it instead.";
  }
  return "This file is larger than 100 MiB.";
}

async function guard(request: Request) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;
  return assertSameOrigin(request);
}

export async function GET(request: Request) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  try {
    const url = new URL(request.url);
    const keyParam = url.searchParams.get("key");
    const download = url.searchParams.get("download") === "1";

    const meta = await getObjectMeta(keyParam);
    const kind = classifyFile(meta.key, meta.contentType);

    const maxBytes = download
      ? MAX_DOWNLOAD_BYTES
      : kind === "text"
        ? MAX_TEXT_BYTES
        : kind === "image"
          ? MAX_IMAGE_PREVIEW_BYTES
          : kind === "model"
            ? MAX_MODEL_PREVIEW_BYTES
            : kind === "archive"
              ? MAX_ARCHIVE_PREVIEW_BYTES
              : MAX_DOWNLOAD_BYTES;

    if (meta.size > maxBytes) {
      throw new R2Error(
        download ? "Downloads are limited to 100 MiB." : previewLimitMessage(kind),
        413,
      );
    }

    const object = await getObject(meta.key);
    const rawType = object.contentType || "application/octet-stream";
    const safeType = sanitizeContentType(rawType);
    const headers = new Headers({
      "Content-Type": safeType,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "X-R2-Key": object.key,
      "X-R2-Size": String(object.size),
      "X-R2-Content-Type": object.contentType ?? "",
      "X-R2-Kind": kind,
    });
    if (download) {
      headers.set("Content-Disposition", attachmentFilename(object.key));
    } else if (isSafeInlineImage(safeType)) {
      headers.set("Content-Disposition", "inline");
    }

    return new NextResponse(object.body, { status: 200, headers });
  } catch (error) {
    return failure("GET", error);
  }
}

export async function PUT(request: Request) {
  const denied = await guard(request);
  if (denied) return denied;

  try {
    const body = await readBody(request);
    const key = readString(body, "key");
    const content = readString(body, "content");

    const rawType = body.contentType;
    if (rawType !== undefined && typeof rawType !== "string") {
      throw new R2Error('"contentType" must be a string.', 400);
    }

    await putObjectText(key, content, rawType);
    await logRequestActivity(request, "r2.object.put", {
      summary: `Saved object ${key}`,
      metadata: { key },
    });
    return NextResponse.json({ ok: true as const });
  } catch (error) {
    return failure("PUT", error);
  }
}

export async function PATCH(request: Request) {
  const denied = await guard(request);
  if (denied) return denied;

  try {
    const body = await readBody(request);
    const fromKey = readString(body, "key");
    const newName = readString(body, "newName");
    const key = await renameObject(fromKey, newName);
    await logRequestActivity(request, "r2.object.rename", {
      summary: `Renamed object to ${newName}`,
      metadata: { from: fromKey, to: key },
    });
    return NextResponse.json({ ok: true as const, key });
  } catch (error) {
    return failure("PATCH", error);
  }
}

export async function DELETE(request: Request) {
  const denied = await guard(request);
  if (denied) return denied;

  try {
    const body = await readBody(request);

    if (body.keys !== undefined) {
      if (!Array.isArray(body.keys)) {
        throw new R2Error('"keys" must be an array of strings.', 400);
      }
      if (body.keys.length === 0) {
        throw new R2Error("At least one file key is required.", 400);
      }
      for (const entry of body.keys) {
        if (typeof entry !== "string") {
          throw new R2Error('"keys" must be an array of strings.', 400);
        }
      }

      const deleted = await deleteObjects(body.keys as string[]);
      await logRequestActivity(request, "r2.bulk_delete", {
        summary: `Deleted ${deleted} object${deleted === 1 ? "" : "s"}`,
        metadata: { count: deleted, keys: (body.keys as string[]).slice(0, 20) },
      });
      return NextResponse.json({ ok: true as const, deleted });
    }

    const key = readString(body, "key");
    await deleteObject(key);
    await logRequestActivity(request, "r2.object.delete", {
      summary: `Deleted object ${key}`,
      metadata: { key },
    });
    return NextResponse.json({ ok: true as const });
  } catch (error) {
    return failure("DELETE", error);
  }
}
