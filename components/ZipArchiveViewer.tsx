"use client";

import { strFromU8, unzip } from "fflate";
import {
  Archive,
  ArrowLeft,
  Box,
  ChevronRight,
  Download,
  Eye,
  File as FileIcon,
  Folder,
  Image as ImageIcon,
  Inbox,
  Loader2,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { BbModelViewer } from "@/components/BbModelViewer";
import { HighlightedCode } from "@/components/HighlightedCode";
import { ImagePane } from "@/components/ImagePane";
import { Button } from "@/components/ui/Button";
import { classifyFile, type FileKind } from "@/lib/file-kind";
import { cn } from "@/lib/cn";
import { formatBytes } from "@/lib/format";

export type ZipArchiveViewerProps = {
  blob: Blob;
  fileName: string;
};

type ZipEntry = {
  path: string;
  name: string;
  size: number;
  data: Uint8Array;
};

type FolderEntry = {
  name: string;
  prefix: string;
};

const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
};

const MAX_TEXT_PREVIEW_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_PREVIEW_BYTES = 20 * 1024 * 1024;
const MAX_MODEL_PREVIEW_BYTES = 20 * 1024 * 1024;

function normalizeZipPath(raw: string): string | null {
  const cleaned = raw.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!cleaned || cleaned.includes("\0")) return null;
  const parts = cleaned.split("/").filter((part) => part.length > 0);
  if (parts.some((part) => part === ".." || part === ".")) return null;
  return parts.join("/");
}

function parentPrefix(prefix: string): string {
  if (!prefix) return "";
  const trimmed = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
  const slash = trimmed.lastIndexOf("/");
  return slash === -1 ? "" : `${trimmed.slice(0, slash + 1)}`;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return "";
  return name.slice(dot + 1).toLowerCase();
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
}

function downloadBytes(name: string, data: Uint8Array) {
  const url = URL.createObjectURL(new Blob([toArrayBuffer(data)]));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function entryIcon(kind: FileKind) {
  if (kind === "image") return ImageIcon;
  if (kind === "model") return Box;
  if (kind === "archive") return Archive;
  return FileIcon;
}

function canPreview(kind: FileKind, size: number): boolean {
  if (kind === "text") return size <= MAX_TEXT_PREVIEW_BYTES;
  if (kind === "image") return size <= MAX_IMAGE_PREVIEW_BYTES;
  if (kind === "model") return size <= MAX_MODEL_PREVIEW_BYTES;
  return false;
}

function EntryPreview({ entry, onBack }: { entry: ZipEntry; onBack: () => void }) {
  const kind = classifyFile(entry.name);
  const [text, setText] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [modelBlob, setModelBlob] = useState<Blob | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    setText(null);
    setImageUrl(null);
    setModelBlob(null);
    setPreviewError(null);

    if (!canPreview(kind, entry.size)) {
      if (kind === "text") {
        setPreviewError("This text file is larger than 2 MiB. Download it instead.");
      } else if (kind === "image") {
        setPreviewError("This image is larger than 20 MiB. Download it instead.");
      } else if (kind === "model") {
        setPreviewError("This model is larger than 20 MiB. Download it instead.");
      } else {
        setPreviewError("This file type cannot be previewed inside the archive.");
      }
      return;
    }

    if (kind === "text") {
      try {
        let content = strFromU8(entry.data);
        if (entry.name.toLowerCase().endsWith(".json")) {
          try {
            content = `${JSON.stringify(JSON.parse(content), null, 2)}\n`;
          } catch {
            // keep raw text if JSON is invalid
          }
        }
        setText(content);
      } catch {
        setPreviewError("Could not decode this text file.");
      }
      return;
    }

    if (kind === "image") {
      const ext = extensionOf(entry.name);
      const mime = IMAGE_MIME[ext] ?? "application/octet-stream";
      const url = URL.createObjectURL(new Blob([toArrayBuffer(entry.data)], { type: mime }));
      setImageUrl(url);
      return () => URL.revokeObjectURL(url);
    }

    if (kind === "model") {
      setModelBlob(new Blob([toArrayBuffer(entry.data)], { type: "application/json" }));
    }
  }, [entry, kind]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-hairline px-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-muted transition-colors duration-150 hover:bg-raised hover:text-ink"
        >
          <ArrowLeft aria-hidden className="size-3.5" />
          Back
        </button>
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink" title={entry.path}>
          {entry.name}
        </span>
        <span className="shrink-0 font-mono text-[11px] text-subtle">{formatBytes(entry.size)}</span>
        <button
          type="button"
          title={`Download ${entry.name}`}
          aria-label={`Download ${entry.name}`}
          onClick={() => downloadBytes(entry.name, entry.data)}
          className="rounded-md p-1.5 text-subtle transition-colors duration-150 hover:bg-raised hover:text-ink"
        >
          <Download aria-hidden className="size-3.5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {previewError ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <TriangleAlert aria-hidden className="size-5 text-danger" />
            <p className="text-sm text-danger">{previewError}</p>
            <Button size="sm" onClick={() => downloadBytes(entry.name, entry.data)}>
              <Download aria-hidden className="size-3.5" />
              Download
            </Button>
          </div>
        ) : null}

        {text !== null ? (
          <HighlightedCode
            value={text}
            fileName={entry.name}
            readOnly
            aria-label={entry.name}
          />
        ) : null}

        {imageUrl ? <ImagePane key={imageUrl} src={imageUrl} alt={entry.name} /> : null}

        {modelBlob ? <BbModelViewer blob={modelBlob} fileName={entry.name} /> : null}
      </div>
    </div>
  );
}

export function ZipArchiveViewer({ blob, fileName }: ZipArchiveViewerProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [entries, setEntries] = useState<ZipEntry[]>([]);
  const [prefix, setPrefix] = useState("");
  const [activePath, setActivePath] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setEntries([]);
    setPrefix("");
    setActivePath(null);

    void (async () => {
      try {
        const buffer = new Uint8Array(await blob.arrayBuffer());
        const files = await new Promise<Record<string, Uint8Array>>((resolve, reject) => {
          unzip(buffer, (err, result) => {
            if (err) reject(err);
            else resolve(result);
          });
        });
        if (cancelled) return;

        const next: ZipEntry[] = [];
        for (const [rawPath, data] of Object.entries(files)) {
          const path = normalizeZipPath(rawPath);
          if (!path || path.endsWith("/")) continue;
          const slash = path.lastIndexOf("/");
          next.push({
            path,
            name: slash === -1 ? path : path.slice(slash + 1),
            size: data.byteLength,
            data,
          });
        }
        next.sort((a, b) => a.path.localeCompare(b.path));
        setEntries(next);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        const message =
          err instanceof Error && err.message ? err.message : "Could not open this zip archive.";
        setError(message);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [blob]);

  const activeEntry = useMemo(
    () => (activePath ? entries.find((entry) => entry.path === activePath) ?? null : null),
    [activePath, entries],
  );

  const { folders, files, crumbs } = useMemo(() => {
    const folderNames = new Set<string>();
    const filesHere: ZipEntry[] = [];

    for (const entry of entries) {
      if (!entry.path.startsWith(prefix)) continue;
      const rest = entry.path.slice(prefix.length);
      if (!rest) continue;
      const slash = rest.indexOf("/");
      if (slash === -1) {
        filesHere.push(entry);
      } else {
        folderNames.add(rest.slice(0, slash));
      }
    }

    const foldersHere: FolderEntry[] = [...folderNames]
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({ name, prefix: `${prefix}${name}/` }));

    filesHere.sort((a, b) => a.name.localeCompare(b.name));

    const crumbParts = prefix ? prefix.replace(/\/$/, "").split("/") : [];
    const crumbItems = [{ label: fileName, prefix: "" }].concat(
      crumbParts.map((label, index) => ({
        label,
        prefix: `${crumbParts.slice(0, index + 1).join("/")}/`,
      })),
    );

    return { folders: foldersHere, files: filesHere, crumbs: crumbItems };
  }, [entries, fileName, prefix]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted">
        <Loader2 aria-hidden className="size-4 animate-spin" />
        Reading zip archive…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <TriangleAlert aria-hidden className="size-5 text-danger" />
        <p className="text-sm text-danger">{error}</p>
      </div>
    );
  }

  if (activeEntry) {
    return <EntryPreview entry={activeEntry} onBack={() => setActivePath(null)} />;
  }

  const empty = folders.length === 0 && files.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 overflow-x-auto border-b border-hairline px-3">
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          return (
            <div key={crumb.prefix || "root"} className="flex shrink-0 items-center gap-1">
              {index > 0 ? <ChevronRight aria-hidden className="size-3 text-subtle" /> : null}
              {last ? (
                <span className="truncate text-xs font-medium text-ink">{crumb.label}</span>
              ) : (
                <button
                  type="button"
                  onClick={() => setPrefix(crumb.prefix)}
                  className="truncate text-xs text-muted transition-colors duration-150 hover:text-ink"
                >
                  {crumb.label}
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {empty ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
            <Inbox aria-hidden className="size-6 text-subtle" />
            <p className="text-sm text-muted">This folder is empty</p>
            {prefix ? (
              <Button variant="ghost" size="sm" onClick={() => setPrefix(parentPrefix(prefix))}>
                Go up
              </Button>
            ) : null}
          </div>
        ) : (
          <ul className="divide-y divide-hairline/60">
            {prefix ? (
              <li>
                <button
                  type="button"
                  onClick={() => setPrefix(parentPrefix(prefix))}
                  className="flex w-full items-center gap-3 px-4 py-2 text-left transition-colors duration-150 hover:bg-raised/60"
                >
                  <Folder aria-hidden className="size-4 shrink-0 text-subtle" />
                  <span className="min-w-0 flex-1 truncate text-xs text-muted">..</span>
                  <span aria-hidden className="w-20 shrink-0" />
                  <span aria-hidden className="size-7 shrink-0" />
                </button>
              </li>
            ) : null}

            {folders.map((folder) => (
              <li key={folder.prefix}>
                <button
                  type="button"
                  onDoubleClick={() => setPrefix(folder.prefix)}
                  onClick={() => setPrefix(folder.prefix)}
                  className="flex w-full items-center gap-3 px-4 py-2 text-left transition-colors duration-150 hover:bg-raised/60"
                >
                  <Folder aria-hidden className="size-4 shrink-0 text-accent" />
                  <span className="min-w-0 flex-1 truncate text-xs text-ink">{folder.name}</span>
                  <span className="w-20 shrink-0 text-right font-mono text-[11px] text-subtle">
                    —
                  </span>
                  <ChevronRight aria-hidden className="size-3.5 shrink-0 text-subtle" />
                </button>
              </li>
            ))}

            {files.map((file) => {
              const kind = classifyFile(file.name);
              const previewable = canPreview(kind, file.size);
              const Icon = entryIcon(kind);
              return (
                <li
                  key={file.path}
                  onDoubleClick={() => {
                    if (previewable) setActivePath(file.path);
                  }}
                  className="flex items-center gap-3 px-4 py-2 transition-colors duration-150 hover:bg-raised/60"
                >
                  <Icon
                    aria-hidden
                    className={cn(
                      "size-4 shrink-0",
                      kind === "image" || kind === "model" || kind === "text"
                        ? "text-accent"
                        : "text-subtle",
                    )}
                  />
                  <button
                    type="button"
                    title={previewable ? `Open ${file.name}` : file.path}
                    onClick={() => {
                      if (previewable) setActivePath(file.path);
                    }}
                    className={cn(
                      "min-w-0 flex-1 truncate text-left text-xs",
                      previewable
                        ? "cursor-pointer text-ink hover:underline"
                        : "cursor-default text-muted",
                    )}
                  >
                    {file.name}
                  </button>
                  <span className="w-20 shrink-0 text-right font-mono text-[11px] text-subtle">
                    {formatBytes(file.size)}
                  </span>
                  {previewable ? (
                    <button
                      type="button"
                      title={`Open ${file.name}`}
                      aria-label={`Open ${file.name}`}
                      onClick={() => setActivePath(file.path)}
                      className="rounded-md p-1.5 text-subtle transition-colors duration-150 hover:bg-panel hover:text-ink"
                    >
                      <Eye aria-hidden className="size-3.5" />
                    </button>
                  ) : (
                    <span aria-hidden className="size-7 shrink-0" />
                  )}
                  <button
                    type="button"
                    title={`Download ${file.name}`}
                    aria-label={`Download ${file.name}`}
                    onClick={() => downloadBytes(file.name, file.data)}
                    className="rounded-md p-1.5 text-subtle transition-colors duration-150 hover:bg-panel hover:text-ink"
                  >
                    <Download aria-hidden className="size-3.5" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="shrink-0 border-t border-hairline px-4 py-2 text-[11px] text-subtle">
        Click a texture or JSON to preview it — nothing is extracted to R2.
        {entries.length > 0 ? ` · ${entries.length} file${entries.length === 1 ? "" : "s"}` : null}
      </div>
    </div>
  );
}
