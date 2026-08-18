"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ROOT_PREFIX, ancestorPrefixes, errorMessage, listFolder } from "@/lib/r2-client";
import type { R2File, R2Folder } from "@/lib/types";

export type TreeNodeStatus = "loading" | "loaded" | "error";

export type TreeNode = {
  status: TreeNodeStatus;
  folders: R2Folder[];
  files: R2File[];
  error: string | null;
};

export type FolderTreeStore = {
  nodes: Readonly<Record<string, TreeNode>>;
  expanded: ReadonlySet<string>;
  load: (prefix: string, force?: boolean) => Promise<void>;
  refresh: (prefix: string) => Promise<void>;
  toggle: (prefix: string) => void;
  expand: (prefix: string) => void;
  reveal: (prefix: string) => void;
  prune: (prefix: string) => void;
};

export function useFolderTree(): FolderTreeStore {
  const [nodes, setNodes] = useState<Record<string, TreeNode>>({});
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set<string>([ROOT_PREFIX]),
  );

  const nodesRef = useRef(nodes);
  const expandedRef = useRef(expanded);
  const inFlight = useRef(new Set<string>());
  const tickets = useRef(new Map<string, number>());

  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    expandedRef.current = expanded;
  }, [expanded]);

  const load = useCallback(async (prefix: string, force = false) => {
    if (!force && (inFlight.current.has(prefix) || nodesRef.current[prefix]?.status === "loaded")) {
      return;
    }

    const ticket = (tickets.current.get(prefix) ?? 0) + 1;
    tickets.current.set(prefix, ticket);
    inFlight.current.add(prefix);

    setNodes((current) => ({
      ...current,
      [prefix]: {
        status: "loading",
        folders: current[prefix]?.folders ?? [],
        files: current[prefix]?.files ?? [],
        error: null,
      },
    }));

    try {
      const data = await listFolder(prefix);
      if (tickets.current.get(prefix) !== ticket) return;
      setNodes((current) => ({
        ...current,
        [prefix]: { status: "loaded", folders: data.folders, files: data.files, error: null },
      }));
    } catch (error) {
      if (tickets.current.get(prefix) !== ticket) return;
      setNodes((current) => ({
        ...current,
        [prefix]: { status: "error", folders: [], files: [], error: errorMessage(error) },
      }));
    } finally {
      inFlight.current.delete(prefix);
    }
  }, []);

  const refresh = useCallback((prefix: string) => load(prefix, true), [load]);

  const expand = useCallback(
    (prefix: string) => {
      if (!expandedRef.current.has(prefix)) {
        setExpanded((current) => new Set(current).add(prefix));
      }
      void load(prefix);
    },
    [load],
  );

  const toggle = useCallback(
    (prefix: string) => {
      const isOpen = expandedRef.current.has(prefix);
      setExpanded((current) => {
        const next = new Set(current);
        if (isOpen) next.delete(prefix);
        else next.add(prefix);
        return next;
      });
      if (!isOpen) void load(prefix);
    },
    [load],
  );

  const reveal = useCallback(
    (prefix: string) => {
      const chain = ancestorPrefixes(prefix);
      setExpanded((current) => {
        const next = new Set(current);
        for (const ancestor of chain) next.add(ancestor);
        return next;
      });
      for (const ancestor of chain) void load(ancestor);
    },
    [load],
  );

  const prune = useCallback((prefix: string) => {
    if (prefix === ROOT_PREFIX) return;
    const matches = (candidate: string) => candidate === prefix || candidate.startsWith(prefix);

    setNodes((current) => {
      const next: Record<string, TreeNode> = {};
      for (const [key, value] of Object.entries(current)) {
        if (!matches(key)) next[key] = value;
      }
      return next;
    });

    setExpanded((current) => {
      const next = new Set<string>();
      for (const key of current) {
        if (!matches(key)) next.add(key);
      }
      return next;
    });

    for (const key of Array.from(tickets.current.keys())) {
      if (matches(key)) tickets.current.set(key, (tickets.current.get(key) ?? 0) + 1);
    }
  }, []);

  return useMemo(
    () => ({ nodes, expanded, load, refresh, toggle, expand, reveal, prune }),
    [nodes, expanded, load, refresh, toggle, expand, reveal, prune],
  );
}
