import type { ClientChatMessage } from "@/lib/chat/types";

/** Explicit admin / R2 / generation actions that need tools. */
const TOOL_INTENT_RE = new RegExp(
  [
    String.raw`\b(?:list|browse)\b[\s\S]{0,40}\b(?:folder|bucket|files?|prefix|directory|dir|objects?)\b`,
    String.raw`\b(?:delete|remove|rename|move|upload|overwrite)\b`,
    String.raw`\b(?:put|write|create)\b[\s\S]{0,40}\b(?:file|object|key|text)\b`,
    String.raw`\bswitch\b[\s\S]{0,20}\bbucket\b`,
    String.raw`\b(?:get|read|fetch|download)\b[\s\S]{0,40}\b(?:object|file|key|stats?|settings|bucket)\b`,
    String.raw`\b(?:list_folder|get_object_text|put_object_text|delete_object|rename_object|get_stats|list_buckets|switch_bucket|generate_image|get_settings_overview)\b`,
    String.raw`\b(?:r2|buckets?)\b`,
    String.raw`\b(?:generate|create)\b[\s\S]{0,30}\b(?:image|picture|photo)\b`,
    String.raw`\b(?:how many|count)\b[\s\S]{0,30}\b(?:objects?|files?)\b`,
    String.raw`\b(?:bucket\s+)?stats\b`,
  ].join("|"),
  "i",
);

const TOOL_USE_ERROR_RE =
  /tool use|support tool|tools? (?:are|is) not supported|does not support tools?|no endpoints found that support tool|tool calling|tool_choice|tools parameter/i;

export function lastUserText(messages: ClientChatMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "user") return messages[i].content;
  }
  return "";
}

export function hasExplicitToolIntent(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return TOOL_INTENT_RE.test(trimmed);
}

export function isToolUseUnsupportedError(message: string): boolean {
  return TOOL_USE_ERROR_RE.test(message);
}

export type ChatRouteMode =
  /** Images present, no R2/admin tool intent — vision Q&A without tools. */
  | "vision"
  /** Needs tools (text-only turn). */
  | "tools"
  /** Images + tool intent — prefer multimodal chat+tools, else describe-then-act. */
  | "hybrid";

export function resolveChatRoute(options: {
  hasImages: boolean;
  userText: string;
}): ChatRouteMode {
  const toolIntent = hasExplicitToolIntent(options.userText);
  if (options.hasImages && !toolIntent) return "vision";
  if (options.hasImages && toolIntent) return "hybrid";
  return "tools";
}
