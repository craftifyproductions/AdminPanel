"use client";

import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { useIsClient } from "./use-is-client";

export type ToastVariant = "success" | "error" | "info";

type ToastItem = {
  id: number;
  message: string;
  variant: ToastVariant;
};

export type ToastApi = {
  success: (message: string) => number;
  error: (message: string) => number;
  info: (message: string) => number;
  dismiss: (id: number) => void;
};

const TOAST_DURATION_MS = 4500;

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast() must be used inside a <ToastProvider>.");
  return api;
}

const VARIANT_STYLES: Record<ToastVariant, string> = {
  success: "border-ok/40 text-ok",
  error: "border-danger/40 text-danger",
  info: "border-hairline-strong text-accent-ink",
};

const VARIANT_ICONS: Record<ToastVariant, typeof Info> = {
  success: CircleCheck,
  error: CircleAlert,
  info: Info,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const isClient = useIsClient();
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (variant: ToastVariant, message: string) => {
      const id = nextId.current;
      nextId.current += 1;
      setToasts((current) => [...current.slice(-3), { id, message, variant }]);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), TOAST_DURATION_MS),
      );
      return id;
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (message: string) => push("success", message),
      error: (message: string) => push("error", message),
      info: (message: string) => push("info", message),
      dismiss,
    }),
    [push, dismiss],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {isClient
        ? createPortal(
            <div
              aria-live="polite"
              className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 flex-col gap-2"
            >
              {toasts.map((toast) => {
                const Icon = VARIANT_ICONS[toast.variant];
                return (
                  <div
                    key={toast.id}
                    className={cn(
                      "pointer-events-auto flex items-start gap-2 rounded-md border bg-panel px-3 py-2 shadow-lg shadow-black/40",
                      VARIANT_STYLES[toast.variant],
                    )}
                  >
                    <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
                    <p className="flex-1 text-xs leading-5 text-ink">{toast.message}</p>
                    <button
                      type="button"
                      onClick={() => dismiss(toast.id)}
                      aria-label="Dismiss notification"
                      className="rounded p-0.5 text-subtle transition-colors duration-150 hover:text-ink"
                    >
                      <X aria-hidden className="size-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </ToastContext.Provider>
  );
}
