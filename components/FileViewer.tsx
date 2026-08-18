"use client";

import { Download, File as FileIcon, Image as ImageIcon, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BbModelViewer } from "@/components/BbModelViewer";
import { HighlightedCode } from "@/components/HighlightedCode";
import { ImagePane } from "@/components/ImagePane";
import { ZipArchiveViewer } from "@/components/ZipArchiveViewer";
import { Button } from "@/components/ui/Button";
import { useIsClient } from "@/components/ui/use-is-client";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/cn";
import { classifyFile, type FileKind } from "@/lib/file-kind";
import { formatBytes } from "@/lib/format";
import {
  R2ClientError,
  downloadObject,
  errorMessage,
  fetchObject,
  saveObjectText,
} from "@/lib/r2-client";
import type { R2File } from "@/lib/types";

function parseKind(value: string | null | undefined, fallback: FileKind): FileKind {
  if (
    value === "image" ||
    value === "text" ||
    value === "model" ||
    value === "archive" ||
    value === "binary"
  ) {
    return value;
  }
  return fallback;
}

function isJsonFile(name: string, contentType: string): boolean {
  const base = name.includes("/") ? name.slice(name.lastIndexOf("/") + 1) : name;
  return base.toLowerCase().endsWith(".json") || contentType.toLowerCase().includes("json");
}

export type FileViewerProps = {
  file: R2File;
  onClose: () => void;
  onSaved?: () => void;
};

type LoadState =
  | { status: "loading" }
  | {
      status: "ready";
      kind: FileKind;
      contentType: string;
      size: number;
      text?: string;
      imageUrl?: string;
      blob?: Blob;
    }
  | {
      status: "oversize";
      kind: FileKind;
      contentType: string | null;
      size: number;
      message: string;
    }
  | { status: "error"; message: string };

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function FileViewer({ file, onClose, onSaved }: FileViewerProps) {
  const toast = useToast();
  const isClient = useIsClient();
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [draft, setDraft] = useState("");
  const [loadedText, setLoadedText] = useState("");
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const dirty = load.status === "ready" && load.kind === "text" && draft !== loadedText;

  const requestClose = useCallback(() => {
    if (dirty) {
      const confirmed = window.confirm("Discard unsaved changes?");
      if (!confirmed) return;
    }
    onClose();
  }, [dirty, onClose]);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    const fallbackKind = classifyFile(file.name);
    const key = file.key;
    const listedSize = file.size;

    void (async () => {
      try {
        const result = await fetchObject(key);
        if (cancelled) return;

        const kind = parseKind(result.kind, classifyFile(file.name, result.contentType));

        if (kind === "image") {
          const url = URL.createObjectURL(result.blob);
          if (cancelled) {
            URL.revokeObjectURL(url);
            return;
          }
          objectUrl = url;
          setLoad({
            status: "ready",
            kind,
            contentType: result.contentType,
            size: result.size,
            imageUrl: url,
          });
          return;
        }

        if (kind === "model" || kind === "archive") {
          setLoad({
            status: "ready",
            kind,
            contentType: result.contentType,
            size: result.size,
            blob: result.blob,
          });
          return;
        }

        if (kind === "text") {
          const text = await result.blob.text();
          if (cancelled) return;
          setLoadedText(text);
          setDraft(text);
          setLoad({
            status: "ready",
            kind,
            contentType: result.contentType,
            size: result.size,
            text,
          });
          return;
        }

        setLoad({
          status: "ready",
          kind: "binary",
          contentType: result.contentType,
          size: result.size,
        });
      } catch (error) {
        if (cancelled) return;
        if (error instanceof R2ClientError && error.status === 413) {
          setLoad({
            status: "oversize",
            kind: fallbackKind,
            contentType: null,
            size: listedSize,
            message: error.message,
          });
          return;
        }
        setLoad({ status: "error", message: errorMessage(error) });
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file.key, file.name, file.size]);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        if (document.fullscreenElement) {
          void document.exitFullscreen();
          return;
        }
        requestClose();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;

      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) {
        event.preventDefault();
        panelRef.current.focus();
        return;
      }

      const edge = event.shiftKey ? focusable[0] : focusable[focusable.length - 1];
      if (document.activeElement === edge || !panelRef.current.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? focusable[focusable.length - 1] : focusable[0]).focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.();
    };
  }, [requestClose]);

  async function onDownload() {
    if (downloading) return;
    setDownloading(true);
    try {
      await downloadObject(file.key, file.name);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setDownloading(false);
    }
  }

  async function onSave() {
    if (load.status !== "ready" || load.kind !== "text" || saving || !dirty) return;
    setSaving(true);
    try {
      await saveObjectText(file.key, draft, load.contentType);
      setLoadedText(draft);
      setLoad({
        ...load,
        text: draft,
        size: new TextEncoder().encode(draft).length,
      });
      toast.success(`Saved “${file.name}”.`);
      onSaved?.();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  function onDiscard() {
    if (load.status !== "ready" || load.kind !== "text" || !dirty) return;
    setDraft(loadedText);
  }

  function onFormat() {
    if (load.status !== "ready" || load.kind !== "text") return;
    try {
      const parsed: unknown = JSON.parse(draft);
      setDraft(`${JSON.stringify(parsed, null, 2)}\n`);
    } catch {
      toast.error("Invalid JSON — fix the syntax before formatting.");
    }
  }

  if (!isClient) return null;

  const metaType =
    load.status === "ready" || load.status === "oversize" ? load.contentType : null;
  const metaSize =
    load.status === "ready" || load.status === "oversize" ? load.size : file.size;
  const showJsonFormat =
    load.status === "ready" &&
    load.kind === "text" &&
    isJsonFile(file.name, load.contentType);

  const description = [
    formatBytes(metaSize),
    metaType && metaType.length > 0 ? metaType : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        aria-hidden
        onMouseDown={requestClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-[1px]"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className={cn(
          "relative flex w-full flex-col overflow-hidden border border-hairline bg-panel shadow-2xl shadow-black/50",
          load.status === "ready" && (load.kind === "model" || load.kind === "archive")
            ? "h-[min(92vh,56rem)] max-w-5xl rounded-lg"
            : "h-[min(90vh,52rem)] max-w-4xl rounded-lg",
        )}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-hairline px-4 py-3">
          <div className="min-w-0 flex flex-col gap-1">
            <h2 id={titleId} className="truncate text-sm font-semibold text-ink" title={file.key}>
              {file.name}
            </h2>
            <p id={descriptionId} className="truncate font-mono text-xs text-muted" title={file.key}>
              {description || file.key}
            </p>
          </div>
          <button
            type="button"
            onClick={requestClose}
            aria-label="Close dialog"
            className="rounded-md p-1 text-subtle transition-colors duration-150 hover:bg-raised hover:text-ink"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          {load.status === "loading" ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-muted">
              <Loader2 aria-hidden className="size-4 animate-spin" />
              Loading file…
            </div>
          ) : null}

          {load.status === "error" ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <p className="text-sm text-danger">{load.message}</p>
              <Button variant="ghost" size="sm" onClick={requestClose}>
                Close
              </Button>
            </div>
          ) : null}

          {load.status === "ready" && load.kind === "image" && load.imageUrl ? (
            <ImagePane key={load.imageUrl} src={load.imageUrl} alt={file.name} />
          ) : null}

          {load.status === "ready" && load.kind === "model" && load.blob ? (
            <BbModelViewer key={file.key} blob={load.blob} fileName={file.name} />
          ) : null}

          {load.status === "ready" && load.kind === "archive" && load.blob ? (
            <ZipArchiveViewer key={file.key} blob={load.blob} fileName={file.name} />
          ) : null}

          {load.status === "ready" && load.kind === "text" ? (
            <HighlightedCode
              value={draft}
              fileName={file.name}
              onChange={setDraft}
              aria-label={`Edit ${file.name}`}
            />
          ) : null}

          {load.status === "ready" && load.kind === "binary" ? (
            <BinaryPane name={file.name} size={load.size} contentType={load.contentType} />
          ) : null}

          {load.status === "oversize" ? (
            <BinaryPane
              name={file.name}
              size={load.size}
              contentType={load.contentType}
              message={load.message}
            />
          ) : null}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-hairline px-4 py-3">
          {load.status === "ready" && load.kind === "text" ? (
            <>
              {showJsonFormat ? (
                <Button variant="ghost" size="sm" disabled={saving} onClick={onFormat}>
                  Format
                </Button>
              ) : null}
              <Button variant="ghost" size="sm" disabled={!dirty || saving} onClick={onDiscard}>
                Discard
              </Button>
              <Button size="sm" loading={saving} disabled={!dirty} onClick={() => void onSave()}>
                Save
              </Button>
            </>
          ) : null}

          {load.status === "ready" &&
          (load.kind === "image" ||
            load.kind === "model" ||
            load.kind === "archive" ||
            load.kind === "binary") ? (
            <Button
              variant={load.kind === "binary" ? "primary" : "ghost"}
              size="sm"
              loading={downloading}
              onClick={() => void onDownload()}
            >
              <Download aria-hidden className="size-3.5" />
              Download
            </Button>
          ) : null}

          {load.status === "oversize" ? (
            <Button size="sm" loading={downloading} onClick={() => void onDownload()}>
              <Download aria-hidden className="size-3.5" />
              Download
            </Button>
          ) : null}

          {load.status === "loading" || load.status === "error" ? (
            <Button variant="ghost" size="sm" onClick={requestClose}>
              Close
            </Button>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function BinaryPane({
  name,
  size,
  contentType,
  message,
}: {
  name: string;
  size: number;
  contentType: string | null;
  message?: string;
}) {
  const kind = classifyFile(name, contentType);
  const Icon = kind === "image" ? ImageIcon : FileIcon;

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
      <Icon aria-hidden className="size-10 text-subtle" />
      <div className="flex flex-col gap-1">
        <p className="text-sm text-ink">{name}</p>
        <p className="font-mono text-xs text-muted">
          {[formatBytes(size), contentType].filter(Boolean).join(" · ")}
        </p>
        {message ? <p className="mt-2 max-w-md text-xs text-muted">{message}</p> : null}
        {!message ? (
          <p className="mt-2 max-w-sm text-xs text-subtle">
            This file cannot be previewed in the browser. Download it to open locally.
          </p>
        ) : null}
      </div>
    </div>
  );
}
