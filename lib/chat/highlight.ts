import { createHighlighter, type Highlighter, type ThemedToken } from "shiki";
import { extensionOf } from "@/lib/file-kind";

const THEME = "github-dark";

const SUPPORTED_LANGS = [
  "json",
  "javascript",
  "jsx",
  "typescript",
  "tsx",
  "python",
  "bash",
  "shellscript",
  "yaml",
  "toml",
  "html",
  "css",
  "markdown",
  "sql",
  "xml",
  "ini",
  "plaintext",
] as const;

const LANG_ALIASES: Record<string, (typeof SUPPORTED_LANGS)[number]> = {
  json: "json",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  javascript: "javascript",
  jsx: "jsx",
  ts: "typescript",
  typescript: "typescript",
  tsx: "tsx",
  py: "python",
  python: "python",
  bash: "bash",
  sh: "bash",
  shell: "shellscript",
  shellscript: "shellscript",
  zsh: "bash",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  html: "html",
  htm: "html",
  css: "css",
  md: "markdown",
  markdown: "markdown",
  sql: "sql",
  xml: "xml",
  svg: "xml",
  ini: "ini",
  env: "ini",
  conf: "ini",
  cfg: "ini",
  properties: "ini",
  csv: "plaintext",
  tsv: "plaintext",
  log: "plaintext",
  txt: "plaintext",
  text: "plaintext",
  plain: "plaintext",
  plaintext: "plaintext",
};

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: [THEME],
      langs: [...SUPPORTED_LANGS],
    });
  }
  return highlighterPromise;
}

export function resolveLang(lang: string | undefined): (typeof SUPPORTED_LANGS)[number] {
  const key = (lang ?? "").trim().toLowerCase();
  if (!key) return "plaintext";
  return LANG_ALIASES[key] ?? "plaintext";
}

export function langFromFileName(nameOrKey: string): (typeof SUPPORTED_LANGS)[number] {
  return resolveLang(extensionOf(nameOrKey));
}

export function displayLang(lang: string | undefined): string | null {
  const key = (lang ?? "").trim().toLowerCase();
  if (!key) return null;
  return LANG_ALIASES[key] ?? key;
}

export async function highlightCode(
  code: string,
  lang: string | undefined,
): Promise<ThemedToken[][]> {
  const highlighter = await getHighlighter();
  const resolved = resolveLang(lang);
  try {
    return highlighter.codeToTokens(code, {
      lang: resolved,
      theme: THEME,
    }).tokens;
  } catch {
    return highlighter.codeToTokens(code, {
      lang: "plaintext",
      theme: THEME,
    }).tokens;
  }
}
