"use client";

import { ChevronLeft, ChevronRight, Database, RefreshCw, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Skeleton, SkeletonList } from "@/components/ui/Skeleton";
import { cn } from "@/lib/cn";
import {
  errorMessage,
  fetchSupabaseTableData,
  listSupabaseTables,
} from "@/lib/supabase-client";
import type { SupabaseDataResponse, SupabaseTablesResponse } from "@/lib/supabase-types";

const PAGE_SIZE = 50;

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function sourceLabel(source: SupabaseTablesResponse["source"]): string {
  switch (source) {
    case "openapi":
      return "OpenAPI introspection";
    case "information_schema":
      return "information_schema";
    case "allowlist":
      return "SUPABASE_TABLES allowlist";
    default:
      return "unknown";
  }
}

export function SupabaseBrowser() {
  const [meta, setMeta] = useState<SupabaseTablesResponse | null>(null);
  const [metaLoading, setMetaLoading] = useState(true);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<SupabaseDataResponse | null>(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const applyTablesResult = useCallback((result: SupabaseTablesResponse) => {
    setMeta(result);
    setMetaError(null);
    setSelectedTable((current) => {
      if (current && result.tables.includes(current)) return current;
      return result.tables[0] ?? null;
    });
  }, []);

  useEffect(() => {
    let active = true;

    listSupabaseTables()
      .then((result) => {
        if (!active) return;
        applyTablesResult(result);
        setMetaLoading(false);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setMetaError(errorMessage(error));
        setMeta(null);
        setMetaLoading(false);
      });

    return () => {
      active = false;
    };
  }, [applyTablesResult]);

  useEffect(() => {
    if (!selectedTable || !meta?.configured) return;

    let cancelled = false;
    const table = selectedTable;
    const currentPage = page;

    fetchSupabaseTableData(table, currentPage, PAGE_SIZE)
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setDataError(null);
        setDataLoading(false);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setData(null);
        setDataError(errorMessage(error));
        setDataLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedTable, page, meta?.configured]);

  async function refreshTables() {
    setRefreshing(true);
    try {
      const result = await listSupabaseTables();
      applyTablesResult(result);
    } catch (error) {
      setMetaError(errorMessage(error));
    } finally {
      setRefreshing(false);
    }
  }

  function selectTable(table: string) {
    setSelectedTable(table);
    setPage(1);
    setData(null);
    setDataError(null);
    setDataLoading(true);
  }

  const showDataPanel = Boolean(meta?.configured);
  const totalPages =
    data && data.pageSize > 0 ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const awaitingData = Boolean(selectedTable && meta?.configured && !data && !dataError);
  const showDataSpinner = dataLoading || awaitingData;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold text-ink">Supabase</h2>
          <p className="text-xs text-muted">
            Browse public tables from your Supabase project. Read-only; credentials stay on the
            server.
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          loading={refreshing}
          onClick={() => void refreshTables()}
          aria-label="Refresh tables"
        >
          <RefreshCw aria-hidden className="size-3.5" />
          Refresh
        </Button>
      </div>

      {metaLoading && !meta ? (
        <div className="rounded-lg border border-hairline bg-panel p-4">
          <SkeletonList rows={3} rowClassName="h-8 w-full" />
        </div>
      ) : null}

      {metaError ? (
        <p className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
          {metaError}
        </p>
      ) : null}

      {meta && !meta.configured ? (
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
                <li className="text-muted">
                  SUPABASE_TABLES=table1,table2 (if introspection fails)
                </li>
              </ul>
              {meta.missing.length > 0 ? (
                <p className="text-xs text-danger">Missing: {meta.missing.join(", ")}</p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {showDataPanel && meta ? (
        <>
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-hairline bg-panel px-4 py-3 text-xs">
            <span className="flex items-center gap-2 text-ink">
              <span aria-hidden className="size-1.5 rounded-full bg-ok" />
              Connected
            </span>
            {meta.url ? (
              <span className="font-mono text-subtle" title={meta.url}>
                {meta.url}
              </span>
            ) : null}
            <span className="text-muted">
              {meta.usingServiceRole ? "service role" : "anon (RLS-limited)"}
            </span>
            {meta.source ? (
              <span className="text-muted">via {sourceLabel(meta.source)}</span>
            ) : null}
            {meta.message ? (
              <span className="flex items-center gap-1 text-amber-400/90">
                <TriangleAlert aria-hidden className="size-3" />
                {meta.message}
              </span>
            ) : null}
          </div>

          <div className="flex min-h-[28rem] flex-col gap-4 lg:flex-row">
            <aside className="flex w-full shrink-0 flex-col overflow-hidden rounded-lg border border-hairline bg-panel lg:w-56">
              <div className="border-b border-hairline px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-subtle">
                Tables ({meta.tables.length})
              </div>
              {meta.tables.length === 0 ? (
                <p className="px-3 py-4 text-xs text-muted">No tables discovered.</p>
              ) : (
                <ul className="flex max-h-64 flex-col gap-0.5 overflow-y-auto p-1.5 lg:max-h-none lg:flex-1">
                  {meta.tables.map((table) => {
                    const active = table === selectedTable;
                    return (
                      <li key={table}>
                        <button
                          type="button"
                          onClick={() => selectTable(table)}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs transition-colors",
                            active
                              ? "bg-accent/12 text-accent-ink"
                              : "text-muted hover:bg-raised hover:text-ink",
                          )}
                        >
                          <Database aria-hidden className="size-3.5 shrink-0" />
                          <span className="truncate font-mono">{table}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </aside>

            <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-hairline bg-panel">
              <div className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-2.5">
                <div className="min-w-0">
                  <h3 className="truncate font-mono text-sm text-ink">
                    {selectedTable ?? "Select a table"}
                  </h3>
                  {data && !showDataSpinner ? (
                    <p className="text-[11px] text-subtle">
                      {data.total.toLocaleString()} row{data.total === 1 ? "" : "s"}
                    </p>
                  ) : null}
                </div>
                {data && data.total > 0 ? (
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={page <= 1 || showDataSpinner}
                      onClick={() => {
                        setPage((current) => Math.max(1, current - 1));
                        setDataLoading(true);
                      }}
                      aria-label="Previous page"
                    >
                      <ChevronLeft aria-hidden className="size-3.5" />
                    </Button>
                    <span className="min-w-[4.5rem] text-center font-mono text-[11px] text-subtle">
                      {page} / {totalPages}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={page >= totalPages || showDataSpinner}
                      onClick={() => {
                        setPage((current) => current + 1);
                        setDataLoading(true);
                      }}
                      aria-label="Next page"
                    >
                      <ChevronRight aria-hidden className="size-3.5" />
                    </Button>
                  </div>
                ) : null}
              </div>

              <div className="min-h-0 flex-1 overflow-auto">
                {!selectedTable ? (
                  <p className="px-4 py-8 text-center text-xs text-muted">
                    Select a table to view rows.
                  </p>
                ) : null}

                {selectedTable && showDataSpinner ? (
                  <div className="p-4">
                    <Skeleton className="mb-2 h-8 w-full" />
                    <SkeletonList rows={8} rowClassName="h-7 w-full" />
                  </div>
                ) : null}

                {selectedTable && !showDataSpinner && dataError ? (
                  <p className="m-4 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
                    {dataError}
                  </p>
                ) : null}

                {selectedTable && !showDataSpinner && !dataError && data && data.rows.length === 0 ? (
                  <p className="px-4 py-8 text-center text-xs text-muted">This table has no rows.</p>
                ) : null}

                {selectedTable && !showDataSpinner && !dataError && data && data.rows.length > 0 ? (
                  <table className="w-full min-w-max border-collapse text-left text-xs">
                    <thead className="sticky top-0 z-10 bg-raised">
                      <tr>
                        {data.columns.map((column) => (
                          <th
                            key={column}
                            className="border-b border-hairline px-3 py-2 font-mono text-[11px] font-medium text-subtle"
                          >
                            {column}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.rows.map((row, rowIndex) => (
                        <tr
                          key={rowIndex}
                          className="border-b border-hairline/70 hover:bg-raised/60"
                        >
                          {data.columns.map((column) => (
                            <td
                              key={column}
                              className="max-w-xs truncate px-3 py-2 font-mono text-[11px] text-ink"
                              title={formatCell(row[column])}
                            >
                              {formatCell(row[column])}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}
              </div>
            </section>
          </div>
        </>
      ) : null}
    </div>
  );
}
