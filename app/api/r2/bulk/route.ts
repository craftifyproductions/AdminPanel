import { NextResponse } from "next/server";
import { logRequestActivity } from "@/lib/activity-log";
import { assertSameOrigin } from "@/lib/csrf";
import { requireSession } from "@/lib/require-session";
import { R2Error, bulkDelete, resolveR2Error } from "@/lib/r2";
import type { ApiError } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = Record<string, unknown>;

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

function readOptionalStringArray(body: Body, field: string): string[] | undefined {
  const value = body[field];
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new R2Error(`"${field}" must be an array of strings.`, 400);
  }
  for (const entry of value) {
    if (typeof entry !== "string") {
      throw new R2Error(`"${field}" must be an array of strings.`, 400);
    }
  }
  return value as string[];
}

function failure(error: unknown) {
  const { status, message } = resolveR2Error(error);
  if (status >= 500) console.error("[api/r2/bulk] DELETE failed", error);
  return NextResponse.json<ApiError>({ error: message }, { status });
}

async function guard(request: Request) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;
  return assertSameOrigin(request);
}

export async function DELETE(request: Request) {
  const denied = await guard(request);
  if (denied) return denied;

  try {
    const body = await readBody(request);
    const files = readOptionalStringArray(body, "files");
    const folders = readOptionalStringArray(body, "folders");

    if ((files === undefined || files.length === 0) && (folders === undefined || folders.length === 0)) {
      throw new R2Error("Select at least one file or folder to delete.", 400);
    }

    const result = await bulkDelete({ files, folders });
    await logRequestActivity(request, "r2.bulk_delete", {
      summary: `Bulk deleted ${result.deletedFolders} folder${result.deletedFolders === 1 ? "" : "s"} and ${result.deletedFiles} file${result.deletedFiles === 1 ? "" : "s"} (${result.deletedObjects} object${result.deletedObjects === 1 ? "" : "s"})`,
      metadata: {
        deletedFiles: result.deletedFiles,
        deletedFolders: result.deletedFolders,
        deletedObjects: result.deletedObjects,
        files: (files ?? []).slice(0, 20),
        folders: (folders ?? []).slice(0, 20),
      },
    });

    return NextResponse.json({
      ok: true as const,
      deletedFiles: result.deletedFiles,
      deletedFolders: result.deletedFolders,
      deletedObjects: result.deletedObjects,
    });
  } catch (error) {
    return failure(error);
  }
}
