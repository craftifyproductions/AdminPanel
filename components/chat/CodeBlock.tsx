"use client";

import { useEffect, useState, type CSSProperties } from "react";
import type { ThemedToken } from "shiki";
import { displayLang, highlightCode } from "@/lib/chat/highlight";

type Props = {
  code: string;
  lang?: string;
  highlight?: boolean;
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

export function CodeBlock({ code, lang = "", highlight = true }: Props) {
  const [highlighted, setHighlighted] = useState<HighlightState | null>(null);
  const label = displayLang(lang);
  const key = cacheKey(code, lang);
  const lines = highlight && highlighted?.key === key ? highlighted.lines : null;

  useEffect(() => {
    if (!highlight) return;

    let cancelled = false;
    void highlightCode(code, lang).then((tokens) => {
      if (!cancelled) setHighlighted({ key, lines: tokens });
    });

    return () => {
      cancelled = true;
    };
  }, [code, lang, highlight, key]);

  return (
    <div className="my-1 overflow-hidden rounded-md border border-hairline bg-canvas">
      {label ? (
        <div className="border-b border-hairline px-3 py-1 font-mono text-[10px] uppercase tracking-wide text-subtle">
          {label}
        </div>
      ) : null}
      <pre className="overflow-x-auto p-3 font-mono text-[11px] leading-relaxed text-ink/90">
        <code>
          {lines
            ? lines.map((line, lineIndex) => (
                <span key={lineIndex}>
                  {lineIndex > 0 ? "\n" : null}
                  {line.map((token, tokenIndex) => (
                    <span key={tokenIndex} style={tokenStyle(token)}>
                      {token.content}
                    </span>
                  ))}
                </span>
              ))
            : code}
        </code>
      </pre>
    </div>
  );
}
