const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"] as const;

const DATE_TIME_FORMAT = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const NUMBER_FORMAT = new Intl.NumberFormat("en-US");

export const EMPTY_VALUE = "—";

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return EMPTY_VALUE;
  if (bytes < 1024) return `${Math.round(bytes)} B`;

  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }

  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${BYTE_UNITS[unit]}`;
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return EMPTY_VALUE;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return EMPTY_VALUE;
  return DATE_TIME_FORMAT.format(date);
}

export function formatCount(value: number): string {
  if (!Number.isFinite(value)) return EMPTY_VALUE;
  return NUMBER_FORMAT.format(value);
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${formatCount(count)} ${count === 1 ? singular : plural}`;
}
