export type ClassValue = string | number | null | undefined | false;

export function cn(...values: ClassValue[]): string {
  return values.filter((value) => typeof value === "string" || typeof value === "number").join(" ");
}
