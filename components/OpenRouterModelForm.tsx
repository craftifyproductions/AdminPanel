"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { saveOpenRouterImageModelId, saveOpenRouterModelId } from "@/lib/settings-client";

type Kind = "chat" | "image";

type Props = {
  kind: Kind;
  initialModelId: string;
};

const LABELS: Record<Kind, { aria: string; placeholder: string; successSet: string; successClear: string }> =
  {
    chat: {
      aria: "Chat model ID",
      placeholder: "openai/gpt-4o-mini",
      successSet: "Chat model set to",
      successClear: "Chat model ID cleared.",
    },
    image: {
      aria: "Image model ID",
      placeholder: "openai/gpt-4o",
      successSet: "Image model set to",
      successClear: "Image model ID cleared.",
    },
  };

export function OpenRouterModelForm({ kind, initialModelId }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [value, setValue] = useState(initialModelId);
  const [saved, setSaved] = useState(initialModelId);
  const [saving, setSaving] = useState(false);
  const labels = LABELS[kind];

  const dirty = value.trim() !== saved;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const result =
        kind === "chat"
          ? await saveOpenRouterModelId(value)
          : await saveOpenRouterImageModelId(value);
      const next = kind === "chat" ? result.modelId : result.imageModelId;
      setSaved(next);
      setValue(next);
      toast.success(next ? `${labels.successSet} “${next}”.` : labels.successClear);
      router.refresh();
    } catch (error) {
      const message = error instanceof Error && error.message ? error.message : "Could not save.";
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex w-full max-w-md flex-col gap-2 sm:items-end">
      <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          disabled={saving}
          placeholder={labels.placeholder}
          autoComplete="off"
          spellCheck={false}
          className="font-mono text-xs"
          aria-label={labels.aria}
        />
        <Button type="submit" size="sm" loading={saving} disabled={!dirty && !saving}>
          Save
        </Button>
      </div>
    </form>
  );
}
