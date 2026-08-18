"use client";

import {
  Archive,
  Box,
  ChevronRight,
  File as FileIcon,
  Folder,
  Inbox,
  TriangleAlert,
} from "lucide-react";
import { classifyFile } from "@/lib/file-kind";
import { useRef, type MouseEvent as ReactMouseEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { cn } from "@/lib/cn";
import { EMPTY_VALUE, formatBytes, formatDateTime } from "@/lib/format";
import { hubSelectId } from "@/lib/r2-client";
import type { R2File, R2Folder } from "@/lib/types";

export type FileListTarget =
  | { kind: "folder"; prefix: string; name: string }
  | { kind: "file"; key: string; name: string; size: number; lastModified: string | null }
  | { kind: "background" };

export type FileListProps = {
  folders: R2Folder[];
  files: R2File[];
  loading: boolean;
  error: string | null;
  selectedIds: ReadonlySet<string>;
  onToggleSelect: (id: string, options?: { shiftKey?: boolean; rangeIds?: string[] }) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onDeleteSelected: () => void;
  onOpenFolder: (prefix: string) => void;
  onOpenFile: (file: R2File) => void;
  onOpenMenu: (target: FileListTarget, x: number, y: number) => void;
  onRetry: () => void;
};

type ListEntry =
  | { kind: "folder"; id: string; folder: R2Folder }
  | { kind: "file"; id: string; file: R2File };

export function FileList({
  folders,
  files,
  loading,
  error,
  selectedIds,
  onToggleSelect,
  onSelectAll,
  onClearSelection,
  onDeleteSelected,
  onOpenFolder,
  onOpenFile,
  onOpenMenu,
  onRetry,
}: FileListProps) {
  const lastClickedIndexRef = useRef<number | null>(null);

  const entries: ListEntry[] = [
    ...folders.map((folder) => ({
      kind: "folder" as const,
      id: hubSelectId({ kind: "folder", prefix: folder.prefix }),
      folder,
    })),
    ...files.map((file) => ({
      kind: "file" as const,
      id: hubSelectId({ kind: "file", key: file.key }),
      file,
    })),
  ];

  function openMenuAt(event: ReactMouseEvent, target: FileListTarget) {
    event.preventDefault();
    event.stopPropagation();
    onOpenMenu(target, event.clientX, event.clientY);
  }

  function handleCheckClick(event: ReactMouseEvent, id: string, index: number) {
    event.preventDefault();
    event.stopPropagation();

    if (event.shiftKey && lastClickedIndexRef.current !== null) {
      const from = Math.min(lastClickedIndexRef.current, index);
      const to = Math.max(lastClickedIndexRef.current, index);
      onToggleSelect(id, {
        shiftKey: true,
        rangeIds: entries.slice(from, to + 1).map((entry) => entry.id),
      });
    } else {
      onToggleSelect(id);
    }

    lastClickedIndexRef.current = index;
  }

  const selectedCount = selectedIds.size;
  const selectedInList = entries.filter((entry) => selectedIds.has(entry.id)).length;
  const allSelected = entries.length > 0 && selectedInList === entries.length;
  const someSelected = selectedInList > 0 && !allSelected;

  if (error) {
    return (
      <div className="flex flex-col items-start gap-3 px-4 py-10">
        <div className="flex items-center gap-2 text-danger">
          <TriangleAlert aria-hidden className="size-4 shrink-0" />
          <p className="text-sm">{error}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  }

  if (loading && folders.length === 0 && files.length === 0) {
    return (
      <div className="flex flex-col">
        <ListHeader
          selectDisabled
          allSelected={false}
          someSelected={false}
          onSelectAll={() => undefined}
        />
        <div className="flex flex-col gap-1 px-4 py-3">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="flex items-center gap-3 py-1.5">
              <Skeleton className="size-4 shrink-0" />
              <Skeleton className="size-4 shrink-0" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-32" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (folders.length === 0 && files.length === 0) {
    return (
      <div
        onContextMenu={(event) => openMenuAt(event, { kind: "background" })}
        className="flex min-h-full flex-1 flex-col items-center justify-center gap-2 px-4 py-16 text-center"
      >
        <Inbox aria-hidden className="size-6 text-subtle" />
        <p className="text-sm text-muted">This folder is empty</p>
        <p className="max-w-xs text-xs text-subtle">
          Right-click anywhere here to create a subfolder.
        </p>
      </div>
    );
  }

  return (
    <div
      onContextMenu={(event) => openMenuAt(event, { kind: "background" })}
      className="flex min-h-full flex-col"
    >
      {selectedCount > 0 ? (
        <div className="flex h-10 shrink-0 items-center gap-3 border-b border-hairline bg-raised/40 px-4">
          <span className="text-xs text-ink">{selectedCount} selected</span>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onClearSelection}>
              Clear
            </Button>
            <Button variant="danger" size="sm" onClick={onDeleteSelected}>
              Delete
            </Button>
          </div>
        </div>
      ) : null}

      <ListHeader
        selectDisabled={entries.length === 0}
        allSelected={allSelected}
        someSelected={someSelected}
        onSelectAll={() => {
          if (allSelected) onClearSelection();
          else onSelectAll();
        }}
      />
      <ul className="divide-y divide-hairline/60">
        {entries.map((entry, index) => {
          if (entry.kind === "folder") {
            const { folder, id } = entry;
            const selected = selectedIds.has(id);
            return (
              <li
                key={id}
                onContextMenu={(event) =>
                  openMenuAt(event, { kind: "folder", prefix: folder.prefix, name: folder.name })
                }
                className={cn(
                  "flex items-center gap-3 px-4 py-2 transition-colors duration-150",
                  selected ? "bg-accent/10 hover:bg-accent/15" : "hover:bg-raised",
                )}
              >
                <label
                  data-hub-select="true"
                  className="flex size-3.5 shrink-0 cursor-pointer items-center justify-center"
                  onClick={(event) => handleCheckClick(event, id, index)}
                  onDoubleClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    readOnly
                    tabIndex={-1}
                    aria-label={`Select folder ${folder.name}`}
                    className="size-3.5 cursor-pointer rounded border-hairline accent-accent"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => onOpenFolder(folder.prefix)}
                  className="group flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <Folder aria-hidden className="size-4 shrink-0 text-accent" />
                  <span className="min-w-0 flex-1 truncate text-xs text-ink">{folder.name}</span>
                  <span className="w-20 shrink-0 text-right font-mono text-[11px] text-subtle">
                    {EMPTY_VALUE}
                  </span>
                  <span className="hidden w-40 shrink-0 text-right font-mono text-[11px] text-subtle sm:block">
                    {EMPTY_VALUE}
                  </span>
                  <ChevronRight
                    aria-hidden
                    className="size-3.5 shrink-0 text-subtle transition-colors duration-150 group-hover:text-ink"
                  />
                </button>
              </li>
            );
          }

          const { file, id } = entry;
          const selected = selectedIds.has(id);
          const kind = classifyFile(file.name);
          return (
            <li
              key={id}
              onContextMenu={(event) =>
                openMenuAt(event, {
                  kind: "file",
                  key: file.key,
                  name: file.name,
                  size: file.size,
                  lastModified: file.lastModified,
                })
              }
              onDoubleClick={(event) => {
                const target = event.target as HTMLElement | null;
                if (target?.closest('[data-hub-select="true"]')) return;
                onOpenFile(file);
              }}
              className={cn(
                "flex cursor-default items-center gap-3 px-4 py-2 transition-colors duration-150",
                selected ? "bg-accent/10 hover:bg-accent/15" : "hover:bg-raised/60",
              )}
            >
              <label
                data-hub-select="true"
                className="flex size-3.5 shrink-0 cursor-pointer items-center justify-center"
                onClick={(event) => handleCheckClick(event, id, index)}
                onDoubleClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
              >
                <input
                  type="checkbox"
                  checked={selected}
                  readOnly
                  tabIndex={-1}
                  aria-label={`Select ${file.name}`}
                  className="size-3.5 cursor-pointer rounded border-hairline accent-accent"
                />
              </label>
              {kind === "model" ? (
                <Box aria-hidden className="size-4 shrink-0 text-accent" />
              ) : kind === "archive" ? (
                <Archive aria-hidden className="size-4 shrink-0 text-accent" />
              ) : (
                <FileIcon aria-hidden className="size-4 shrink-0 text-subtle" />
              )}
              <span className="min-w-0 flex-1 truncate text-xs text-muted" title={file.key}>
                {file.name}
              </span>
              <span className="w-20 shrink-0 text-right font-mono text-[11px] text-subtle">
                {formatBytes(file.size)}
              </span>
              <span className="hidden w-40 shrink-0 text-right font-mono text-[11px] text-subtle sm:block">
                {formatDateTime(file.lastModified)}
              </span>
              <span aria-hidden className="size-3.5 shrink-0" />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ListHeader({
  selectDisabled,
  allSelected,
  someSelected,
  onSelectAll,
}: {
  selectDisabled: boolean;
  allSelected: boolean;
  someSelected: boolean;
  onSelectAll: () => void;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-hairline px-4 py-2 text-[11px] uppercase tracking-wide text-subtle">
      <label
        className={cn(
          "flex size-3.5 shrink-0 items-center justify-center",
          selectDisabled ? "pointer-events-none opacity-40" : "cursor-pointer",
        )}
        title="Select all folders and files in this listing"
      >
        <input
          type="checkbox"
          disabled={selectDisabled}
          checked={allSelected}
          ref={(node) => {
            if (node) node.indeterminate = someSelected;
          }}
          onChange={onSelectAll}
          aria-label="Select all folders and files in this listing"
          className="size-3.5 cursor-pointer rounded border-hairline accent-accent disabled:cursor-not-allowed"
        />
      </label>
      <span className="min-w-0 flex-1">Name</span>
      <span className="w-20 shrink-0 text-right">Size</span>
      <span className="hidden w-40 shrink-0 text-right sm:block">Modified</span>
      <span aria-hidden className="size-3.5 shrink-0" />
    </div>
  );
}
