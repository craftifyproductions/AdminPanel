"use client";

import type { ReactNode } from "react";
import { CodeBlock } from "@/components/chat/CodeBlock";

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) {
      nodes.push(text.slice(last, match.index));
    }
    const token = match[0];
    if (token.startsWith("`")) {
      nodes.push(
        <code
          key={`c-${key++}`}
          className="rounded border border-hairline bg-canvas px-1 py-0.5 font-mono text-[11px] text-accent-ink"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else {
      nodes.push(
        <strong key={`b-${key++}`} className="font-semibold text-ink">
          {token.slice(2, -2)}
        </strong>,
      );
    }
    last = match.index + token.length;
  }

  if (last < text.length) {
    nodes.push(text.slice(last));
  }

  return nodes;
}

type Segment =
  | { type: "code"; lang: string; code: string; closed: boolean }
  | { type: "markdown"; text: string };

function splitFences(text: string): Segment[] {
  const segments: Segment[] = [];
  const lines = text.split("\n");
  let index = 0;
  let markdownLines: string[] = [];

  const flushMarkdown = () => {
    if (markdownLines.length === 0) return;
    segments.push({ type: "markdown", text: markdownLines.join("\n") });
    markdownLines = [];
  };

  while (index < lines.length) {
    const open = lines[index].match(/^```([\w.+-]*)\s*$/);
    if (open) {
      flushMarkdown();
      const lang = open[1] ?? "";
      index += 1;
      const codeLines: string[] = [];
      let closed = false;
      while (index < lines.length) {
        if (/^```\s*$/.test(lines[index])) {
          closed = true;
          index += 1;
          break;
        }
        codeLines.push(lines[index]);
        index += 1;
      }
      segments.push({
        type: "code",
        lang,
        code: codeLines.join("\n"),
        closed,
      });
      continue;
    }

    markdownLines.push(lines[index]);
    index += 1;
  }

  flushMarkdown();
  return segments;
}

function renderMarkdownBlock(text: string, keyPrefix: string): ReactNode[] {
  const blocks = text.split(/\n{2,}/);
  return blocks.map((block, index) => {
    const lines = block.split("\n");
    const isList = lines.every((line) => /^\s*[-*]\s+/.test(line) || line.trim() === "");
    if (isList && lines.some((line) => line.trim())) {
      return (
        <ul key={`${keyPrefix}-ul-${index}`} className="list-disc space-y-1 pl-5 text-muted">
          {lines
            .filter((line) => line.trim())
            .map((line, lineIndex) => (
              <li key={lineIndex} className="text-ink/90">
                {renderInline(line.replace(/^\s*[-*]\s+/, ""))}
              </li>
            ))}
        </ul>
      );
    }

    return (
      <p key={`${keyPrefix}-p-${index}`} className="whitespace-pre-wrap text-ink/95">
        {lines.map((line, lineIndex) => (
          <span key={lineIndex}>
            {lineIndex > 0 ? <br /> : null}
            {renderInline(line)}
          </span>
        ))}
      </p>
    );
  });
}

type Props = {
  text: string;
  showCaret?: boolean;
};

export function ChatMarkdown({ text, showCaret = false }: Props) {
  const segments = splitFences(text);

  return (
    <div className="space-y-2 text-sm leading-relaxed text-ink/95 break-words">
      {segments.map((segment, index) => {
        if (segment.type === "code") {
          return (
            <CodeBlock
              key={`code-${index}`}
              code={segment.code}
              lang={segment.lang}
              highlight={segment.closed}
            />
          );
        }

        if (!segment.text.trim()) return null;
        return (
          <div key={`md-${index}`} className="space-y-2">
            {renderMarkdownBlock(segment.text, `md-${index}`)}
          </div>
        );
      })}
      {showCaret ? (
        <span
          aria-hidden
          className="ml-0.5 inline-block h-4 w-1.5 translate-y-0.5 animate-pulse bg-accent align-middle"
        />
      ) : null}
    </div>
  );
}
