import { logRequestActivity, truncateForLog } from "@/lib/activity-log";
import { assertSameOrigin } from "@/lib/csrf";
import { ChatRequestError, createSseStream, runChatCompletion } from "@/lib/chat/openrouter";
import { clientIp, isChatRateLimited } from "@/lib/chat/rate-limit";
import type { ClientChatMessage } from "@/lib/chat/types";
import { optionalEnv } from "@/lib/env";
import { requireSession } from "@/lib/require-session";
import type { ApiError } from "@/lib/types";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type Body = {
  messages?: unknown;
};

function parseMessages(raw: unknown): ClientChatMessage[] {
  if (!Array.isArray(raw)) {
    throw new ChatRequestError('"messages" must be an array.', 400);
  }

  return raw.map((entry, index) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new ChatRequestError(`messages[${index}] must be an object.`, 400);
    }
    const role = (entry as { role?: unknown }).role;
    const content = (entry as { content?: unknown }).content;
    const images = (entry as { images?: unknown }).images;

    if (role !== "user" && role !== "assistant") {
      throw new ChatRequestError(`messages[${index}].role must be user or assistant.`, 400);
    }
    if (typeof content !== "string") {
      throw new ChatRequestError(`messages[${index}].content must be a string.`, 400);
    }

    const message: ClientChatMessage = { role, content };

    if (images !== undefined) {
      if (!Array.isArray(images)) {
        throw new ChatRequestError(`messages[${index}].images must be an array.`, 400);
      }
      message.images = images.map((image, imageIndex) => {
        if (typeof image !== "object" || image === null || Array.isArray(image)) {
          throw new ChatRequestError(
            `messages[${index}].images[${imageIndex}] must be an object.`,
            400,
          );
        }
        const mimeType = (image as { mimeType?: unknown }).mimeType;
        const dataBase64 = (image as { dataBase64?: unknown }).dataBase64;
        if (typeof mimeType !== "string" || typeof dataBase64 !== "string") {
          throw new ChatRequestError(
            `messages[${index}].images[${imageIndex}] needs mimeType and dataBase64 strings.`,
            400,
          );
        }
        return { mimeType, dataBase64 };
      });
    }

    return message;
  });
}

export async function POST(request: Request) {
  const unauthorized = await requireSession();
  if (unauthorized) return unauthorized;

  const forbidden = assertSameOrigin(request);
  if (forbidden) return forbidden;

  const ip = clientIp(request);
  if (isChatRateLimited(ip)) {
    return NextResponse.json<ApiError>(
      { error: "Too many chat requests. Wait a moment and try again." },
      { status: 429 },
    );
  }

  const apiKey = optionalEnv("OPENROUTER_API_KEY");
  if (!apiKey) {
    return NextResponse.json<ApiError>(
      { error: "OPENROUTER_API_KEY is not set. Add it to .env.local and restart the server." },
      { status: 400 },
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json<ApiError>({ error: "Request body must be JSON." }, { status: 400 });
  }

  let messages: ClientChatMessage[];
  try {
    messages = parseMessages(body.messages);
  } catch (error) {
    if (error instanceof ChatRequestError) {
      return NextResponse.json<ApiError>({ error: error.message }, { status: error.status });
    }
    return NextResponse.json<ApiError>({ error: "Invalid chat payload." }, { status: 400 });
  }

  const chatModelId = optionalEnv("OPENROUTER_MODEL_ID") ?? "";
  // Vision turns use OPENROUTER_IMAGE_MODEL_ID without tools; tool loops use the chat model.
  const imageModelId = optionalEnv("OPENROUTER_IMAGE_MODEL_ID");

  const lastUser = [...messages].reverse().find((message) => message.role === "user");
  await logRequestActivity(request, "chat.message", {
    summary: lastUser
      ? `Sent chat message: ${truncateForLog(lastUser.content)}`
      : "Sent chat message",
    metadata: {
      messageCount: messages.length,
      hasImages: Boolean(lastUser?.images?.length),
    },
  });

  return createSseStream(async (emit) => {
    // Emit an initial thinking status so the client shows status before the first model hop.
    emit({ type: "status", status: messages.some((m) => (m.images?.length ?? 0) > 0) ? "reading_image" : "thinking" });

    try {
      await runChatCompletion({
        messages,
        apiKey,
        chatModelId,
        imageModelId,
        emit,
        signal: request.signal,
      });
    } catch (error) {
      if (error instanceof ChatRequestError) {
        emit({ type: "error", message: error.message });
        return;
      }
      if ((error as { name?: string }).name === "AbortError") {
        emit({ type: "error", message: "Request aborted." });
        return;
      }
      console.error("[api/chat] POST failed", error);
      emit({ type: "error", message: "Chat request failed unexpectedly." });
    }
  });
}
