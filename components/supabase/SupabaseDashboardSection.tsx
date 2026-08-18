"use client";

import {
  Database,
  ExternalLink,
  Layers,
  Plug,
  RefreshCw,
  Rows3,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { EMPTY_VALUE, formatCount } from "@/lib/format";
import { errorMessage, getSupabaseOverview } from "@/lib/supabase-client";
import type { SupabaseOverviewResponse } from "@/lib/supabase-types";
import { cn } from "@/lib/cn";

const CHART_TOP_N = 8;
const BAR_COLOR = "#6366f1";
const PIE_COLORS = ["#6366f1", "#818cf8", "#a5b4fc", "#4f46e5", "#312e81", "#71717a", "#52525b", "#3f3f46"];

type ChartRow = {
  name: string;
  rows: number;
  shortName: string;
};

function truncateHost(host: string | null, max = 28): string {
  if (!host) return EMPTY_VALUE;
  if (host.length <= max) return host;
  return `${host.slice(0, max - 1)}…`;
}

function buildChartRows(tables: SupabaseOverviewResponse["tables"]): ChartRow[] {
  return tables
    .filter((table): table is { name: string; rowCount: number } => typeof table.rowCount === "number")
    .sort((a, b) => b.rowCount - a.rowCount)
    .slice(0, CHART_TOP_N)
    .map((table) => ({
      name: table.name,
      rows: table.rowCount,
      shortName: table.name.length > 14 ? `${table.name.slice(0, 13)}…` : table.name,
    }));
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value?: number | string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const value = payload[0]?.value;
  return (
    <div className="rounded-md border border-hairline bg-raised px-2.5 py-1.5 text-xs shadow-lg">
      <p className="font-mono text-ink">{label}</p>
      <p className="text-muted">{typeof value === "number" ? formatCount(value) : value} rows</p>
    </div>
  );
}

function PieTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number }>;
}) {
  if (!active || !payload?.length) return null;
  const item = payload[0];
  return (
    <div className="rounded-md border border-hairline bg-raised px-2.5 py-1.5 text-xs shadow-lg">
      <p className="font-mono text-ink">{item?.name}</p>
      <p className="text-muted">
        {typeof item?.value === "number" ? formatCount(item.value) : item?.value} rows
      </p>
    </div>
  );
}

export function SupabaseDashboardSection({ refreshKey = 0 }: { refreshKey?: number }) {
  const [overview, setOverview] = useState<SupabaseOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let active = true;

    getSupabaseOverview()
      .then((result) => {
        if (!active) return;
        setOverview(result);
        setError(null);
        setLoading(false);
        setRefreshing(false);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(errorMessage(err));
        setLoading(false);
        setRefreshing(false);
      });

    return () => {
      active = false;
    };
  }, [refreshKey]);

  const load = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const result = await getSupabaseOverview();
      setOverview(result);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setRefreshing(false);
    }
  }, []);

  const chartRows = useMemo(
    () => (overview?.configured ? buildChartRows(overview.tables) : []),
    [overview],
  );
  const pieTotal = useMemo(
    () => chartRows.reduce((sum, row) => sum + row.rows, 0),
    [chartRows],
  );

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold text-ink">Supabase</h3>
          <p className="text-xs text-muted">
            Project tables and approximate row counts. Open the full browser for row-level data.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href="/supabase"
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-hairline bg-transparent px-3 text-xs text-muted transition-colors hover:bg-panel hover:text-ink"
          >
            <ExternalLink aria-hidden className="size-3.5" />
            Open browser
          </Link>
          <Button
            variant="ghost"
            size="sm"
            loading={refreshing}
            onClick={() => void load()}
            aria-label="Refresh Supabase overview"
          >
            {refreshing ? null : <RefreshCw aria-hidden className="size-3.5" />}
            Refresh
          </Button>
        </div>
      </div>

      {loading && !overview ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Skeleton className="h-[88px] w-full" />
          <Skeleton className="h-[88px] w-full" />
          <Skeleton className="h-[88px] w-full" />
          <Skeleton className="h-[88px] w-full" />
        </div>
      ) : null}

      {error ? (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-danger/40 bg-danger/5 p-4">
          <div className="flex min-w-0 items-start gap-2">
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
            <div className="flex min-w-0 flex-col gap-1">
              <p className="text-sm font-medium text-danger">Could not load Supabase overview</p>
              <p className="break-words text-xs text-muted">{error}</p>
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      ) : null}

      {overview && !overview.configured ? (
        <div className="rounded-lg border border-hairline bg-panel p-5">
          <div className="flex items-start gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-hairline bg-raised text-subtle">
              <TriangleAlert aria-hidden className="size-4" />
            </span>
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium text-ink">Supabase is not configured</p>
              <p className="text-xs text-muted">
                Add these to <code className="font-mono text-subtle">.env.local</code> and restart
                the dev server:
              </p>
              <ul className="list-inside list-disc font-mono text-xs text-subtle">
                <li>SUPABASE_URL</li>
                <li>SUPABASE_SERVICE_ROLE_KEY</li>
                <li className="text-muted">SUPABASE_ANON_KEY (required for Auth login; optional data fallback)</li>
              </ul>
              {overview.missing.length > 0 ? (
                <p className="text-xs text-danger">Missing: {overview.missing.join(", ")}</p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {overview?.configured ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MiniStat
              icon={Database}
              label="Project URL"
              value={truncateHost(overview.host ?? overview.url)}
              title={overview.host ?? overview.url ?? undefined}
              mono
            />
            <MiniStat
              icon={Layers}
              label="Tables"
              value={formatCount(overview.tableCount)}
            />
            <MiniStat
              icon={Rows3}
              label="Approx. total rows"
              value={formatCount(overview.totalRows)}
            />
            <MiniStat
              icon={Plug}
              label="Connection"
              value={overview.usingServiceRole ? "Connected" : "Connected (anon)"}
              tone="ok"
            />
          </div>

          {overview.message ? (
            <p className="rounded-md border border-hairline bg-panel px-3 py-2 text-xs text-muted">
              {overview.message}
            </p>
          ) : null}

          {overview.listedTableCount < overview.tableCount ? (
            <p className="text-xs text-subtle">
              Showing row counts for the first {formatCount(overview.listedTableCount)} of{" "}
              {formatCount(overview.tableCount)} tables.
            </p>
          ) : null}

          {chartRows.length > 0 ? (
            <div className="grid gap-4 lg:grid-cols-5">
              <div className="flex flex-col gap-3 rounded-lg border border-hairline bg-panel p-4 lg:col-span-3">
                <div className="flex flex-col gap-0.5">
                  <p className="text-[11px] uppercase tracking-wide text-subtle">Rows per table</p>
                  <p className="text-xs text-muted">Top {chartRows.length} by approximate count</p>
                </div>
                <div className="h-56 w-full min-w-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={chartRows}
                      margin={{ top: 4, right: 8, left: 0, bottom: 4 }}
                    >
                      <XAxis
                        dataKey="shortName"
                        tick={{ fill: "#71717a", fontSize: 11 }}
                        axisLine={{ stroke: "#27272a" }}
                        tickLine={false}
                        interval={0}
                      />
                      <YAxis
                        tick={{ fill: "#71717a", fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                        width={48}
                        allowDecimals={false}
                      />
                      <Tooltip
                        content={<ChartTooltip />}
                        cursor={{ fill: "rgba(99, 102, 241, 0.08)" }}
                      />
                      <Bar dataKey="rows" fill={BAR_COLOR} radius={[4, 4, 0, 0]} maxBarSize={40} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="flex flex-col gap-3 rounded-lg border border-hairline bg-panel p-4 lg:col-span-2">
                <div className="flex flex-col gap-0.5">
                  <p className="text-[11px] uppercase tracking-wide text-subtle">Row share</p>
                  <p className="text-xs text-muted">
                    {pieTotal > 0
                      ? `${formatCount(pieTotal)} rows across top tables`
                      : "No counted rows yet"}
                  </p>
                </div>
                {pieTotal > 0 ? (
                  <div className="relative mx-auto h-52 w-full max-w-[220px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={chartRows}
                          dataKey="rows"
                          nameKey="name"
                          innerRadius={52}
                          outerRadius={78}
                          paddingAngle={2}
                          stroke="none"
                        >
                          {chartRows.map((entry, index) => (
                            <Cell
                              key={entry.name}
                              fill={PIE_COLORS[index % PIE_COLORS.length]}
                            />
                          ))}
                        </Pie>
                        <Tooltip content={<PieTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-lg font-semibold text-ink">
                        {formatCount(overview.totalRows)}
                      </span>
                      <span className="text-[11px] text-subtle">total</span>
                    </div>
                  </div>
                ) : (
                  <p className="py-10 text-center text-xs text-muted">No row counts available.</p>
                )}
                <ul className="flex flex-col gap-1.5">
                  {chartRows.slice(0, 5).map((row, index) => (
                    <li key={row.name} className="flex items-center gap-2 text-xs">
                      <span
                        className="size-2 shrink-0 rounded-sm"
                        style={{ backgroundColor: PIE_COLORS[index % PIE_COLORS.length] }}
                      />
                      <span className="min-w-0 flex-1 truncate font-mono text-muted">{row.name}</span>
                      <span className="shrink-0 text-subtle">{formatCount(row.rows)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : overview.tables.length === 0 ? (
            <p className="rounded-lg border border-hairline bg-panel px-4 py-6 text-center text-xs text-muted">
              No tables discovered for this project.
            </p>
          ) : (
            <p className="rounded-lg border border-hairline bg-panel px-4 py-6 text-center text-xs text-muted">
              Tables were found, but row counts could not be read.
            </p>
          )}
        </>
      ) : null}
    </section>
  );
}

function MiniStat({
  icon: Icon,
  label,
  value,
  title,
  mono = false,
  tone = "neutral",
}: {
  icon: typeof Database;
  label: string;
  value: string;
  title?: string;
  mono?: boolean;
  tone?: "neutral" | "ok";
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-hairline bg-panel p-4">
      <div className="flex items-center gap-2 text-subtle">
        <Icon aria-hidden className="size-3.5" />
        <span className="text-[11px] uppercase tracking-wide">{label}</span>
      </div>
      <p
        className={cn(
          "truncate text-base",
          mono ? "font-mono" : "font-semibold",
          tone === "ok" ? "text-ok" : "text-ink",
        )}
        title={title ?? value}
      >
        {value}
      </p>
    </div>
  );
}
