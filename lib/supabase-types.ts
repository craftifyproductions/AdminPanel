export type TableDiscoverySource = "openapi" | "information_schema" | "allowlist";

export type SupabaseTablesResponse = {
  configured: boolean;
  tables: string[];
  source: TableDiscoverySource | null;
  usingServiceRole: boolean;
  usingAnonFallback: boolean;
  url: string | null;
  missing: string[];
  message: string | null;
};

export type SupabaseDataResponse = {
  table: string;
  page: number;
  pageSize: number;
  total: number;
  columns: string[];
  rows: Record<string, unknown>[];
};

export type SupabaseTableStat = {
  name: string;
  rowCount: number | null;
};

export type SupabaseOverviewResponse = {
  configured: boolean;
  url: string | null;
  host: string | null;
  tables: SupabaseTableStat[];
  tableCount: number;
  listedTableCount: number;
  totalRows: number;
  usingServiceRole: boolean;
  usingAnonFallback: boolean;
  missing: string[];
  message: string | null;
};
