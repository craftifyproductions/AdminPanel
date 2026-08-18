"use client";

import { ChevronRight, File as FileIcon, Folder, FolderOpen, HardDrive, Loader2 } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Skeleton } from "@/components/ui/Skeleton";
import type { FolderTreeStore } from "@/components/use-folder-tree";
import { cn } from "@/lib/cn";
import { ROOT_LABEL, ROOT_PREFIX, validateFolderName } from "@/lib/r2-client";
import type { R2File, R2Folder } from "@/lib/types";

const INDENT_PX = 14;

export type FolderTarget = { prefix: string; name: string; isRoot: boolean };

export type TreeMenuTarget =
  | ({ kind: "folder" } & FolderTarget)
  | { kind: "file"; key: string; name: string; size: number; lastModified: string | null };

export type TreeEdit =
  | { mode: "create"; parentPrefix: string }
  | { mode: "rename"; prefix: string; initialName: string };

export type FolderTreeProps = {
  tree: FolderTreeStore;
  selectedPrefix: string;
  edit: TreeEdit | null;
  editBusy: boolean;
  onSelect: (prefix: string) => void;
  onOpenFile: (file: R2File) => void;
  onOpenMenu: (target: TreeMenuTarget, x: number, y: number) => void;
  onEditCommit: (value: string) => void;
  onEditCancel: () => void;
};

type TreeContext = FolderTreeProps;

export function FolderTree(props: FolderTreeProps) {
  return (
    <div role="tree" aria-label="Bucket folders" className="flex flex-col gap-0.5 p-2">
      <FolderNode prefix={ROOT_PREFIX} name={ROOT_LABEL} depth={0} isRoot context={props} />
    </div>
  );
}

function FolderNode({
  prefix,
  name,
  depth,
  isRoot,
  context,
}: {
  prefix: string;
  name: string;
  depth: number;
  isRoot: boolean;
  context: TreeContext;
}) {
  const {
    tree,
    selectedPrefix,
    edit,
    editBusy,
    onSelect,
    onOpenFile,
    onOpenMenu,
    onEditCommit,
    onEditCancel,
  } = context;

  const node = tree.nodes[prefix];
  const isExpanded = tree.expanded.has(prefix);
  const isSelected = selectedPrefix === prefix;
  const isLoading = node?.status === "loading";
  const renameEdit = edit?.mode === "rename" && edit.prefix === prefix ? edit : null;
  const isCreatingHere = edit?.mode === "create" && edit.parentPrefix === prefix;
  const folders: R2Folder[] = node?.folders ?? [];
  const files: R2File[] = node?.files ?? [];
  const isEmpty = folders.length === 0 && files.length === 0;

  function onRowContextMenu(event: ReactMouseEvent) {
    event.stopPropagation();
    if (event.target instanceof HTMLInputElement) return;
    event.preventDefault();
    onOpenMenu({ kind: "folder", prefix, name, isRoot }, event.clientX, event.clientY);
  }

  function onLabelKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowRight" && !isExpanded) {
      event.preventDefault();
      tree.expand(prefix);
    } else if (event.key === "ArrowLeft" && isExpanded) {
      event.preventDefault();
      tree.toggle(prefix);
    }
  }

  const NodeIcon = isRoot ? HardDrive : isExpanded ? FolderOpen : Folder;

  return (
    <div role="treeitem" aria-expanded={isExpanded} aria-selected={isSelected}>
      <div
        onContextMenu={onRowContextMenu}
        className={cn(
          "group flex items-center gap-1 rounded-md pr-2 transition-colors duration-150",
          isSelected ? "bg-accent/12" : "hover:bg-raised",
        )}
        style={{ paddingLeft: depth * INDENT_PX }}
      >
        <button
          type="button"
          onClick={() => tree.toggle(prefix)}
          aria-label={`${isExpanded ? "Collapse" : "Expand"} ${name}`}
          className="flex size-6 shrink-0 items-center justify-center rounded text-subtle transition-colors duration-150 hover:text-ink"
        >
          {isLoading && isEmpty ? (
            <Loader2 aria-hidden className="size-3.5 animate-spin" />
          ) : (
            <ChevronRight
              aria-hidden
              className={cn(
                "size-3.5 transition-transform duration-150",
                isExpanded && "rotate-90",
              )}
            />
          )}
        </button>

        {renameEdit ? (
          <TreeInput
            key={`rename:${prefix}`}
            initialValue={renameEdit.initialName}
            placeholder="Folder name"
            busy={editBusy}
            onCommit={onEditCommit}
            onCancel={onEditCancel}
          />
        ) : (
          <button
            type="button"
            onClick={() => onSelect(prefix)}
            onKeyDown={onLabelKeyDown}
            title={isRoot ? ROOT_LABEL : prefix}
            className={cn(
              "flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left text-xs transition-colors duration-150",
              isSelected ? "text-accent-ink" : "text-muted group-hover:text-ink",
            )}
          >
            <NodeIcon
              aria-hidden
              className={cn("size-3.5 shrink-0", isSelected ? "text-accent" : "text-subtle")}
            />
            <span className="truncate">{name}</span>
            {isLoading && !isEmpty ? (
              <Loader2 aria-hidden className="size-3 shrink-0 animate-spin text-subtle" />
            ) : null}
          </button>
        )}
      </div>

      {isExpanded ? (
        <div role="group" className="flex flex-col gap-0.5">
          {node?.status === "error" ? (
            <div
              className="flex flex-col items-start gap-1 py-1"
              style={{ paddingLeft: (depth + 1) * INDENT_PX + 8 }}
            >
              <p className="text-[11px] text-danger">{node.error}</p>
              <Button variant="ghost" size="sm" onClick={() => void tree.refresh(prefix)}>
                Retry
              </Button>
            </div>
          ) : null}

          {isLoading && isEmpty ? (
            <div
              className="flex flex-col gap-1 py-1"
              style={{ paddingLeft: (depth + 1) * INDENT_PX + 8 }}
            >
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-24" />
            </div>
          ) : null}

          {isCreatingHere ? (
            <div
              className="flex items-center py-0.5 pr-2"
              style={{ paddingLeft: (depth + 1) * INDENT_PX + 24 }}
            >
              <TreeInput
                key={`create:${prefix}`}
                initialValue=""
                placeholder="New folder name"
                busy={editBusy}
                onCommit={onEditCommit}
                onCancel={onEditCancel}
              />
            </div>
          ) : null}

          {folders.map((folder) => (
            <FolderNode
              key={folder.prefix}
              prefix={folder.prefix}
              name={folder.name}
              depth={depth + 1}
              isRoot={false}
              context={context}
            />
          ))}

          {files.map((file) => (
            <FileNode
              key={file.key}
              file={file}
              depth={depth + 1}
              onOpenFile={onOpenFile}
              onOpenMenu={onOpenMenu}
            />
          ))}

          {node?.status === "loaded" && isEmpty && !isCreatingHere ? (
            <p
              className="py-1 text-[11px] text-subtle"
              style={{ paddingLeft: (depth + 1) * INDENT_PX + 32 }}
            >
              Empty
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function FileNode({
  file,
  depth,
  onOpenFile,
  onOpenMenu,
}: {
  file: R2File;
  depth: number;
  onOpenFile: (file: R2File) => void;
  onOpenMenu: (target: TreeMenuTarget, x: number, y: number) => void;
}) {
  function onContextMenu(event: ReactMouseEvent) {
    event.stopPropagation();
    event.preventDefault();
    onOpenMenu(
      {
        kind: "file",
        key: file.key,
        name: file.name,
        size: file.size,
        lastModified: file.lastModified,
      },
      event.clientX,
      event.clientY,
    );
  }

  return (
    <div
      role="treeitem"
      aria-selected={false}
      onContextMenu={onContextMenu}
      className="group flex items-center gap-1 rounded-md pr-2 transition-colors duration-150 hover:bg-raised"
      style={{ paddingLeft: depth * INDENT_PX }}
    >
      <span aria-hidden className="size-6 shrink-0" />
      <button
        type="button"
        onClick={() => onOpenFile(file)}
        onDoubleClick={() => onOpenFile(file)}
        title={file.key}
        className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left text-xs text-muted transition-colors duration-150 group-hover:text-ink"
      >
        <FileIcon aria-hidden className="size-3.5 shrink-0 text-subtle" />
        <span className="truncate">{file.name}</span>
      </button>
    </div>
  );
}

function TreeInput({
  initialValue,
  placeholder,
  busy,
  onCommit,
  onCancel,
}: {
  initialValue: string;
  placeholder: string;
  busy: boolean;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, []);

  function submit() {
    const problem = validateFolderName(value);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    onCommit(value.trim());
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1 py-1">
      <Input
        ref={inputRef}
        value={value}
        disabled={busy}
        invalid={error !== null}
        placeholder={placeholder}
        aria-label={placeholder}
        spellCheck={false}
        autoComplete="off"
        className="h-7 px-2 text-xs"
        onChange={(event) => {
          setValue(event.target.value);
          if (error) setError(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            submit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          }
        }}
      />
      <p className={cn("text-[11px]", error ? "text-danger" : "text-subtle")}>
        {error ?? "Enter to save · Esc to cancel"}
      </p>
    </div>
  );
}
