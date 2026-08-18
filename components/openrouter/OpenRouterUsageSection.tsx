"use client";

import {
  Calendar,
  CircleDollarSign,
  KeyRound,
  RefreshCw,
  Sparkles,
  TriangleAlert,
  Wallet,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
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
import { cn } from "@/lib/cn";
import { EMPTY_VALUE } from "@/lib/format";
import { errorMessage, getOpenRouterUsage } from "@/lib/openrouter-client";
import type { OpenRouterUsageResponse } from "@/lib/openrouter-usage";

const BAR_COLOR = "#6366f1";
const USED_COLOR = "#6366f1";
const REMAINING_COLOR = "#3f3f46";

const CREDITS_FORMAT = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 4,
});

function formatCredits(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return EMPTY_VALUE;
  return CREDITS_FORMAT.format(value);
}

function formatLimitReset(value: string | null): string {
  if (!value) return EMPTY_VALUE;
  return value.replace(/_/g, " ");
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
      <p className="text-ink">{label}</p>
      <p className="text-muted">
        {typeof value === "number" ? formatCredits(value) : value} credits
      </p>
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
      <p className="text-ink">{item?.name}</p>
      <p className="text-muted">
        {typeof item?.value === "number" ? formatCredits(item.value) : item?.value} credits
      </p>
    </div>
  );
}

export function OpenRouterUsageSection() {
  const [usage, setUsage] = useState<OpenRouterUsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (mode: "initial" | "refresh" = "refresh") => {
    if (mode === "refresh") setRefreshing(true);
    setError(null);
    try {
      const result = await getOpenRouterUsage();
      setUsage(result);
      if (result.error) setError(result.error);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let active = true;

    getOpenRouterUsage()
      .then((result) => {
        if (!active) return;
        setUsage(result);
        setError(result.error ?? null);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setError(errorMessage(err));
        setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const periodRows = useMemo(() => {
    if (!usage?.configured || usage.error) return [];
    return [
      { name: "Daily", credits: usage.usageDaily ?? 0 },
      { name: "Weekly", credits: usage.usageWeekly ?? 0 },
      { name: "Monthly", credits: usage.usageMonthly ?? 0 },
    ];
  }, [usage]);

  const limitGauge = useMemo(() => {
    if (!usage?.configured || usage.limit === null || usage.limit <= 0) return null;
    const remaining =
      usage.limitRemaining !== null
        ? Math.max(0, usage.limitRemaining)
        : Math.max(0, usage.limit - (usage.usage ?? 0));
    const used = Math.max(0, usage.limit - remaining);
    return [
      { name: "Used", value: used },
      { name: "Remaining", value: remaining },
    ];
  }, [usage]);

  const remainingDisplay = useMemo(() => {
    if (!usage?.configured) return EMPTY_VALUE;
    if (usage.limit === null && usage.creditsRemaining === null) return "Unlimited";
    return formatCredits(usage.creditsRemaining);
  }, [usage]);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold text-ink">OpenRouter</h2>
          <p className="text-xs text-muted">
            Live key usage and credit limits from OpenRouter. The API key stays on the server.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          loading={refreshing}
          onClick={() => void load("refresh")}
          aria-label="Refresh OpenRouter usage"
        >
          {refreshing ? null : <RefreshCw aria-hidden className="size-3.5" />}
          Refresh
        </Button>
      </div>

      {loading && !usage ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Skeleton className="h-[88px] w-full" />
          <Skeleton className="h-[88px] w-full" />
          <Skeleton className="h-[88px] w-full" />
          <Skeleton className="h-[88px] w-full" />
          <Skeleton className="h-[88px] w-full" />
        </div>
      ) : null}

      {error && usage?.configured !== false ? (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-danger/40 bg-danger/5 p-4">
          <div className="flex min-w-0 items-start gap-2">
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-danger" />
            <div className="flex min-w-0 flex-col gap-1">
              <p className="text-sm font-medium text-danger">Could not load OpenRouter usage</p>
              <p className="break-words text-xs text-muted">{error}</p>
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={() => void load("refresh")}>
            Retry
          </Button>
        </div>
      ) : null}

      {usage && !usage.configured ? (
        <div className="rounded-lg border border-hairline bg-panel p-5">
          <div className="flex items-start gap-3">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-hairline bg-raised text-subtle">
              <TriangleAlert aria-hidden className="size-4" />
            </span>
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium text-ink">OpenRouter is not configured</p>
              <p className="text-xs text-muted">
                Add <code className="font-mono text-subtle">OPENROUTER_API_KEY</code> to{" "}
                <code className="font-mono text-subtle">.env.local</code> and restart the
                server. Model IDs can be set under{" "}
                <Link href="/settings" className="text-accent underline-offset-2 hover:underline">
                  Settings
                </Link>
                .
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {usage?.configured && !usage.error ? (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <StatCard
              icon={KeyRound}
              label="Key label"
              value={usage.label ?? EMPTY_VALUE}
              mono
            />
            <StatCard
              icon={Wallet}
              label="Credits remaining"
              value={remainingDisplay}
            />
            <StatCard
              icon={CircleDollarSign}
              label="Used today"
              value={formatCredits(usage.usageDaily)}
            />
            <StatCard
              icon={Calendar}
              label="Used this month"
              value={formatCredits(usage.usageMonthly)}
            />
            <StatCard
              icon={Sparkles}
              label="All-time usage"
              value={formatCredits(usage.usage)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetaCard label="Key limit" value={usage.limit === null ? "Unlimited" : formatCredits(usage.limit)} />
            <MetaCard label="Limit reset" value={formatLimitReset(usage.limitReset)} />
            <MetaCard
              label="Tier"
              value={usage.isFreeTier === null ? EMPTY_VALUE : usage.isFreeTier ? "Free tier" : "Paid"}
              tone={usage.isFreeTier === false ? "ok" : "neutral"}
            />
            <MetaCard
              label="Account credits"
              value={
                usage.accountCredits.available
                  ? formatCredits(
                      (usage.accountCredits.totalCredits ?? 0) -
                        (usage.accountCredits.totalUsage ?? 0),
                    )
                  : "Unavailable"
              }
            />
          </div>

          {usage.message ? (
            <p className="rounded-md border border-hairline bg-panel px-3 py-2 text-xs text-muted">
              {usage.message}
            </p>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-5">
            <div className="flex flex-col gap-3 rounded-lg border border-hairline bg-panel p-4 lg:col-span-3">
              <div className="flex flex-col gap-0.5">
                <p className="text-[11px] uppercase tracking-wide text-subtle">Usage by period</p>
                <p className="text-xs text-muted">Daily, weekly, and monthly credit spend</p>
              </div>
              <div className="h-56 w-full min-w-0">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={periodRows} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                    <XAxis
                      dataKey="name"
                      tick={{ fill: "#71717a", fontSize: 11 }}
                      axisLine={{ stroke: "#27272a" }}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fill: "#71717a", fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      width={48}
                    />
                    <Tooltip
                      content={<ChartTooltip />}
                      cursor={{ fill: "rgba(99, 102, 241, 0.08)" }}
                    />
                    <Bar
                      dataKey="credits"
                      fill={BAR_COLOR}
                      radius={[4, 4, 0, 0]}
                      maxBarSize={48}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="flex flex-col gap-3 rounded-lg border border-hairline bg-panel p-4 lg:col-span-2">
              <div className="flex flex-col gap-0.5">
                <p className="text-[11px] uppercase tracking-wide text-subtle">Limit usage</p>
                <p className="text-xs text-muted">
                  {limitGauge
                    ? "Remaining vs used against the key limit"
                    : "No numeric key limit configured"}
                </p>
              </div>
              {limitGauge ? (
                <>
                  <div className="relative mx-auto h-52 w-full max-w-[220px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={limitGauge}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={52}
                          outerRadius={78}
                          paddingAngle={2}
                          stroke="none"
                        >
                          <Cell fill={USED_COLOR} />
                          <Cell fill={REMAINING_COLOR} />
                        </Pie>
                        <Tooltip content={<PieTooltip />} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-lg font-semibold text-ink">
                        {formatCredits(usage.limitRemaining)}
                      </span>
                      <span className="text-[11px] text-subtle">left</span>
                    </div>
                  </div>
                  <ul className="flex flex-col gap-1.5">
                    {limitGauge.map((row, index) => (
                      <li key={row.name} className="flex items-center gap-2 text-xs">
                        <span
                          className="size-2 shrink-0 rounded-sm"
                          style={{
                            backgroundColor: index === 0 ? USED_COLOR : REMAINING_COLOR,
                          }}
                        />
                        <span className="min-w-0 flex-1 truncate text-muted">{row.name}</span>
                        <span className="shrink-0 text-subtle">{formatCredits(row.value)}</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="py-10 text-center text-xs text-muted">
                  This key has no spending cap — usage is limited by account balance only.
                </p>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-hairline bg-panel p-4">
            <p className="mb-3 text-[11px] uppercase tracking-wide text-subtle">Configured models</p>
            <dl className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <dt className="text-xs text-muted">Chat model</dt>
                <dd className="truncate font-mono text-xs text-ink" title={usage.chatModelId ?? undefined}>
                  {usage.chatModelId ?? EMPTY_VALUE}
                </dd>
              </div>
              <div className="flex flex-col gap-1">
                <dt className="text-xs text-muted">Image model</dt>
                <dd
                  className="truncate font-mono text-xs text-ink"
                  title={usage.imageModelId ?? undefined}
                >
                  {usage.imageModelId ?? EMPTY_VALUE}
                </dd>
              </div>
            </dl>
            <p className="mt-3 text-[11px] text-subtle">
              Edit model IDs in{" "}
              <Link href="/settings" className="text-accent underline-offset-2 hover:underline">
                Settings
              </Link>
              . The API key is never shown here.
            </p>
          </div>
        </>
      ) : null}
    </section>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  mono = false,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-hairline bg-panel p-4">
      <div className="flex items-center gap-2 text-subtle">
        <Icon aria-hidden className="size-3.5" />
        <span className="text-[11px] uppercase tracking-wide">{label}</span>
      </div>
      <p
        className={cn("truncate text-base text-ink", mono ? "font-mono" : "font-semibold")}
        title={value}
      >
        {value}
      </p>
    </div>
  );
}

function MetaCard({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "ok";
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-hairline bg-panel px-4 py-3">
      <span className="text-[11px] uppercase tracking-wide text-subtle">{label}</span>
      <span
        className={cn(
          "truncate text-sm font-medium",
          tone === "ok" ? "text-ok" : "text-ink",
        )}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}
