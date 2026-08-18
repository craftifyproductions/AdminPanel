"use client";

import { ChevronDown, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import type { ActivityLogGroup, ActivityLogRow } from "@/lib/activity-log-types";
import { cn } from "@/lib/cn";
import type { ApiError } from "@/lib/types";

type LogsResponse = {
  groups: ActivityLogGroup[];
  note?: string;
};

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatRelative(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const deltaSec = Math.round((date.getTime() - Date.now()) / 1000);
  const abs = Math.abs(deltaSec);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (abs < 60) return rtf.format(deltaSec, "second");
  if (abs < 3600) return rtf.format(Math.round(deltaSec / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(deltaSec / 3600), "hour");
  return rtf.format(Math.round(deltaSec / 86400), "day");
}

function EventRow({ event }: { event: ActivityLogRow }) {
  return (
    <li className="grid gap-1 border-b border-hairline px-4 py-3 last:border-b-0 sm:grid-cols-[9.5rem_8rem_1fr] sm:gap-3">
      <div className="flex flex-col">
        <time dateTime={event.created_at} className="font-mono text-[11px] text-ink">
          {formatWhen(event.created_at)}
        </time>
        <span className="text-[10px] text-subtle">{formatRelative(event.created_at)}</span>
      </div>
      <code className="self-start rounded border border-hairline bg-raised px-1.5 py-0.5 font-mono text-[11px] text-accent-ink">
        {event.action}
      </code>
      <div className="min-w-0">
        <p className="text-xs text-ink">{event.summary || "—"}</p>
        {event.path ? (
          <p className="mt-0.5 truncate font-mono text-[10px] text-subtle">{event.path}</p>
        ) : null}
      </div>
    </li>
  );
}

function UserGroup({
  group,
  expanded,
  onToggle,
}: {
  group: ActivityLogGroup;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-hairline bg-panel">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-raised/60"
      >
        <span
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-md border border-hairline bg-raised text-xs font-semibold text-accent-ink",
          )}
        >
          {group.email.slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink">{group.email}</span>
          <span className="block text-[11px] text-subtle">
            {group.count} event{group.count === 1 ? "" : "s"} · last{" "}
            {formatRelative(group.lastActivityAt)}
          </span>
        </span>
        <span className="hidden text-[11px] text-subtle sm:inline">
          {formatWhen(group.lastActivityAt)}
        </span>
        <ChevronDown
          aria-hidden
          className={cn(
            "size-4 shrink-0 text-subtle transition-transform duration-200",
            expanded && "rotate-180",
          )}
        />
      </button>

      {expanded ? (
        <ul className="border-t border-hairline bg-canvas/40">
          {group.events.map((event) => (
            <EventRow key={event.id} event={event} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

async function fetchLogs(emailFilter?: string): Promise<LogsResponse> {
  const params = new URLSearchParams();
  const email = emailFilter?.trim();
  if (email) params.set("email", email);
  const response = await fetch(`/api/logs${params.size ? `?${params}` : ""}`, {
    cache: "no-store",
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiError | null;
    throw new Error(body?.error ?? "Unable to load logs.");
  }
  return (await response.json()) as LogsResponse;
}

export function ActivityLogsPanel() {
  const [groups, setGroups] = useState<ActivityLogGroup[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [queryEmail, setQueryEmail] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let active = true;

    fetchLogs(queryEmail)
      .then((body) => {
        if (!active) return;
        setGroups(body.groups ?? []);
        setNote(body.note ?? null);
        setError(null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setGroups([]);
        setNote(null);
        setError(err instanceof Error ? err.message : "Unable to load logs.");
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [queryEmail, reloadToken]);

  const emails = useMemo(
    () => [...new Set(groups.map((group) => group.email))].sort((a, b) => a.localeCompare(b)),
    [groups],
  );

  const applyFilter = useCallback(() => {
    setLoading(true);
    setQueryEmail(filter.trim());
    setReloadToken((token) => token + 1);
  }, [filter]);

  const clearFilter = useCallback(() => {
    setFilter("");
    setLoading(true);
    setQueryEmail("");
    setReloadToken((token) => token + 1);
  }, []);

  const refresh = useCallback(() => {
    setLoading(true);
    setReloadToken((token) => token + 1);
  }, []);

  return (
    <div className="flex max-w-4xl flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-ink">Activity logs</h2>
        <p className="text-xs text-muted">
          Per-user audit trail of admin actions. Expand a user to see their chronological events.
          Any signed-in admin can view all logs.
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <label htmlFor="log-user-filter" className="text-xs font-medium text-muted">
            Filter by email
          </label>
          <Input
            id="log-user-filter"
            list="log-user-emails"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="All users"
            onKeyDown={(event) => {
              if (event.key === "Enter") applyFilter();
            }}
          />
          <datalist id="log-user-emails">
            {emails.map((email) => (
              <option key={email} value={email} />
            ))}
          </datalist>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="ghost" onClick={clearFilter}>
            Clear
          </Button>
          <Button type="button" onClick={applyFilter} loading={loading}>
            Apply
          </Button>
          <Button
            type="button"
            variant="ghost"
            aria-label="Refresh logs"
            onClick={refresh}
            disabled={loading}
          >
            <RefreshCw aria-hidden className={cn("size-4", loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger"
        >
          {error}
        </p>
      ) : null}

      {!error && note ? <p className="text-[11px] text-subtle">{note}</p> : null}

      {loading && groups.length === 0 && !error ? (
        <div className="rounded-lg border border-hairline bg-panel px-4 py-8 text-center text-xs text-muted">
          Loading activity…
        </div>
      ) : null}

      {!loading && !error && groups.length === 0 ? (
        <div className="rounded-lg border border-hairline bg-panel px-4 py-8 text-center text-xs text-muted">
          No activity logged yet. Actions after login will appear here once the{" "}
          <code className="font-mono text-subtle">admin_activity_logs</code> table is set up.
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        {groups.map((group) => {
          const key = group.email.toLowerCase();
          return (
            <UserGroup
              key={key}
              group={group}
              expanded={Boolean(expanded[key])}
              onToggle={() =>
                setExpanded((prev) => ({
                  ...prev,
                  [key]: !prev[key],
                }))
              }
            />
          );
        })}
      </div>
    </div>
  );
}
