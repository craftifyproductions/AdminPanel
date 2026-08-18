"use client";

import { MessageSquare } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ChatComposer, type ComposerSubmit } from "@/components/chat/ChatComposer";
import { ChatMarkdown } from "@/components/chat/ChatMarkdown";
import { StatusIndicator } from "@/components/chat/StatusIndicator";
import { useToast } from "@/components/ui/Toast";
import { ChatClientError, streamChat } from "@/lib/chat-client";
import type { ChatStatus, ClientChatMessage, ClientImage } from "@/lib/chat/types";
import { cn } from "@/lib/cn";

type UiMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  images?: ClientImage[];
  generatedImages?: string[];
  streaming?: boolean;
  isError?: boolean;
};

function previewDataUrl(image: ClientImage): string {
  return `data:${image.mimeType};base64,${image.dataBase64}`;
}

export function ChatPanel() {
  const toast = useToast();
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus | null>(null);
  const [statusDetail, setStatusDetail] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, status]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  async function handleSubmit(payload: ComposerSubmit) {
    if (busy) return;

    const userMessage: UiMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      content: payload.content,
      images: payload.images.length > 0 ? payload.images : undefined,
    };

    const assistantId = `a-${Date.now()}`;
    const nextMessages: UiMessage[] = [
      ...messages,
      userMessage,
      { id: assistantId, role: "assistant", content: "", streaming: true, generatedImages: [] },
    ];
    setMessages(nextMessages);
    setBusy(true);
    setStatus(payload.images.length > 0 ? "reading_image" : "thinking");
    setStatusDetail(undefined);

    const apiMessages: ClientChatMessage[] = nextMessages
      .filter((message) => message.id !== assistantId)
      .map((message) => ({
        role: message.role,
        content: message.content,
        images: message.images,
      }));

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await streamChat(apiMessages, {
        signal: controller.signal,
        onEvent: (event) => {
          if (event.type === "status") {
            setStatus(event.status);
            setStatusDetail(event.detail);
            return;
          }
          if (event.type === "delta") {
            setStatus("writing");
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantId
                  ? { ...message, content: `${message.content}${event.text}`, streaming: true }
                  : message,
              ),
            );
            return;
          }
          if (event.type === "image") {
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantId
                  ? {
                      ...message,
                      generatedImages: [...(message.generatedImages ?? []), event.url],
                    }
                  : message,
              ),
            );
            return;
          }
          if (event.type === "warning") {
            toast.info(event.message);
            return;
          }
          if (event.type === "error") {
            toast.error(event.message);
            setStatus(null);
            setStatusDetail(undefined);
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantId
                  ? {
                      ...message,
                      content: message.content
                        ? `${message.content}\n\n${event.message}`
                        : event.message,
                      streaming: false,
                      isError: true,
                    }
                  : message,
              ),
            );
            return;
          }
          if (event.type === "done") {
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantId
                  ? {
                      ...message,
                      streaming: false,
                      content:
                        message.content ||
                        (message.generatedImages?.length ? "Generated image ready." : message.content),
                    }
                  : message,
              ),
            );
          }
        },
      });
    } catch (error) {
      if (error instanceof ChatClientError) {
        toast.error(error.message);
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantId
              ? {
                  ...message,
                  content: message.content || error.message,
                  streaming: false,
                  isError: true,
                }
              : message,
          ),
        );
      } else if ((error as { name?: string }).name !== "AbortError") {
        toast.error("Chat request failed.");
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantId
              ? {
                  ...message,
                  content: message.content || "Chat request failed.",
                  streaming: false,
                  isError: true,
                }
              : message,
          ),
        );
      } else {
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantId ? { ...message, streaming: false } : message,
          ),
        );
      }
    } finally {
      setBusy(false);
      setStatus(null);
      setStatusDetail(undefined);
      abortRef.current = null;
    }
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col bg-canvas">
      <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        {messages.length === 0 ? (
          <div className="mx-auto flex h-full max-w-2xl flex-col items-center justify-center gap-3 text-center">
            <span className="flex size-12 items-center justify-center rounded-xl border border-hairline bg-panel text-accent-ink">
              <MessageSquare className="size-5" />
            </span>
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-ink">Craftify AI Chat</h2>
              <p className="max-w-md text-xs text-muted">
                Ask about buckets, browse folders, inspect or edit text objects, and diagnose
                settings — scoped to this panel only.
              </p>
            </div>
          </div>
        ) : (
          <div className="mx-auto flex max-w-3xl flex-col gap-4">
            {messages.map((message) => (
              <div
                key={message.id}
                className={cn(
                  "flex flex-col gap-2",
                  message.role === "user" ? "items-end" : "items-start",
                )}
              >
                <div
                  className={cn(
                    "max-w-[92%] rounded-lg border px-3 py-2",
                    message.role === "user"
                      ? "border-accent/30 bg-accent/10"
                      : message.isError
                        ? "border-danger/40 bg-danger/5"
                        : "border-hairline bg-panel",
                  )}
                >
                  {message.images && message.images.length > 0 ? (
                    <div className="mb-2 flex flex-wrap gap-2">
                      {message.images.map((image, index) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={index}
                          src={previewDataUrl(image)}
                          alt={`Attachment ${index + 1}`}
                          className="max-h-40 max-w-full rounded-md border border-hairline object-contain"
                        />
                      ))}
                    </div>
                  ) : null}

                  {message.isError && message.content ? (
                    <p className="text-sm leading-relaxed text-danger" role="alert">
                      {message.content}
                    </p>
                  ) : message.content ? (
                    <ChatMarkdown text={message.content} showCaret={Boolean(message.streaming)} />
                  ) : message.streaming && status === "writing" ? (
                    <ChatMarkdown text="" showCaret />
                  ) : null}

                  {message.generatedImages && message.generatedImages.length > 0 ? (
                    <div className="mt-2 flex flex-col gap-2">
                      {message.generatedImages.map((url, index) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={index}
                          src={url}
                          alt={`Generated ${index + 1}`}
                          className="max-h-80 max-w-full rounded-md border border-hairline object-contain"
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}

            {busy ? (
              <div className="flex justify-start">
                <StatusIndicator status={status} detail={statusDetail} />
              </div>
            ) : null}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <div className="mx-auto w-full max-w-3xl">
        <ChatComposer disabled={busy} onSubmit={(payload) => void handleSubmit(payload)} />
      </div>
    </div>
  );
}
