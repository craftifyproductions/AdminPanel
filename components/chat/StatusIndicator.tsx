"use client";

import { ImageIcon, Sparkles, Wrench } from "lucide-react";
import type { ChatStatus } from "@/lib/chat/types";
import { cn } from "@/lib/cn";

type Props = {
  status: ChatStatus | null;
  detail?: string;
};

const COPY: Record<ChatStatus, string> = {
  thinking: "Thinking…",
  reading_image: "Reading image…",
  writing: "Writing…",
  generating_image: "Generating image…",
  tool: "Working…",
};

export function StatusIndicator({ status, detail }: Props) {
  if (!status) return null;

  const label =
    status === "tool" && detail
      ? `Running ${detail}…`
      : COPY[status];

  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-md border border-hairline bg-raised/80 px-3 py-1.5 text-xs text-muted",
        "chat-shimmer",
      )}
      role="status"
      aria-live="polite"
    >
      {status === "reading_image" || status === "generating_image" ? (
        <ImageIcon aria-hidden className="size-3.5 animate-pulse text-accent-ink" />
      ) : status === "tool" ? (
        <Wrench aria-hidden className="size-3.5 animate-pulse text-accent-ink" />
      ) : (
        <Sparkles aria-hidden className="size-3.5 animate-pulse text-accent-ink" />
      )}
      <span className="chat-shimmer-text">{label}</span>
    </div>
  );
}
