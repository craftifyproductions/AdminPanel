export type FileKind = "image" | "text" | "model" | "archive" | "binary";

const IMAGE_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "avif",
  "bmp",
  "ico",
]);

const TEXT_EXTENSIONS = new Set([
  "json",
  "txt",
  "md",
  "csv",
  "tsv",
  "xml",
  "html",
  "htm",
  "css",
  "js",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "jsx",
  "yml",
  "yaml",
  "toml",
  "ini",
  "env",
  "log",
]);

const MODEL_EXTENSIONS = new Set(["bbmodel"]);

const ARCHIVE_EXTENSIONS = new Set(["zip"]);

export function extensionOf(nameOrKey: string): string {
  const base = nameOrKey.includes("/")
    ? nameOrKey.slice(nameOrKey.lastIndexOf("/") + 1)
    : nameOrKey;
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  return base.slice(dot + 1).toLowerCase();
}

export function classifyFile(nameOrKey: string, contentType?: string | null): FileKind {
  const ext = extensionOf(nameOrKey);
  if (ARCHIVE_EXTENSIONS.has(ext)) return "archive";
  if (MODEL_EXTENSIONS.has(ext)) return "model";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (TEXT_EXTENSIONS.has(ext)) return "text";

  const ct = (contentType ?? "").trim().toLowerCase();
  const mime = ct.split(";")[0]?.trim() ?? "";
  if (mime === "application/zip" || mime === "application/x-zip-compressed") return "archive";
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/json" || mime.startsWith("text/")) return "text";

  return "binary";
}
