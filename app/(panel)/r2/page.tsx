"use client";

import { Copy, Eye, FolderPlus, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { ContextMenu, type ContextMenuItem } from "@/components/ContextMenu";
import { FileList, type FileListTarget } from "@/components/FileList";
import { FileViewer } from "@/components/FileViewer";
import { FolderTree, type TreeEdit } from "@/components/FolderTree";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { useFolderTree } from "@/components/use-folder-tree";
import { cn } from "@/lib/cn";
import { pluralize } from "@/lib/format";
import {
  ROOT_LABEL,
  ROOT_PREFIX,
  bulkDelete,
  createFolder,
  deleteFolder,
  deleteObject,
  errorMessage,
  folderNameOf,
  hubSelectId,
  isInside,
  normalizePrefix,
  parentPrefixOf,
  parseHubSelectId,
  renameFolder,
  renameObject,
  validateEntryName,
} from "@/lib/r2-client";
import type { R2File } from "@/lib/types";

type MenuTarget =
  | { kind: "folder"; source: "tree" | "pane"; prefix: string; name: string; isRoot: boolean }
  | { kind: "file"; key: string; name: string; size: number; lastModified: string | null };

type MenuState = { target: MenuTarget; x: number; y: number };

type PromptTarget =
  | { kind: "folder"; prefix: string; name: string }
  | { kind: "file"; key: string; name: string };

type BulkDeleteConfirm = {
  kind: "bulk-delete";
  files: string[];
  folders: string[];
  names: string[];
  fileCount: number;
  folderCount: number;
};

type ConfirmState =
  | { kind: "rename"; prefix: string; name: string; newName: string }
  | { kind: "delete"; prefix: string; name: string }
  | { kind: "delete-file"; key: string; name: string }
  | BulkDeleteConfirm;

const BULK_DELETE_NAME_PREVIEW = 5;

function formatBulkSelectionLabel(folderCount: number, fileCount: number): string {
  const parts: string[] = [];
  if (folderCount > 0) parts.push(pluralize(folderCount, "folder"));
  if (fileCount > 0) parts.push(pluralize(fileCount, "file"));
  return parts.join(" and ");
}

function selectionFromIds(ids: Iterable<string>): {
  files: string[];
  folders: string[];
} {
  const files: string[] = [];
  const folders: string[] = [];
  for (const id of ids) {
    const item = parseHubSelectId(id);
    if (!item) continue;
    if (item.kind === "file") files.push(item.key);
    else folders.push(item.prefix);
  }
  return { files, folders };
}

export default function R2HubPage() {
  const toast = useToast();
  const tree = useFolderTree();

  const [selectedPrefix, setSelectedPrefix] = useState(ROOT_PREFIX);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [edit, setEdit] = useState<TreeEdit | null>(null);
  const [namePrompt, setNamePrompt] = useState<PromptTarget | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [pending, setPending] = useState(false);
  const [viewer, setViewer] = useState<R2File | null>(null);

  const { load, refresh, expand, reveal, prune } = tree;

  useEffect(() => {
    void load(selectedPrefix);
  }, [load, selectedPrefix]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const changePrefix = useCallback(
    (prefix: string) => {
      if (prefix === selectedPrefix) return;
      setSelectedIds(new Set());
      setSelectedPrefix(prefix);
    },
    [selectedPrefix],
  );

  const selectFolder = useCallback(
    (prefix: string) => {
      changePrefix(prefix);
      reveal(prefix);
    },
    [changePrefix, reveal],
  );

  const openFolder = useCallback(
    (prefix: string) => {
      changePrefix(prefix);
      reveal(prefix);
      expand(prefix);
    },
    [changePrefix, expand, reveal],
  );

  const startCreate = useCallback(
    (parentPrefix: string) => {
      expand(parentPrefix);
      setEdit({ mode: "create", parentPrefix });
    },
    [expand],
  );

  const runCreate = useCallback(
    async (parentPrefix: string, name: string) => {
      setPending(true);
      try {
        await createFolder(parentPrefix, name);
        setEdit(null);
        toast.success(`Created folder “${name}”.`);
        await refresh(parentPrefix);
      } catch (error) {
        toast.error(errorMessage(error));
      } finally {
        setPending(false);
      }
    },
    [refresh, toast],
  );

  const runRename = useCallback(
    async (prefix: string, newName: string) => {
      setPending(true);
      try {
        const result = await renameFolder(prefix, newName);
        const parent = parentPrefixOf(prefix);
        const nextPrefix = normalizePrefix(result.prefix);

        setConfirm(null);
        setEdit(null);
        clearSelection();
        toast.success(`Renamed to “${newName}” · moved ${pluralize(result.moved, "object")}.`);

        prune(prefix);
        setSelectedPrefix((current) => {
          if (!isInside(current, prefix)) return current;
          return current === prefix ? nextPrefix : parent;
        });
        await refresh(parent);
      } catch (error) {
        toast.error(errorMessage(error));
      } finally {
        setPending(false);
      }
    },
    [clearSelection, prune, refresh, toast],
  );

  const runDelete = useCallback(
    async (prefix: string) => {
      setPending(true);
      try {
        const result = await deleteFolder(prefix);
        const parent = parentPrefixOf(prefix);

        setConfirm(null);
        setEdit(null);
        clearSelection();
        toast.success(`Deleted ${pluralize(result.deleted, "object")}.`);

        prune(prefix);
        setSelectedPrefix((current) => (isInside(current, prefix) ? parent : current));
        await refresh(parent);
      } catch (error) {
        toast.error(errorMessage(error));
      } finally {
        setPending(false);
      }
    },
    [clearSelection, prune, refresh, toast],
  );

  const runRenameObject = useCallback(
    async (key: string, newName: string) => {
      setPending(true);
      try {
        await renameObject(key, newName);
        setNamePrompt(null);
        toast.success(`Renamed to “${newName}”.`);
        await refresh(selectedPrefix);
      } catch (error) {
        toast.error(errorMessage(error));
      } finally {
        setPending(false);
      }
    },
    [refresh, selectedPrefix, toast],
  );

  const runDeleteObject = useCallback(
    async (key: string, name: string) => {
      setPending(true);
      try {
        await deleteObject(key);
        setConfirm(null);
        const fileId = hubSelectId({ kind: "file", key });
        setSelectedIds((current) => {
          if (!current.has(fileId)) return current;
          const next = new Set(current);
          next.delete(fileId);
          return next;
        });
        setViewer((current) => (current?.key === key ? null : current));
        toast.success(`Deleted “${name}”.`);
        await refresh(selectedPrefix);
      } catch (error) {
        toast.error(errorMessage(error));
      } finally {
        setPending(false);
      }
    },
    [refresh, selectedPrefix, toast],
  );

  const runBulkDelete = useCallback(
    async (files: string[], folders: string[]) => {
      if (files.length === 0 && folders.length === 0) return;
      setPending(true);
      try {
        const result = await bulkDelete({ files, folders });
        setConfirm(null);
        clearSelection();
        setViewer((current) => {
          if (!current) return current;
          if (files.includes(current.key)) return null;
          if (folders.some((prefix) => isInside(current.key, prefix))) return null;
          return current;
        });

        for (const prefix of folders) prune(prefix);

        setSelectedPrefix((current) => {
          for (const prefix of folders) {
            if (isInside(current, prefix)) return parentPrefixOf(prefix);
          }
          return current;
        });

        const selectionLabel = formatBulkSelectionLabel(
          result.deletedFolders,
          result.deletedFiles,
        );
        toast.success(
          selectionLabel
            ? `Deleted ${selectionLabel} · ${pluralize(result.deletedObjects, "object")}.`
            : `Deleted ${pluralize(result.deletedObjects, "object")}.`,
        );

        const refreshTarget = (() => {
          for (const prefix of folders) {
            if (isInside(selectedPrefix, prefix)) return parentPrefixOf(prefix);
          }
          return selectedPrefix;
        })();
        await refresh(refreshTarget);
      } catch (error) {
        toast.error(errorMessage(error));
      } finally {
        setPending(false);
      }
    },
    [clearSelection, prune, refresh, selectedPrefix, toast],
  );

  const toggleSelect = useCallback(
    (id: string, options?: { shiftKey?: boolean; rangeIds?: string[] }) => {
      setSelectedIds((current) => {
        if (options?.shiftKey && options.rangeIds && options.rangeIds.length > 0) {
          const next = new Set(current);
          for (const rangeId of options.rangeIds) next.add(rangeId);
          return next;
        }

        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    [],
  );

  const selectAllEntries = useCallback(() => {
    const node = tree.nodes[selectedPrefix];
    const next = new Set<string>();
    for (const folder of node?.folders ?? []) {
      next.add(hubSelectId({ kind: "folder", prefix: folder.prefix }));
    }
    for (const file of node?.files ?? []) {
      next.add(hubSelectId({ kind: "file", key: file.key }));
    }
    setSelectedIds(next);
  }, [selectedPrefix, tree.nodes]);

  const requestBulkDelete = useCallback(() => {
    if (selectedIds.size === 0) return;
    const node = tree.nodes[selectedPrefix];
    const folders = node?.folders ?? [];
    const files = node?.files ?? [];
    const nameById = new Map<string, string>();
    for (const folder of folders) {
      nameById.set(hubSelectId({ kind: "folder", prefix: folder.prefix }), folder.name);
    }
    for (const file of files) {
      nameById.set(hubSelectId({ kind: "file", key: file.key }), file.name);
    }

    const { files: fileKeys, folders: folderPrefixes } = selectionFromIds(selectedIds);
    const names = [...selectedIds].map((id) => {
      const item = parseHubSelectId(id);
      if (!item) return id;
      return nameById.get(id) ?? (item.kind === "file" ? item.key : item.prefix);
    });

    setConfirm({
      kind: "bulk-delete",
      files: fileKeys,
      folders: folderPrefixes,
      names,
      fileCount: fileKeys.length,
      folderCount: folderPrefixes.length,
    });
  }, [selectedIds, selectedPrefix, tree.nodes]);

  const copyKey = useCallback(
    async (key: string) => {
      try {
        if (!navigator.clipboard?.writeText) {
          throw new Error("This browser will not allow copying from here.");
        }
        await navigator.clipboard.writeText(key);
        toast.success("Copied the object key.");
      } catch (error) {
        toast.error(errorMessage(error));
      }
    },
    [toast],
  );

  const onPromptCommit = useCallback(
    (value: string) => {
      if (!namePrompt) return;

      if (value === namePrompt.name) {
        setNamePrompt(null);
        return;
      }

      if (namePrompt.kind === "file") {
        void runRenameObject(namePrompt.key, value);
        return;
      }

      setNamePrompt(null);
      setConfirm({
        kind: "rename",
        prefix: namePrompt.prefix,
        name: namePrompt.name,
        newName: value,
      });
    },
    [namePrompt, runRenameObject],
  );

  const onEditCommit = useCallback(
    (value: string) => {
      if (!edit) return;

      if (edit.mode === "create") {
        void runCreate(edit.parentPrefix, value);
        return;
      }

      if (value === edit.initialName) {
        setEdit(null);
        return;
      }

      setConfirm({
        kind: "rename",
        prefix: edit.prefix,
        name: folderNameOf(edit.prefix),
        newName: value,
      });
    },
    [edit, runCreate],
  );

  const closeMenu = useCallback(() => setMenu(null), []);

  const selectedNode = tree.nodes[selectedPrefix];
  const selectedName = selectedPrefix === ROOT_PREFIX ? ROOT_LABEL : folderNameOf(selectedPrefix);
  const listLoading = !selectedNode || selectedNode.status === "loading";
  const listError = selectedNode?.status === "error" ? selectedNode.error : null;
  const folders = selectedNode?.folders ?? [];
  const files = selectedNode?.files ?? [];

  const openListMenu = useCallback(
    (target: FileListTarget, x: number, y: number) => {
      if (target.kind === "file") {
        setMenu({ target, x, y });
        return;
      }

      const folder =
        target.kind === "folder"
          ? { prefix: target.prefix, name: target.name, isRoot: false }
          : {
              prefix: selectedPrefix,
              name: folderNameOf(selectedPrefix),
              isRoot: selectedPrefix === ROOT_PREFIX,
            };

      setMenu({ target: { kind: "folder", source: "pane", ...folder }, x, y });
    },
    [selectedPrefix],
  );

  const menuItems = useMemo<ContextMenuItem[]>(() => {
    if (!menu) return [];
    const { target } = menu;

    if (target.kind === "file") {
      return [
        {
          id: "open",
          label: "Open",
          icon: Eye,
          onSelect: () =>
            setViewer({
              key: target.key,
              name: target.name,
              size: target.size,
              lastModified: target.lastModified,
            }),
        },
        {
          id: "rename",
          label: "Rename",
          icon: Pencil,
          disabled: pending,
          onSelect: () => setNamePrompt({ kind: "file", key: target.key, name: target.name }),
        },
        {
          id: "delete",
          label: "Delete",
          icon: Trash2,
          danger: true,
          disabled: pending,
          onSelect: () => setConfirm({ kind: "delete-file", key: target.key, name: target.name }),
        },
        {
          id: "copy-key",
          label: "Copy key",
          icon: Copy,
          onSelect: () => void copyKey(target.key),
        },
      ];
    }

    const items: ContextMenuItem[] = [
      {
        id: "create",
        label: "New folder",
        icon: FolderPlus,
        disabled: pending,
        onSelect: () => startCreate(target.prefix),
      },
    ];

    if (!target.isRoot) {
      items.push({
        id: "rename",
        label: "Rename",
        icon: Pencil,
        disabled: pending,
        onSelect: () =>
          target.source === "tree"
            ? setEdit({ mode: "rename", prefix: target.prefix, initialName: target.name })
            : setNamePrompt({ kind: "folder", prefix: target.prefix, name: target.name }),
      });
      items.push({
        id: "delete",
        label: "Delete",
        icon: Trash2,
        danger: true,
        disabled: pending,
        onSelect: () => setConfirm({ kind: "delete", prefix: target.prefix, name: target.name }),
      });
    }

    return items;
  }, [copyKey, menu, pending, startCreate]);

  return (
    <div className="flex h-[calc(100vh-6.5rem)] min-h-[30rem] gap-4">
      <aside className="flex w-72 shrink-0 flex-col overflow-hidden rounded-lg border border-hairline bg-panel">
        <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-hairline px-3">
          <h2 className="text-xs font-medium uppercase tracking-wide text-subtle">Folders</h2>
          <div className="flex items-center gap-1">
            <button
              type="button"
              title={`New folder in ${selectedName}`}
              aria-label={`New folder in ${selectedName}`}
              disabled={pending}
              onClick={() => startCreate(selectedPrefix)}
              className="rounded-md p-1.5 text-subtle transition-colors duration-150 hover:bg-raised hover:text-ink disabled:pointer-events-none disabled:opacity-40"
            >
              <FolderPlus aria-hidden className="size-3.5" />
            </button>
            <button
              type="button"
              title="Refresh this folder"
              aria-label="Refresh this folder"
              disabled={pending || listLoading}
              onClick={() => void refresh(selectedPrefix)}
              className="rounded-md p-1.5 text-subtle transition-colors duration-150 hover:bg-raised hover:text-ink disabled:pointer-events-none disabled:opacity-40"
            >
              <RefreshCw
                aria-hidden
                className={cn("size-3.5", listLoading && "animate-spin")}
              />
            </button>
          </div>
        </div>

        <div
          className="min-h-0 flex-1 overflow-auto"
          onContextMenu={(event) => {
            event.preventDefault();
            setMenu({
              target: {
                kind: "folder",
                source: "tree",
                prefix: ROOT_PREFIX,
                name: ROOT_LABEL,
                isRoot: true,
              },
              x: event.clientX,
              y: event.clientY,
            });
          }}
        >
          <FolderTree
            tree={tree}
            selectedPrefix={selectedPrefix}
            edit={edit}
            editBusy={pending || confirm !== null}
            onSelect={selectFolder}
            onOpenFile={setViewer}
            onOpenMenu={(target, x, y) => {
              if (target.kind === "file") {
                setMenu({ target, x, y });
                return;
              }
              setMenu({
                target: {
                  kind: "folder",
                  source: "tree",
                  prefix: target.prefix,
                  name: target.name,
                  isRoot: target.isRoot,
                },
                x,
                y,
              });
            }}
            onEditCommit={onEditCommit}
            onEditCancel={() => setEdit(null)}
          />
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-hairline bg-panel">
        <div className="flex h-11 shrink-0 items-center justify-between gap-4 border-b border-hairline px-2 pr-3">
          <Breadcrumbs prefix={selectedPrefix} onNavigate={selectFolder} className="min-w-0" />
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-[11px] text-subtle">
              {listError
                ? null
                : selectedNode
                  ? `${pluralize(folders.length, "folder")} · ${pluralize(files.length, "file")}`
                  : "Loading"}
            </span>
            <Button
              variant="ghost"
              size="sm"
              loading={listLoading}
              disabled={pending}
              onClick={() => void refresh(selectedPrefix)}
              aria-label="Refresh this folder"
            >
              {listLoading ? null : <RefreshCw aria-hidden className="size-3.5" />}
              Refresh
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          <FileList
            folders={folders}
            files={files}
            loading={listLoading}
            error={listError}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onSelectAll={selectAllEntries}
            onClearSelection={clearSelection}
            onDeleteSelected={requestBulkDelete}
            onOpenFolder={openFolder}
            onOpenFile={setViewer}
            onOpenMenu={openListMenu}
            onRetry={() => void refresh(selectedPrefix)}
          />
        </div>
      </section>

      {viewer ? (
        <FileViewer
          key={viewer.key}
          file={viewer}
          onClose={() => setViewer(null)}
          onSaved={() => void refresh(selectedPrefix)}
        />
      ) : null}

      <ContextMenu
        open={menu !== null}
        x={menu?.x ?? 0}
        y={menu?.y ?? 0}
        items={menuItems}
        label={menu?.target.kind === "file" ? "File actions" : "Folder actions"}
        onClose={closeMenu}
      />

      {namePrompt ? (
        <RenamePrompt
          key={namePrompt.kind === "file" ? namePrompt.key : namePrompt.prefix}
          target={namePrompt}
          pending={pending}
          onCommit={onPromptCommit}
          onCancel={() => {
            if (!pending) setNamePrompt(null);
          }}
        />
      ) : null}

      <Modal
        open={confirm?.kind === "rename"}
        onClose={() => {
          if (!pending) setConfirm(null);
        }}
        title="Rename folder"
        description="R2 has no native rename."
        footer={
          <>
            <Button variant="ghost" disabled={pending} onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              loading={pending}
              onClick={() => {
                if (confirm?.kind === "rename") void runRename(confirm.prefix, confirm.newName);
              }}
            >
              Rename folder
            </Button>
          </>
        }
      >
        {confirm?.kind === "rename" ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted">
              Every object under{" "}
              <code className="font-mono text-xs text-ink">{confirm.prefix}</code> will be copied to{" "}
              <code className="font-mono text-xs text-ink">
                {`${parentPrefixOf(confirm.prefix)}${confirm.newName}/`}
              </code>{" "}
              and the originals will then be deleted.
            </p>
            <p className="text-xs text-muted">
              This is a real data move, not a label change, and it is not atomic. If it fails
              partway, some objects can be left under both prefixes.
            </p>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={confirm?.kind === "delete"}
        onClose={() => {
          if (!pending) setConfirm(null);
        }}
        title="Delete folder"
        description="This cannot be undone."
        footer={
          <>
            <Button variant="ghost" disabled={pending} onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={pending}
              onClick={() => {
                if (confirm?.kind === "delete") void runDelete(confirm.prefix);
              }}
            >
              Delete permanently
            </Button>
          </>
        }
      >
        {confirm?.kind === "delete" ? (
          <p className="text-sm text-muted">
            <code className="font-mono text-xs text-ink">{confirm.prefix}</code> and every object
            inside it will be permanently deleted from the bucket.
          </p>
        ) : null}
      </Modal>

      <Modal
        open={confirm?.kind === "delete-file"}
        onClose={() => {
          if (!pending) setConfirm(null);
        }}
        title="Delete file"
        description="This cannot be undone."
        footer={
          <>
            <Button variant="ghost" disabled={pending} onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={pending}
              onClick={() => {
                if (confirm?.kind !== "delete-file") return;
                void runDeleteObject(confirm.key, confirm.name);
              }}
            >
              Delete permanently
            </Button>
          </>
        }
      >
        {confirm?.kind === "delete-file" ? (
          <p className="text-sm text-muted">
            <code className="font-mono text-xs text-ink">{confirm.key}</code> will be permanently
            deleted from the bucket.
          </p>
        ) : null}
      </Modal>

      <Modal
        open={confirm?.kind === "bulk-delete"}
        onClose={() => {
          if (!pending) setConfirm(null);
        }}
        title="Delete selected"
        description="This cannot be undone."
        footer={
          <>
            <Button variant="ghost" disabled={pending} onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={pending}
              onClick={() => {
                if (confirm?.kind !== "bulk-delete") return;
                void runBulkDelete(confirm.files, confirm.folders);
              }}
            >
              Delete permanently
            </Button>
          </>
        }
      >
        {confirm?.kind === "bulk-delete" ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted">
              {formatBulkSelectionLabel(confirm.folderCount, confirm.fileCount)} will be
              permanently deleted from the bucket
              {confirm.folderCount > 0
                ? ", including every object inside the selected folders"
                : ""}
              .
            </p>
            <ul className="max-h-40 overflow-auto rounded-md border border-hairline bg-raised/40 px-3 py-2">
              {confirm.names.slice(0, BULK_DELETE_NAME_PREVIEW).map((name, index) => (
                <li key={`${name}:${index}`} className="truncate font-mono text-xs text-ink">
                  {name}
                </li>
              ))}
              {confirm.names.length > BULK_DELETE_NAME_PREVIEW ? (
                <li className="pt-1 text-xs text-subtle">
                  and {confirm.names.length - BULK_DELETE_NAME_PREVIEW} more
                </li>
              ) : null}
            </ul>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function RenamePrompt({
  target,
  pending,
  onCommit,
  onCancel,
}: {
  target: PromptTarget;
  pending: boolean;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(target.name);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, []);

  function submit() {
    const problem = validateEntryName(value, target.kind);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    onCommit(value.trim());
  }

  const isFile = target.kind === "file";
  const label = isFile ? "File name" : "Folder name";

  return (
    <Modal
      open
      onClose={onCancel}
      title={isFile ? "Rename file" : "Rename folder"}
      description={
        isFile
          ? "The object is copied to the new key, then the original is deleted."
          : "R2 has no native rename."
      }
      footer={
        <>
          <Button variant="ghost" disabled={pending} onClick={onCancel}>
            Cancel
          </Button>
          <Button loading={pending} onClick={submit}>
            {isFile ? "Rename file" : "Continue"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        <p className="truncate text-xs text-subtle">
          <code className="font-mono text-ink">
            {target.kind === "file" ? target.key : target.prefix}
          </code>
        </p>
        <Input
          ref={inputRef}
          value={value}
          disabled={pending}
          invalid={error !== null}
          placeholder={label}
          aria-label={label}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => {
            setValue(event.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              submit();
            }
          }}
        />
        <p className={cn("text-[11px]", error ? "text-danger" : "text-subtle")}>
          {error ?? "Enter to save · Esc to cancel"}
        </p>
      </div>
    </Modal>
  );
}
