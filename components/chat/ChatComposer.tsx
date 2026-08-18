"use client";

import { ImagePlus, SendHorizontal, X } from "lucide-react";
import {
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import type { ClientImage } from "@/lib/chat/types";
import { cn } from "@/lib/cn";

const PASTE_COLLAPSE_CHARS = 500;
const MAX_IMAGES = 4;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const ALLOWED = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export type ComposerAttachment = ClientImage & {
  id: string;
  previewUrl: string;
};

export type ComposerSubmit = {
  content: string;
  images: ClientImage[];
};

type Props = {
  disabled?: boolean;
  onSubmit: (payload: ComposerSubmit) => void;
};

type PasteBlock = {
  id: string;
  text: string;
  expanded: boolean;
};

async function fileToAttachment(file: File): Promise<ComposerAttachment> {
  if (!ALLOWED.has(file.type)) {
    throw new Error("Images must be PNG, JPEG, GIF, or WebP.");
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error("Each image must be at most 4 MiB.");
  }

  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }
  const dataBase64 = btoa(binary);

  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    mimeType: file.type,
    dataBase64,
    previewUrl: URL.createObjectURL(file),
  };
}

export function ChatComposer({ disabled = false, onSubmit }: Props) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [pastes, setPastes] = useState<PasteBlock[]>([]);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);

  function revokeAll(items: ComposerAttachment[]) {
    for (const item of items) URL.revokeObjectURL(item.previewUrl);
  }

  async function addFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (list.length === 0) return;
    if (attachments.length + list.length > MAX_IMAGES) {
      toast.error(`You can attach at most ${MAX_IMAGES} images.`);
      return;
    }

    try {
      const next = await Promise.all(list.map((file) => fileToAttachment(file)));
      setAttachments((current) => [...current, ...next]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not attach image.");
    }
  }

  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const items = event.clipboardData?.items;
    if (items) {
      const imageFiles: File[] = [];
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) imageFiles.push(file);
        }
      }
      if (imageFiles.length > 0) {
        event.preventDefault();
        void addFiles(imageFiles);
        return;
      }
    }

    const pasted = event.clipboardData?.getData("text") ?? "";
    if (pasted.length > PASTE_COLLAPSE_CHARS) {
      event.preventDefault();
      setPastes((current) => [
        ...current,
        {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          text: pasted,
          expanded: false,
        },
      ]);
    }
  }

  function removeAttachment(id: string) {
    setAttachments((current) => {
      const target = current.find((item) => item.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return current.filter((item) => item.id !== id);
    });
  }

  function buildContent(): string {
    const parts = [text.trim(), ...pastes.map((block) => block.text)];
    return parts.filter(Boolean).join("\n\n");
  }

  function submit() {
    if (disabled) return;
    const content = buildContent();
    if (!content && attachments.length === 0) return;

    onSubmit({
      content,
      images: attachments.map(({ mimeType, dataBase64 }) => ({ mimeType, dataBase64 })),
    });

    revokeAll(attachments);
    setAttachments([]);
    setPastes([]);
    setText("");
  }

  function onFormSubmit(event: FormEvent) {
    event.preventDefault();
    submit();
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    if (files) void addFiles(files);
    event.target.value = "";
  }

  return (
    <form
      onSubmit={onFormSubmit}
      className="border-t border-hairline bg-panel/95 px-4 py-3 backdrop-blur"
    >
      {pastes.length > 0 ? (
        <div className="mb-2 flex flex-col gap-2">
          {pastes.map((block) => (
            <div
              key={block.id}
              className="rounded-md border border-hairline bg-raised px-3 py-2 text-xs"
            >
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 text-left text-muted hover:text-ink"
                onClick={() =>
                  setPastes((current) =>
                    current.map((entry) =>
                      entry.id === block.id ? { ...entry, expanded: !entry.expanded } : entry,
                    ),
                  )
                }
              >
                <span>
                  Pasted text ({block.text.length.toLocaleString()} characters)
                </span>
                <span className="text-subtle">{block.expanded ? "Collapse" : "Expand"}</span>
              </button>
              {block.expanded ? (
                <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-ink/90">
                  {block.text}
                </pre>
              ) : null}
              <button
                type="button"
                className="mt-2 text-[11px] text-danger hover:text-danger-hover"
                onClick={() => setPastes((current) => current.filter((entry) => entry.id !== block.id))}
              >
                Remove paste
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {attachments.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-2">
          {attachments.map((item) => (
            <div
              key={item.id}
              className="relative size-16 overflow-hidden rounded-md border border-hairline bg-raised"
            >
              {/* preview of user-attached local blob */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={item.previewUrl} alt="" className="size-full object-cover" />
              <button
                type="button"
                aria-label="Remove image"
                className="absolute right-0.5 top-0.5 rounded bg-canvas/80 p-0.5 text-muted hover:text-ink"
                onClick={() => removeAttachment(item.id)}
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex items-end gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          multiple
          className="hidden"
          onChange={onFileChange}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled || attachments.length >= MAX_IMAGES}
          onClick={() => fileRef.current?.click()}
          aria-label="Attach image"
          className="shrink-0"
        >
          <ImagePlus className="size-4" />
        </Button>

        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onPaste={onPaste}
          onKeyDown={onKeyDown}
          disabled={disabled}
          rows={2}
          placeholder="Ask about R2, files, settings…"
          className={cn(
            "max-h-40 min-h-[2.75rem] flex-1 resize-y rounded-md border border-hairline bg-canvas px-3 py-2 text-sm text-ink",
            "placeholder:text-subtle focus:border-accent disabled:opacity-50",
          )}
        />

        <Button
          type="submit"
          size="sm"
          disabled={disabled || (!text.trim() && pastes.length === 0 && attachments.length === 0)}
          aria-label="Send"
          className="shrink-0"
        >
          <SendHorizontal className="size-4" />
        </Button>
      </div>
      <p className="mt-2 text-[11px] text-subtle">
        Enter to send · Shift+Enter for a new line · Paste images or large text blocks supported
      </p>
    </form>
  );
}
