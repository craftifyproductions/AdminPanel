"use client";

import {
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type UIEvent,
} from "react";
import type { ThemedToken } from "shiki";
import { highlightCode, langFromFileName, resolveLang } from "@/lib/chat/highlight";
import { cn } from "@/lib/cn";

export type HighlightedCodeProps = {
  value: string;
  fileName?: string;
  lang?: string;
  readOnly?: boolean;
  onChange?: (value: string) => void;
  className?: string;
  "aria-label"?: string;
};

type HighlightState = {
  key: string;
  lines: ThemedToken[][];
};

function tokenStyle(token: ThemedToken): CSSProperties | undefined {
  const style: CSSProperties = {};
  if (token.color) style.color = token.color;
  const fontStyle = token.fontStyle ?? 0;
  if (fontStyle & 1) style.fontStyle = "italic";
  if (fontStyle & 2) style.fontWeight = 600;
  if (fontStyle & 4) style.textDecoration = "underline";
  return Object.keys(style).length > 0 ? style : undefined;
}

function cacheKey(code: string, lang: string): string {
  return `${lang}\0${code}`;
}

function HighlightedLines({ lines }: { lines: ThemedToken[][] }) {
  return (
    <code>
      {lines.map((line, lineIndex) => (
        <span key={lineIndex}>
          {lineIndex > 0 ? "\n" : null}
          {line.map((token, tokenIndex) => (
            <span key={tokenIndex} style={tokenStyle(token)}>
              {token.content}
            </span>
          ))}
        </span>
      ))}
    </code>
  );
}

export function HighlightedCode({
  value,
  fileName,
  lang,
  readOnly = false,
  onChange,
  className,
  "aria-label": ariaLabel,
}: HighlightedCodeProps) {
  const resolvedLang = lang
    ? resolveLang(lang)
    : fileName
      ? langFromFileName(fileName)
      : "plaintext";

  const deferredValue = useDeferredValue(value);
  const key = cacheKey(deferredValue, resolvedLang);
  const [highlighted, setHighlighted] = useState<HighlightState | null>(null);
  const lines = highlighted?.key === key ? highlighted.lines : null;

  const preRef = useRef<HTMLPreElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;
    void highlightCode(deferredValue, resolvedLang).then((tokens) => {
      if (!cancelled) setHighlighted({ key, lines: tokens });
    });
    return () => {
      cancelled = true;
    };
  }, [deferredValue, resolvedLang, key]);

  function syncScroll(event: UIEvent<HTMLTextAreaElement>) {
    const pre = preRef.current;
    if (!pre) return;
    pre.scrollTop = event.currentTarget.scrollTop;
    pre.scrollLeft = event.currentTarget.scrollLeft;
  }

  const sharedTextClass =
    "m-0 h-full w-full overflow-auto whitespace-pre-wrap break-words px-4 py-3 font-mono text-xs leading-5";

  if (readOnly) {
    return (
      <pre
        ref={preRef}
        className={cn(sharedTextClass, "bg-transparent text-ink", className)}
        aria-label={ariaLabel}
      >
        {lines ? <HighlightedLines lines={lines} /> : deferredValue}
      </pre>
    );
  }

  return (
    <div className={cn("relative h-full min-h-0 overflow-hidden", className)}>
      <pre
        ref={preRef}
        aria-hidden
        className={cn(
          sharedTextClass,
          "pointer-events-none absolute inset-0 bg-transparent text-ink",
        )}
      >
        {lines ? <HighlightedLines lines={lines} /> : deferredValue}
        {/* Trailing newline keeps scroll height aligned with textarea. */}
        {"\n"}
      </pre>
      <textarea
        ref={textareaRef}
        value={value}
        spellCheck={false}
        onChange={(event) => onChange?.(event.target.value)}
        onScroll={syncScroll}
        aria-label={ariaLabel}
        className={cn(
          sharedTextClass,
          "absolute inset-0 resize-none bg-transparent text-transparent caret-white",
          "outline-none selection:bg-accent/35",
        )}
        style={{ WebkitTextFillColor: "transparent" }}
      />
    </div>
  );
}
