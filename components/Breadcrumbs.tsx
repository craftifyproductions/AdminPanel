"use client";

import { ChevronRight, HardDrive } from "lucide-react";
import { cn } from "@/lib/cn";
import { ROOT_LABEL, ROOT_PREFIX, prefixSegments } from "@/lib/r2-client";

export type BreadcrumbsProps = {
  prefix: string;
  onNavigate: (prefix: string) => void;
  className?: string;
};

export function Breadcrumbs({ prefix, onNavigate, className }: BreadcrumbsProps) {
  const segments = prefixSegments(prefix);

  return (
    <nav aria-label="Breadcrumb" className={cn("min-w-0", className)}>
      <ol className="flex flex-wrap items-center gap-1">
        <li className="flex items-center">
          <Crumb
            label={ROOT_LABEL}
            current={segments.length === 0}
            onClick={() => onNavigate(ROOT_PREFIX)}
            icon
          />
        </li>

        {segments.map((segment, index) => (
          <li key={segment.prefix} className="flex min-w-0 items-center">
            <ChevronRight aria-hidden className="size-3.5 shrink-0 text-subtle" />
            <Crumb
              label={segment.name}
              current={index === segments.length - 1}
              onClick={() => onNavigate(segment.prefix)}
            />
          </li>
        ))}
      </ol>
    </nav>
  );
}

function Crumb({
  label,
  current,
  onClick,
  icon = false,
}: {
  label: string;
  current: boolean;
  onClick: () => void;
  icon?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={current ? "page" : undefined}
      className={cn(
        "flex max-w-56 items-center gap-1.5 truncate rounded-md px-2 py-1 text-xs transition-colors duration-150",
        current ? "text-ink" : "text-muted hover:bg-raised hover:text-ink",
      )}
    >
      {icon ? <HardDrive aria-hidden className="size-3.5 shrink-0 text-subtle" /> : null}
      <span className="truncate">{label}</span>
    </button>
  );
}
