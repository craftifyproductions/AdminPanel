import type { Metadata } from "next";
import { LogoutButton } from "@/components/LogoutButton";
import { OpenRouterModelForm } from "@/components/OpenRouterModelForm";
import { getEnvStatus, optionalEnv } from "@/lib/env";

export const metadata: Metadata = {
  title: "Settings · Craftify AI Admin Panel",
};

export const dynamic = "force-dynamic";

const OPENROUTER_KEYS = new Set([
  "OPENROUTER_API_KEY",
  "OPENROUTER_MODEL_ID",
  "OPENROUTER_IMAGE_MODEL_ID",
]);

export default function SettingsPage() {
  const status = getEnvStatus();
  const envStatus = status.filter((entry) => !OPENROUTER_KEYS.has(entry.key));
  const openRouterApiKey = status.find((entry) => entry.key === "OPENROUTER_API_KEY");
  const chatModelId = optionalEnv("OPENROUTER_MODEL_ID") ?? "";
  const imageModelId = optionalEnv("OPENROUTER_IMAGE_MODEL_ID") ?? "";
  const missingRequired = envStatus.filter((entry) => entry.required && !entry.isSet);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold text-ink">Settings</h2>
          <p className="text-xs text-muted">
            Configuration is read from <code className="font-mono text-subtle">.env.local</code> on
            the server. Secrets are masked in the UI; OpenRouter model IDs are editable here.
          </p>
        </div>
        <LogoutButton />
      </div>

      {missingRequired.length > 0 ? (
        <p className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
          {missingRequired.length} required variable
          {missingRequired.length > 1 ? "s are" : " is"} missing:{" "}
          {missingRequired.map((entry) => entry.key).join(", ")}. Add{" "}
          {missingRequired.length > 1 ? "them" : "it"} to{" "}
          <code className="font-mono">.env.local</code> and restart the server.
        </p>
      ) : null}

      <div className="overflow-hidden rounded-lg border border-hairline bg-panel">
        <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
          <h3 className="text-sm font-medium text-ink">Environment</h3>
          <span className="text-[11px] text-subtle">
            {envStatus.filter((entry) => entry.isSet).length} of {envStatus.length} set
          </span>
        </div>

        <ul className="divide-y divide-hairline">
          {envStatus.map((entry) => (
            <li key={entry.key} className="flex items-start justify-between gap-4 px-4 py-3">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className={
                      entry.isSet
                        ? "size-1.5 rounded-full bg-ok"
                        : entry.required
                          ? "size-1.5 rounded-full bg-danger"
                          : "size-1.5 rounded-full bg-subtle"
                    }
                  />
                  <span className="font-mono text-xs text-ink">{entry.key}</span>
                  {entry.required ? null : (
                    <span className="rounded border border-hairline px-1 text-[10px] text-subtle">
                      optional
                    </span>
                  )}
                </div>
                <p className="pl-3.5 text-xs text-muted">{entry.description}</p>
              </div>

              <span className="shrink-0 font-mono text-xs text-subtle">
                {entry.isSet ? entry.masked : "not set"}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="overflow-hidden rounded-lg border border-hairline bg-panel">
        <div className="flex flex-col gap-1 border-b border-hairline px-4 py-3">
          <h3 className="text-sm font-medium text-ink">OpenRouter</h3>
          <p className="text-xs text-muted">
            Chat and image model IDs can be saved from this page. The API key is set only in{" "}
            <code className="font-mono text-subtle">.env.local</code> (not editable here).
          </p>
        </div>

        <ul className="divide-y divide-hairline">
          <li className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex items-center gap-2">
                <span
                  aria-hidden
                  className={
                    chatModelId ? "size-1.5 rounded-full bg-ok" : "size-1.5 rounded-full bg-subtle"
                  }
                />
                <span className="text-xs font-medium text-ink">Chat model ID</span>
                <span className="rounded border border-hairline px-1 text-[10px] text-subtle">
                  optional
                </span>
              </div>
              <p className="pl-3.5 text-xs text-muted">
                Written to <code className="font-mono text-subtle">OPENROUTER_MODEL_ID</code>
                {" · "}e.g. <code className="font-mono text-subtle">openai/gpt-4o-mini</code>.
                Leave blank to clear.
              </p>
            </div>
            <OpenRouterModelForm kind="chat" initialModelId={chatModelId} />
          </li>

          <li className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex items-center gap-2">
                <span
                  aria-hidden
                  className={
                    imageModelId ? "size-1.5 rounded-full bg-ok" : "size-1.5 rounded-full bg-subtle"
                  }
                />
                <span className="text-xs font-medium text-ink">Image model ID</span>
                <span className="rounded border border-hairline px-1 text-[10px] text-subtle">
                  optional
                </span>
              </div>
              <p className="pl-3.5 text-xs text-muted">
                Written to <code className="font-mono text-subtle">OPENROUTER_IMAGE_MODEL_ID</code>
                {" · "}vision / image model for attachments. Falls back to the chat model if unset.
              </p>
            </div>
            <OpenRouterModelForm kind="image" initialModelId={imageModelId} />
          </li>

          <li className="flex items-start justify-between gap-4 px-4 py-3">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span
                  aria-hidden
                  className={
                    openRouterApiKey?.isSet
                      ? "size-1.5 rounded-full bg-ok"
                      : "size-1.5 rounded-full bg-subtle"
                  }
                />
                <span className="text-xs font-medium text-ink">API key</span>
                <span className="rounded border border-hairline px-1 text-[10px] text-subtle">
                  optional
                </span>
              </div>
              <p className="pl-3.5 text-xs text-muted">
                Set <code className="font-mono text-subtle">OPENROUTER_API_KEY</code> in{" "}
                <code className="font-mono text-subtle">.env.local</code> only. Never shown in
                full; not editable from this UI.
              </p>
            </div>
            <span className="shrink-0 font-mono text-xs text-subtle">
              {openRouterApiKey?.isSet ? openRouterApiKey.masked : "not set"}
            </span>
          </li>
        </ul>
      </div>
    </div>
  );
}
