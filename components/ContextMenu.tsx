"use client";

import type { LucideIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { useIsClient } from "@/components/ui/use-is-client";

const EDGE_GAP = 8;

export type ContextMenuItem = {
  id: string;
  label: string;
  icon?: LucideIcon;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
};

export type ContextMenuProps = {
  open: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
  label?: string;
  onClose: () => void;
};

export function ContextMenu({ open, x, y, items, label, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const isClient = useIsClient();
  const requested = `${x}:${y}:${items.length}`;
  const [clamped, setClamped] = useState<{ key: string; x: number; y: number } | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    if (!menu) return;

    const { width, height } = menu.getBoundingClientRect();
    const maxX = Math.max(EDGE_GAP, window.innerWidth - width - EDGE_GAP);
    const maxY = Math.max(EDGE_GAP, window.innerHeight - height - EDGE_GAP);

    setClamped({
      key: requested,
      x: Math.min(Math.max(x, EDGE_GAP), maxX),
      y: Math.min(Math.max(y, EDGE_GAP), maxY),
    });
  }, [open, x, y, requested]);

  const placed = clamped?.key === requested ? clamped : null;

  useEffect(() => {
    if (!open) return;

    const firstEnabled = items.findIndex((item) => !item.disabled);
    if (firstEnabled >= 0) itemRefs.current[firstEnabled]?.focus({ preventScroll: true });

    const onPointerDown = (event: Event) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    const onScroll = (event: Event) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      onClose();
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("blur", onClose);
    window.addEventListener("resize", onClose);

    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("resize", onClose);
    };
  }, [open, items, onClose]);

  const moveFocus = useCallback(
    (from: number, step: number) => {
      const count = items.length;
      for (let offset = 1; offset <= count; offset += 1) {
        const index = (from + step * offset + count * count) % count;
        if (!items[index].disabled) {
          itemRefs.current[index]?.focus({ preventScroll: true });
          return;
        }
      }
    },
    [items],
  );

  function onItemKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveFocus(index, 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveFocus(index, -1);
    } else if (event.key === "Home") {
      event.preventDefault();
      moveFocus(-1, 1);
    } else if (event.key === "End") {
      event.preventDefault();
      moveFocus(0, -1);
    }
  }

  if (!isClient || !open || items.length === 0) return null;

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={label ?? "Folder actions"}
      style={{
        left: placed?.x ?? x,
        top: placed?.y ?? y,
        opacity: placed ? undefined : 0,
        pointerEvents: placed ? undefined : "none",
      }}
      onContextMenu={(event) => event.preventDefault()}
      className="fixed z-[70] min-w-44 overflow-hidden rounded-md border border-hairline-strong bg-panel py-1 shadow-xl shadow-black/60"
    >
      {items.map((item, index) => {
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            ref={(element) => {
              itemRefs.current[index] = element;
            }}
            type="button"
            role="menuitem"
            disabled={item.disabled}
            onKeyDown={(event) => onItemKeyDown(event, index)}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors duration-150",
              "disabled:pointer-events-none disabled:opacity-40",
              item.danger
                ? "text-danger hover:bg-danger/10"
                : "text-muted hover:bg-raised hover:text-ink",
            )}
          >
            {Icon ? <Icon aria-hidden className="size-3.5 shrink-0" /> : null}
            {item.label}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
