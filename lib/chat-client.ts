import type { ChatSseEvent, ClientChatMessage } from "@/lib/chat/types";

export class ChatClientError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "ChatClientError";
    this.status = status;
  }
}

function redirectToLogin(): void {
  if (typeof window === "undefined") return;
  const next = `${window.location.pathname}${window.location.search}`;
  window.location.assign(`/login?next=${encodeURIComponent(next)}`);
}

export type StreamHandlers = {
  onEvent: (event: ChatSseEvent) => void;
  signal?: AbortSignal;
};

export async function streamChat(
  messages: ClientChatMessage[],
  handlers: StreamHandlers,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch("/api/chat", {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
      signal: handlers.signal,
    });
  } catch (error) {
    if ((error as { name?: string }).name === "AbortError") return;
    throw new ChatClientError("Network error — the server could not be reached.");
  }

  if (response.status === 401) {
    redirectToLogin();
    throw new ChatClientError("Session expired. Redirecting to sign in.", 401);
  }

  if (!response.ok) {
    let message = `Chat failed with status ${response.status}.`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* keep default */
    }
    throw new ChatClientError(message, response.status);
  }

  if (!response.body) {
    throw new ChatClientError("Chat stream was empty.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let separator = buffer.indexOf("\n\n");
    while (separator !== -1) {
      const chunk = buffer.slice(0, separator);
      buffer = buffer.slice(separator + 2);
      separator = buffer.indexOf("\n\n");

      for (const line of chunk.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload) continue;
        try {
          handlers.onEvent(JSON.parse(payload) as ChatSseEvent);
        } catch {
          /* ignore malformed events */
        }
      }
    }
  }
}
