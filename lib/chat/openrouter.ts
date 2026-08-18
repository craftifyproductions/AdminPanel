import {
  hasExplicitToolIntent,
  isToolUseUnsupportedError,
  lastUserText,
  resolveChatRoute,
} from "@/lib/chat/routing";
import { CHAT_SYSTEM_PROMPT, CHAT_VISION_SCOPE_HINT } from "@/lib/chat/system-prompt";
import {
  MAX_TOOL_STEPS,
  executeChatTool,
  openRouterToolDefinitions,
  type ToolContext,
} from "@/lib/chat/tools";
import type {
  ChatMessage,
  ChatSseEvent,
  ChatToolCall,
  ClientChatMessage,
  ClientImage,
} from "@/lib/chat/types";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MAX_MESSAGES = 40;
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export class ChatRequestError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "ChatRequestError";
    this.status = status;
  }
}

type RunOptions = {
  messages: ClientChatMessage[];
  apiKey: string;
  chatModelId: string;
  imageModelId: string | null;
  emit: (event: ChatSseEvent) => void;
  signal?: AbortSignal;
};

function encodeSse(event: ChatSseEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export function createSseStream(run: (emit: (event: ChatSseEvent) => void) => Promise<void>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: ChatSseEvent) => {
        controller.enqueue(encoder.encode(encodeSse(event)));
      };
      try {
        await run(emit);
        emit({ type: "done" });
      } catch (error) {
        const message =
          error instanceof Error && error.message
            ? error.message
            : "Chat request failed unexpectedly.";
        emit({ type: "error", message });
        emit({ type: "done" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

function validateImage(image: ClientImage): void {
  if (!ALLOWED_IMAGE_TYPES.has(image.mimeType)) {
    throw new ChatRequestError("Images must be PNG, JPEG, GIF, or WebP.", 400);
  }
  if (typeof image.dataBase64 !== "string" || image.dataBase64.length === 0) {
    throw new ChatRequestError("Image data is required.", 400);
  }
  const approxBytes = Math.floor((image.dataBase64.length * 3) / 4);
  if (approxBytes > MAX_IMAGE_BYTES) {
    throw new ChatRequestError("Each image must be at most 4 MiB.", 413);
  }
}

export function toOpenRouterMessages(
  clientMessages: ClientChatMessage[],
): { messages: ChatMessage[]; hasImages: boolean } {
  if (!Array.isArray(clientMessages) || clientMessages.length === 0) {
    throw new ChatRequestError("At least one message is required.", 400);
  }
  if (clientMessages.length > MAX_MESSAGES) {
    throw new ChatRequestError(`At most ${MAX_MESSAGES} messages are allowed.`, 400);
  }

  let hasImages = false;
  const messages: ChatMessage[] = [];

  for (const message of clientMessages) {
    if (message.role !== "user" && message.role !== "assistant") {
      throw new ChatRequestError("Message role must be user or assistant.", 400);
    }
    if (typeof message.content !== "string") {
      throw new ChatRequestError("Message content must be a string.", 400);
    }
    if (message.content.length > 100_000) {
      throw new ChatRequestError("Message content is too large.", 413);
    }

    const images = message.images ?? [];
    if (images.length > MAX_IMAGES) {
      throw new ChatRequestError(`At most ${MAX_IMAGES} images per message.`, 400);
    }

    if (message.role === "assistant" || images.length === 0) {
      messages.push({ role: message.role, content: message.content });
      continue;
    }

    for (const image of images) validateImage(image);
    hasImages = true;

    const parts: ChatMessage["content"] = [];
    if (message.content.trim()) {
      parts.push({ type: "text", text: message.content });
    } else {
      parts.push({ type: "text", text: "Please look at the attached image(s)." });
    }
    for (const image of images) {
      parts.push({
        type: "image_url",
        image_url: { url: `data:${image.mimeType};base64,${image.dataBase64}` },
      });
    }
    messages.push({ role: "user", content: parts });
  }

  return { messages, hasImages };
}

/** Strip image parts to plain text (for tool loops after a vision describe step). */
function stripImagesFromMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) => {
    if (message.role !== "user" || typeof message.content === "string" || message.content === null) {
      return message;
    }
    const text = message.content
      .filter((part): part is { type: "text"; text: string } => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .trim();
    return {
      ...message,
      content: text || "Please look at the attached image(s).",
    };
  });
}

type CompletionMessage = {
  role?: string;
  content?: string | null;
  tool_calls?: ChatToolCall[];
  images?: Array<{ image_url?: { url?: string }; url?: string }>;
};

type CompletionBody = {
  choices?: Array<{
    message?: CompletionMessage;
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  error?: { message?: string };
};

function errorMessageFromBody(raw: string, fallback: string): string {
  try {
    const parsed = JSON.parse(raw) as CompletionBody;
    if (parsed.error?.message) return parsed.error.message;
  } catch {
    /* keep fallback */
  }
  return fallback;
}

async function openRouterJson(
  apiKey: string,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<CompletionBody> {
  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://localhost/craftify-ai-admin-panel",
      "X-Title": "Craftify AI Admin Panel Chat",
    },
    body: JSON.stringify(body),
    signal,
  });

  const raw = await response.text();
  let parsed: CompletionBody = {};
  try {
    parsed = raw ? (JSON.parse(raw) as CompletionBody) : {};
  } catch {
    throw new ChatRequestError("OpenRouter returned invalid JSON.", 502);
  }

  if (!response.ok) {
    throw new ChatRequestError(
      parsed.error?.message || `OpenRouter request failed (${response.status}).`,
      response.status >= 400 && response.status < 600 ? response.status : 502,
    );
  }

  return parsed;
}

async function streamAssistantText(options: {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  emit: (event: ChatSseEvent) => void;
  signal?: AbortSignal;
  /** When true, attach tools with tool_choice none (only for models that support tools). */
  withToolsDisabled?: boolean;
}): Promise<void> {
  const { apiKey, model, messages, emit, signal, withToolsDisabled = false } = options;
  emit({ type: "status", status: "writing" });

  const body: Record<string, unknown> = {
    model,
    messages,
    stream: true,
  };
  if (withToolsDisabled) {
    body.tools = openRouterToolDefinitions();
    body.tool_choice = "none";
  }

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://localhost/craftify-ai-admin-panel",
      "X-Title": "Craftify AI Admin Panel Chat",
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok || !response.body) {
    const raw = await response.text().catch(() => "");
    throw new ChatRequestError(
      errorMessageFromBody(raw, `OpenRouter stream failed (${response.status}).`),
      502,
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sawDelta = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");

      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;

      let parsed: CompletionBody;
      try {
        parsed = JSON.parse(payload) as CompletionBody;
      } catch {
        continue;
      }

      if (parsed.error?.message) {
        throw new ChatRequestError(parsed.error.message, 502);
      }

      const delta = parsed.choices?.[0]?.delta?.content;
      if (typeof delta === "string" && delta.length > 0) {
        sawDelta = true;
        emit({ type: "delta", text: delta });
      }
    }
  }

  if (!sawDelta) {
    // Some providers accept stream:true but only return a final non-delta payload.
    const fallback = await completeOnce({
      apiKey,
      model,
      messages,
      useTools: false,
      signal,
    });
    const content = typeof fallback.content === "string" ? fallback.content : "";
    extractGeneratedImages(fallback, emit);
    if (!content && !fallback.images?.length) {
      throw new ChatRequestError("The model returned an empty response.", 502);
    }
    if (content) {
      emit({ type: "delta", text: content });
    }
  }
}

async function completeOnce(options: {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  useTools: boolean;
  signal?: AbortSignal;
}): Promise<CompletionMessage> {
  const body: Record<string, unknown> = {
    model: options.model,
    messages: options.messages,
    stream: false,
  };
  if (options.useTools) {
    body.tools = openRouterToolDefinitions();
    body.tool_choice = "auto";
  }

  const completion = await openRouterJson(options.apiKey, body, options.signal);
  const assistant = completion.choices?.[0]?.message;
  if (!assistant) {
    throw new ChatRequestError("OpenRouter returned an empty response.", 502);
  }
  return assistant;
}

function extractGeneratedImages(message: CompletionMessage | undefined, emit: (e: ChatSseEvent) => void) {
  if (!message?.images || !Array.isArray(message.images)) return;
  for (const image of message.images) {
    const url = image.image_url?.url ?? image.url;
    if (typeof url === "string" && url.length > 0) {
      emit({ type: "image", url, alt: "Generated image" });
    }
  }
}

async function emitAssistantContent(
  apiKey: string,
  model: string,
  messages: ChatMessage[],
  content: string,
  emit: (event: ChatSseEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (content) {
    emit({ type: "status", status: "writing" });
    emit({ type: "delta", text: content });
    return;
  }

  await streamAssistantText({
    apiKey,
    model,
    messages,
    emit,
    signal,
    withToolsDisabled: false,
  });
}

async function runVisionOnly(options: {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  emit: (event: ChatSseEvent) => void;
  signal?: AbortSignal;
}): Promise<void> {
  const { apiKey, model, messages, emit, signal } = options;
  emit({ type: "status", status: "thinking" });
  await streamAssistantText({
    apiKey,
    model,
    messages,
    emit,
    signal,
    withToolsDisabled: false,
  });
}

async function describeImages(options: {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  emit: (event: ChatSseEvent) => void;
  signal?: AbortSignal;
}): Promise<string> {
  const { apiKey, model, messages, emit, signal } = options;
  emit({ type: "status", status: "reading_image" });
  emit({ type: "status", status: "thinking" });

  const describeMessages: ChatMessage[] = [
    ...messages,
    {
      role: "user",
      content:
        "Describe the attached image(s) only if they relate to this Craftify AI Admin Panel, its UI, buckets/objects/folders, or cloud storage admin work for this app. If unrelated, reply with exactly: not related. Otherwise be concise and factual for admin tool use.",
    },
  ];

  const assistant = await completeOnce({
    apiKey,
    model,
    messages: describeMessages,
    useTools: false,
    signal,
  });

  const content = typeof assistant.content === "string" ? assistant.content.trim() : "";
  if (!content) {
    throw new ChatRequestError("Could not describe the attached image(s).", 502);
  }
  return content;
}

async function runToolLoop(options: {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  chatModelId: string;
  imageModelId: string | null;
  emit: (event: ChatSseEvent) => void;
  signal?: AbortSignal;
  useTools: boolean;
}): Promise<void> {
  const { apiKey, model, emit, signal, useTools } = options;
  const messages = options.messages;

  const toolCtx: ToolContext = {
    messages,
    apiKey,
    chatModelId: options.chatModelId,
    imageModelId: options.imageModelId,
    emitStatus: (detail) => {
      if (detail === "generating_image") {
        emit({ type: "status", status: "generating_image" });
      } else {
        emit({ type: "status", status: "tool", detail });
      }
    },
  };

  for (let step = 0; step < MAX_TOOL_STEPS; step += 1) {
    emit({ type: "status", status: "thinking" });

    const assistant = await completeOnce({
      apiKey,
      model,
      messages,
      useTools,
      signal,
    });

    extractGeneratedImages(assistant, emit);

    const toolCalls = assistant.tool_calls ?? [];
    if (!useTools || toolCalls.length === 0) {
      const content = typeof assistant.content === "string" ? assistant.content : "";
      if (content || assistant.images?.length) {
        if (content) {
          await emitAssistantContent(apiKey, model, messages, content, emit, signal);
        }
        return;
      }
      await streamAssistantText({
        apiKey,
        model,
        messages,
        emit,
        signal,
        withToolsDisabled: false,
      });
      return;
    }

    messages.push({
      role: "assistant",
      content: assistant.content ?? null,
      tool_calls: toolCalls,
    });

    for (const call of toolCalls) {
      const name = call.function?.name || "unknown";
      emit({ type: "status", status: "tool", detail: name });
      const result = await executeChatTool(name, call.function?.arguments || "{}", toolCtx);

      try {
        const parsed = JSON.parse(result) as { imageUrl?: unknown };
        if (typeof parsed.imageUrl === "string" && parsed.imageUrl.length > 0) {
          emit({ type: "image", url: parsed.imageUrl, alt: "Generated image" });
        }
      } catch {
        /* ignore */
      }

      messages.push({
        role: "tool",
        tool_call_id: call.id,
        name,
        content: result,
      });
    }
  }

  emit({
    type: "warning",
    message: "Stopped after the maximum number of tool steps. Summarizing with what we have.",
  });
  await streamAssistantText({
    apiKey,
    model,
    messages,
    emit,
    signal,
    withToolsDisabled: false,
  });
}

function friendlyChatError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  if (isToolUseUnsupportedError(message)) {
    throw new ChatRequestError(
      "This model cannot run admin tools or complete the request. Try a different chat model in Settings, or ask without requiring bucket actions.",
      502,
    );
  }
  if (error instanceof ChatRequestError) throw error;
  throw new ChatRequestError(
    message || "Chat request failed unexpectedly.",
    502,
  );
}

async function runWithToolUseFallback(options: {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  chatModelId: string;
  imageModelId: string | null;
  emit: (event: ChatSseEvent) => void;
  signal?: AbortSignal;
}): Promise<void> {
  try {
    await runToolLoop({ ...options, useTools: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!isToolUseUnsupportedError(message)) throw error;

    options.emit({
      type: "warning",
      message: "This model does not support tools — answering without admin actions.",
    });
    options.emit({ type: "status", status: "thinking" });
    try {
      await streamAssistantText({
        apiKey: options.apiKey,
        model: options.model,
        messages: options.messages,
        emit: options.emit,
        signal: options.signal,
        withToolsDisabled: false,
      });
    } catch (retryError) {
      friendlyChatError(retryError);
    }
  }
}

export async function runChatCompletion(options: RunOptions): Promise<void> {
  const { apiKey, chatModelId, imageModelId, emit, signal } = options;
  if (!chatModelId) {
    throw new ChatRequestError(
      "Chat model is not configured. Set OPENROUTER_MODEL_ID in Settings.",
      400,
    );
  }

  const { messages: history, hasImages } = toOpenRouterMessages(options.messages);
  const userText = lastUserText(options.messages);
  const route = resolveChatRoute({ hasImages, userText });

  const baseMessages: ChatMessage[] = [
    { role: "system", content: CHAT_SYSTEM_PROMPT },
    ...history,
  ];

  if (hasImages) {
    emit({ type: "status", status: "reading_image" });
    if (!imageModelId && route === "vision") {
      emit({
        type: "warning",
        message: "Image model ID is unset — using the chat model for this turn.",
      });
    }
  }

  // Vision Q&A: never attach tools (many vision providers reject tool schemas).
  if (route === "vision") {
    const model = imageModelId || chatModelId;
    const visionMessages: ChatMessage[] = [
      {
        role: "system",
        content: `${CHAT_SYSTEM_PROMPT}\n\n${CHAT_VISION_SCOPE_HINT}`,
      },
      ...history,
    ];
    await runVisionOnly({
      apiKey,
      model,
      messages: visionMessages,
      emit,
      signal,
    });
    return;
  }

  // Text-only admin chat with tools (+ automatic no-tools retry).
  if (route === "tools") {
    await runWithToolUseFallback({
      apiKey,
      model: chatModelId,
      messages: baseMessages,
      chatModelId,
      imageModelId,
      emit,
      signal,
    });
    return;
  }

  // Hybrid: images + explicit tool intent.
  // Prefer chat model with tools + image parts; on tool-use failure, describe then act.
  try {
    await runToolLoop({
      apiKey,
      model: chatModelId,
      messages: [...baseMessages],
      chatModelId,
      imageModelId,
      emit,
      signal,
      useTools: true,
    });
    return;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!isToolUseUnsupportedError(message) && !/image|vision|multimodal|content part/i.test(message)) {
      throw error;
    }
  }

  emit({
    type: "warning",
    message: "Using a two-step flow: describe the image, then run admin tools.",
  });

  const visionModel = imageModelId || chatModelId;
  const description = await describeImages({
    apiKey,
    model: visionModel,
    messages: baseMessages,
    emit,
    signal,
  });

  const textOnly = stripImagesFromMessages(baseMessages);
  const hybridMessages: ChatMessage[] = [
    ...textOnly,
    {
      role: "assistant",
      content: `Image description for tool use:\n${description}`,
    },
    {
      role: "user",
      content: hasExplicitToolIntent(userText)
        ? userText
        : "Continue with the admin actions needed for my request, using tools when required.",
    },
  ];

  await runWithToolUseFallback({
    apiKey,
    model: chatModelId,
    messages: hybridMessages,
    chatModelId,
    imageModelId,
    emit,
    signal,
  });
}
