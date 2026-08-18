"use client";

import {
  Boxes,
  Check,
  Database,
  HardDrive,
  Plus,
  Plug,
  RefreshCw,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MouseEvent as ReactMouseEvent,
  type SetStateAction,
} from "react";
import { ContextMenu, type ContextMenuItem } from "@/components/ContextMenu";
import { SupabaseDashboardSection } from "@/components/supabase/SupabaseDashboardSection";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/components/ui/Toast";
import { EMPTY_VALUE, formatBytes, formatCount } from "@/lib/format";
import {
  createBucket,
  deleteBucket,
  errorMessage,
  getFullStats,
  getQuickStats,
  listBuckets,
  switchBucket,
} from "@/lib/r2-client";
import type { BucketInfo, BucketObjectHint, StatsResponse } from "@/lib/types";
import { cn } from "@/lib/cn";

type ProbeState = {
  bucket: string;
  connected: boolean;
  error?: string;
};

type TotalsState = {
  objectCount: number;
  totalSize: number;
};

type BucketMenuState = {
  name: string;
  x: number;
  y: number;
};

export default function DashboardPage() {
  const toast = useToast();
  const [probe, setProbe] = useState<ProbeState | null>(null);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [totals, setTotals] = useState<TotalsState | null>(null);
  const [totalsLoading, setTotalsLoading] = useState(true);
  const [totalsError, setTotalsError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [buckets, setBuckets] = useState<BucketInfo[]>([]);
  const [activeBucket, setActiveBucket] = useState<string | null>(null);
  const [bucketsLoading, setBucketsLoading] = useState(true);
  const [bucketsError, setBucketsError] = useState<string | null>(null);
  const [switchingTo, setSwitchingTo] = useState<string | null>(null);
  const [switchTarget, setSwitchTarget] = useState<string | null>(null);
  const [menu, setMenu] = useState<BucketMenuState | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [supabaseRefreshKey, setSupabaseRefreshKey] = useState(0);
  const fullRequestId = useRef(0);

  const loadBuckets = useCallback(async () => {
    setBucketsLoading(true);
    setBucketsError(null);
    try {
      const result = await listBuckets();
      setBuckets(result.buckets);
      setActiveBucket(result.active);
    } catch (error) {
      setBucketsError(errorMessage(error));
    } finally {
      setBucketsLoading(false);
    }
  }, []);

  const loadFullStats = useCallback(async (fresh = false) => {
    const requestId = ++fullRequestId.current;
    setTotalsLoading(true);
    setTotalsError(null);
    try {
      const stats = await getFullStats({ fresh });
      if (requestId !== fullRequestId.current) return;
      applyStats(stats, setProbe, setTotals, setTotalsError);
    } catch (error) {
      if (requestId !== fullRequestId.current) return;
      setTotalsError(errorMessage(error));
    } finally {
      if (requestId === fullRequestId.current) setTotalsLoading(false);
    }
  }, []);

  const refreshActiveStats = useCallback(async () => {
    setRefreshing(true);
    setTotals(null);
    try {
      const quick = await getQuickStats();
      setProbe({
        bucket: quick.bucket,
        connected: quick.connected,
        error: quick.error,
      });
      setProbeError(null);
      await loadFullStats(true);
    } catch (error) {
      setProbeError(errorMessage(error));
    } finally {
      setRefreshing(false);
    }
  }, [loadFullStats]);

  useEffect(() => {
    let active = true;
    const requestId = ++fullRequestId.current;

    listBuckets()
      .then((result) => {
        if (!active) return;
        setBuckets(result.buckets);
        setActiveBucket(result.active);
        setBucketsError(null);
        setBucketsLoading(false);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setBucketsError(errorMessage(error));
        setBucketsLoading(false);
      });

    getQuickStats()
      .then((stats) => {
        if (!active) return;
        setProbe({
          bucket: stats.bucket,
          connected: stats.connected,
          error: stats.error,
        });
        setProbeError(null);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setProbeError(errorMessage(error));
      });

    getFullStats()
      .then((stats) => {
        if (!active || requestId !== fullRequestId.current) return;
        applyStats(stats, setProbe, setTotals, setTotalsError);
        setTotalsLoading(false);
      })
      .catch((error: unknown) => {
        if (!active || requestId !== fullRequestId.current) return;
        setTotalsError(errorMessage(error));
        setTotalsLoading(false);
      });

    return () => {
      active = false;
      fullRequestId.current += 1;
    };
  }, []);

  const refreshStats = useCallback(async () => {
    setRefreshing(true);
    setSupabaseRefreshKey((key) => key + 1);
    try {
      const quick = await getQuickStats();
      setProbe({
        bucket: quick.bucket,
        connected: quick.connected,
        error: quick.error,
      });
      setProbeError(null);
      await Promise.all([loadFullStats(true), loadBuckets()]);
    } catch (error) {
      setProbeError(errorMessage(error));
    } finally {
      setRefreshing(false);
    }
  }, [loadBuckets, loadFullStats]);

  const selectBucket = useCallback(
    (name: string) => {
      if (name === activeBucket || switchingTo || deleting) return;
      setSwitchTarget(name);
    },
    [activeBucket, deleting, switchingTo],
  );

  const confirmSwitch = useCallback(async () => {
    if (!switchTarget || switchingTo || deleting) return;
    const name = switchTarget;
    setSwitchingTo(name);
    try {
      const result = await switchBucket(name);
      setActiveBucket(result.bucket);
      setSwitchTarget(null);
      toast.success(`Switched to “${result.bucket}”.`);
      await Promise.all([refreshActiveStats(), loadBuckets()]);
    } catch (error) {
      const message = errorMessage(error);
      toast.error(message);
    } finally {
      setSwitchingTo(null);
    }
  }, [deleting, loadBuckets, refreshActiveStats, switchTarget, switchingTo, toast]);

  const openCreate = useCallback(() => setCreateOpen(true), []);
  const closeCreate = useCallback(() => setCreateOpen(false), []);

  const onBucketCreated = useCallback(
    async (bucket: string) => {
      setCreateOpen(false);
      setActiveBucket(bucket);
      await Promise.all([refreshActiveStats(), loadBuckets()]);
    },
    [loadBuckets, refreshActiveStats],
  );

  const closeMenu = useCallback(() => setMenu(null), []);

  const openBucketMenu = useCallback(
    (event: ReactMouseEvent, name: string) => {
      event.preventDefault();
      event.stopPropagation();
      if (switchingTo || deleting) return;
      setMenu({ name, x: event.clientX, y: event.clientY });
    },
    [deleting, switchingTo],
  );

  const menuItems = useMemo<ContextMenuItem[]>(() => {
    if (!menu) return [];
    const onlyBucket = buckets.length <= 1;
    const busy = switchingTo !== null || deleting;
    return [
      {
        id: "delete",
        label: "Delete",
        icon: Trash2,
        danger: true,
        disabled: onlyBucket || busy,
        onSelect: () => {
          if (onlyBucket) {
            toast.error("Cannot delete the only remaining bucket.");
            return;
          }
          if (busy) {
            toast.error("Wait for the current bucket operation to finish.");
            return;
          }
          setDeleteTarget(menu.name);
        },
      },
    ];
  }, [buckets.length, deleting, menu, switchingTo, toast]);

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget || deleting || switchingTo) return;
    const name = deleteTarget;
    const wasActive = name === activeBucket;
    setDeleting(true);
    try {
      await deleteBucket(name);
      setDeleteTarget(null);
      const result = await listBuckets();
      setBuckets(result.buckets);
      setActiveBucket(result.active);
      if (wasActive) {
        toast.success(
          result.active
            ? `Deleted “${name}”. Switched to “${result.active}”.`
            : `Deleted “${name}”.`,
        );
        await refreshActiveStats();
      } else {
        toast.success(`Deleted “${name}”.`);
      }
    } catch (error) {
      const message = errorMessage(error);
      toast.error(message);
    } finally {
      setDeleting(false);
    }
  }, [activeBucket, deleteTarget, deleting, refreshActiveStats, switchingTo, toast]);

  const probeReady = probe !== null;
  const connected = probe?.connected === true;
  let failure: string | null = null;
  if (probeError) failure = probeError;
  else if (probe && !probe.connected) failure = probe.error ?? "The bucket could not be reached.";
  else if (totalsError) failure = totalsError;

  const totalsPending = totalsLoading && totals === null && probeReady && connected;
  const objectsValue =
    totals !== null ? formatCount(totals.objectCount) : totalsPending ? "Calculating…" : EMPTY_VALUE;
  const sizeValue =
    totals !== null ? formatBytes(totals.totalSize) : totalsPending ? "Calculating…" : EMPTY_VALUE;
  const bucketBusy = switchingTo !== null || deleting;

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold text-ink">Dashboard</h2>
          <p className="text-xs text-muted">Live totals for the bucket this panel manages.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="ghost" size="sm" onClick={openCreate}>
            <Plus aria-hidden className="size-3.5" />
            Create bucket
          </Button>
          <Button
            variant="ghost"
            size="sm"
            loading={refreshing}
            onClick={() => void refreshStats()}
            disabled={!probeReady && !probeError}
          >
            {refreshing ? null : <RefreshCw aria-hidden className="size-3.5" />}
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={HardDrive}
          label="Bucket"
          value={probe?.bucket || EMPTY_VALUE}
          loading={!probeReady && !probeError}
          mono
        />
        <StatCard
          icon={Boxes}
          label="Objects"
          value={objectsValue}
          loading={!probeReady && !probeError}
          calculating={totalsPending}
        />
        <StatCard
          icon={Database}
          label="Total size"
          value={sizeValue}
          loading={!probeReady && !probeError}
          calculating={totalsPending}
        />
        <StatCard
          icon={connected ? Plug : TriangleAlert}
          label="Connection"
          value={
            probeError || (probe && !probe.connected)
              ? "Unreachable"
              : connected
                ? "Connected"
                : EMPTY_VALUE
          }
          loading={!probeReady && !probeError}
          tone={
            !probeReady && !probeError
              ? "neutral"
              : connected
                ? "ok"
                : "danger"
          }
        />
      </div>

      {failure ? (
        <div className="flex flex-col gap-3 rounded-lg border border-danger/40 bg-danger/5 p-4">
          <div className="flex items-start gap-2">
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
            <div className="flex min-w-0 flex-col gap-1">
              <p className="text-sm font-medium text-danger">
                {totalsError && connected
                  ? "Could not load object totals"
                  : "Cannot reach the bucket"}
              </p>
              <p className="break-words text-xs text-muted">{failure}</p>
            </div>
          </div>
          {totalsError && connected ? (
            <div>
              <Button
                size="sm"
                variant="ghost"
                loading={totalsLoading}
                onClick={() => void loadFullStats(true)}
              >
                Retry
              </Button>
            </div>
          ) : (
            <p className="text-xs text-subtle">
              Check <code className="font-mono text-muted">.env.local</code> for{" "}
              <code className="font-mono text-muted">R2_ACCOUNT_ID</code>,{" "}
              <code className="font-mono text-muted">R2_ACCESS_KEY_ID</code>,{" "}
              <code className="font-mono text-muted">R2_SECRET_ACCESS_KEY</code>, and{" "}
              <code className="font-mono text-muted">R2_BUCKET_NAME</code>, then restart the
              dev server. Settings shows which variables are set.
            </p>
          )}
        </div>
      ) : null}

      {connected && !totalsError ? (
        <p className="text-xs text-subtle">
          Object count and total size are computed by listing every key in the bucket, so both grow
          slower as the bucket grows.
        </p>
      ) : null}

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold text-ink">Buckets</h3>
          <p className="text-xs text-muted">
            All R2 buckets on this account. Click one to make it active for this panel. Right-click
            to delete.
          </p>
        </div>

        {bucketsError ? (
          <div className="flex items-start justify-between gap-3 rounded-lg border border-danger/40 bg-danger/5 p-4">
            <div className="flex min-w-0 items-start gap-2">
              <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
              <div className="flex min-w-0 flex-col gap-1">
                <p className="text-sm font-medium text-danger">Could not list buckets</p>
                <p className="break-words text-xs text-muted">{bucketsError}</p>
              </div>
            </div>
            <Button size="sm" variant="ghost" onClick={() => void loadBuckets()}>
              Retry
            </Button>
          </div>
        ) : bucketsLoading && buckets.length === 0 ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : buckets.length === 0 ? (
          <p className="rounded-lg border border-hairline bg-panel px-4 py-6 text-center text-xs text-muted">
            No buckets found for these credentials.
          </p>
        ) : (
          <ul className="divide-y divide-hairline overflow-hidden rounded-lg border border-hairline bg-panel">
            {buckets.map((bucket) => {
              const isActive = bucket.name === activeBucket;
              const busy = switchingTo === bucket.name;
              return (
                <li key={bucket.name}>
                  <button
                    type="button"
                    aria-current={isActive ? "true" : undefined}
                    onClick={() => {
                      if (!isActive && !bucketBusy) selectBucket(bucket.name);
                    }}
                    onContextMenu={(event) => openBucketMenu(event, bucket.name)}
                    className={cn(
                      "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors",
                      isActive ? "bg-accent/10" : "hover:bg-raised",
                      bucketBusy && !isActive ? "opacity-50" : null,
                    )}
                  >
                    <HardDrive
                      aria-hidden
                      className={cn("size-3.5 shrink-0", isActive ? "text-accent" : "text-subtle")}
                    />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span
                        className={cn(
                          "truncate font-mono text-sm",
                          isActive ? "text-ink" : "text-muted",
                        )}
                      >
                        {bucket.name}
                      </span>
                      <span className="text-[11px] text-subtle">
                        {objectHintLabel(bucket.objectHint)}
                        {bucket.creationDate
                          ? ` · created ${formatCreated(bucket.creationDate)}`
                          : null}
                      </span>
                    </div>
                    {busy ? (
                      <span className="text-[11px] text-subtle">Switching…</span>
                    ) : isActive ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-accent">
                        <Check aria-hidden className="size-3" />
                        Active
                      </span>
                    ) : (
                      <span className="text-[11px] text-subtle">Switch</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <SupabaseDashboardSection refreshKey={supabaseRefreshKey} />

      <ContextMenu
        open={menu !== null}
        x={menu?.x ?? 0}
        y={menu?.y ?? 0}
        items={menuItems}
        label="Bucket actions"
        onClose={closeMenu}
      />

      <Modal
        open={switchTarget !== null}
        onClose={() => {
          if (!switchingTo) setSwitchTarget(null);
        }}
        title="Switch bucket"
        description="Changes which bucket this panel manages."
        footer={
          <>
            <Button
              variant="ghost"
              disabled={switchingTo !== null}
              onClick={() => setSwitchTarget(null)}
            >
              Cancel
            </Button>
            <Button loading={switchingTo !== null} onClick={() => void confirmSwitch()}>
              Switch
            </Button>
          </>
        }
      >
        {switchTarget ? (
          <p className="text-sm text-muted">
            Switch this panel to bucket{" "}
            <code className="font-mono text-xs text-ink">{switchTarget}</code>?
          </p>
        ) : null}
      </Modal>

      <Modal
        open={deleteTarget !== null}
        onClose={() => {
          if (!deleting) setDeleteTarget(null);
        }}
        title="Delete bucket"
        description="This cannot be undone. The bucket must be empty."
        footer={
          <>
            <Button
              variant="ghost"
              disabled={deleting}
              onClick={() => setDeleteTarget(null)}
            >
              Cancel
            </Button>
            <Button variant="danger" loading={deleting} onClick={() => void confirmDelete()}>
              Delete
            </Button>
          </>
        }
      >
        {deleteTarget ? (
          <p className="text-sm text-muted">
            Permanently delete bucket{" "}
            <code className="font-mono text-xs text-ink">{deleteTarget}</code>
            {deleteTarget === activeBucket
              ? "? This is the active bucket — the panel will switch to another remaining bucket."
              : "?"}
          </p>
        ) : null}
      </Modal>

      <CreateBucketModal
        open={createOpen}
        onClose={closeCreate}
        onCreated={onBucketCreated}
      />
    </div>
  );
}

function CreateBucketModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (bucket: string) => Promise<void>;
}) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open && !wasOpen.current) {
      setName("");
      setError(null);
      setCreating(false);
    }
    wasOpen.current = open;
  }, [open]);

  const handleClose = useCallback(() => {
    if (!creating) onClose();
  }, [creating, onClose]);

  const submit = useCallback(async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Bucket name is required.");
      return;
    }

    setCreating(true);
    setError(null);
    try {
      const result = await createBucket(trimmed);
      toast.success(`Created bucket “${result.bucket}”.`);
      setName("");
      setError(null);
      await onCreated(result.bucket);
    } catch (err) {
      const message = errorMessage(err);
      setError(message);
      toast.error(message);
    } finally {
      setCreating(false);
    }
  }, [name, onCreated, toast]);

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Create bucket"
      description="Creates an R2 bucket and switches this panel to it."
      footer={
        <>
          <Button variant="ghost" disabled={creating} onClick={handleClose}>
            Cancel
          </Button>
          <Button loading={creating} onClick={() => void submit()}>
            Create
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        <Input
          value={name}
          disabled={creating}
          invalid={error !== null}
          placeholder="my-bucket-name"
          aria-label="Bucket name"
          spellCheck={false}
          autoComplete="off"
          autoFocus
          onChange={(event) => {
            setName(event.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <p className={error ? "text-[11px] text-danger" : "text-[11px] text-subtle"}>
          {error ??
            "3–63 characters · lowercase letters, numbers, hyphens · no leading/trailing hyphen"}
        </p>
      </div>
    </Modal>
  );
}

function objectHintLabel(hint: BucketObjectHint): string {
  switch (hint) {
    case "empty":
      return "Empty";
    case "has-objects":
      return "Has objects";
    default:
      return "Unknown";
  }
}

function formatCreated(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function applyStats(
  stats: StatsResponse,
  setProbe: Dispatch<SetStateAction<ProbeState | null>>,
  setTotals: Dispatch<SetStateAction<TotalsState | null>>,
  setTotalsError: Dispatch<SetStateAction<string | null>>,
): void {
  setProbe({
    bucket: stats.bucket,
    connected: stats.connected,
    error: stats.error,
  });
  if (stats.connected && stats.objectCount !== null && stats.totalSize !== null) {
    setTotals({ objectCount: stats.objectCount, totalSize: stats.totalSize });
    setTotalsError(null);
    return;
  }
  setTotals(null);
  if (!stats.connected) {
    setTotalsError(stats.error ?? "The bucket could not be reached.");
  }
}

function StatCard({
  icon: Icon,
  label,
  value,
  loading,
  calculating = false,
  mono = false,
  tone = "neutral",
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  loading: boolean;
  calculating?: boolean;
  mono?: boolean;
  tone?: "neutral" | "ok" | "danger";
}) {
  const toneClass = tone === "ok" ? "text-ok" : tone === "danger" ? "text-danger" : "text-ink";

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-hairline bg-panel p-4">
      <div className="flex items-center gap-2 text-subtle">
        <Icon aria-hidden className="size-3.5" />
        <span className="text-[11px] uppercase tracking-wide">{label}</span>
      </div>
      {loading ? (
        <Skeleton className="h-6 w-24" />
      ) : (
        <p
          className={
            mono
              ? `truncate font-mono text-base ${toneClass}`
              : calculating
                ? "truncate text-base font-semibold text-subtle"
                : `truncate text-base font-semibold ${toneClass}`
          }
          title={value}
        >
          {value}
        </p>
      )}
    </div>
  );
}
