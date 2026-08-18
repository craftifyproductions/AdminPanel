export type ChatRole = "system" | "user" | "assistant" | "tool";

export type ChatImagePart = {
  type: "image_url";
  image_url: { url: string };
};

export type ChatTextPart = {
  type: "text";
  text: string;
};

export type ChatContentPart = ChatTextPart | ChatImagePart;

export type ChatToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type ChatMessage = {
  role: ChatRole;
  content: string | ChatContentPart[] | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ChatToolCall[];
};

export type ClientImage = {
  mimeType: string;
  dataBase64: string;
};

export type ClientChatMessage = {
  role: "user" | "assistant";
  content: string;
  images?: ClientImage[];
};

export type ChatStatus =
  | "thinking"
  | "reading_image"
  | "writing"
  | "generating_image"
  | "tool";

export type ChatSseEvent =
  | { type: "status"; status: ChatStatus; detail?: string }
  | { type: "delta"; text: string }
  | { type: "image"; url: string; alt?: string }
  | { type: "warning"; message: string }
  | { type: "error"; message: string }
  | { type: "done" };
