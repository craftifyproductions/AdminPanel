"use client";

import type { InputHTMLAttributes, Ref } from "react";
import { cn } from "@/lib/cn";

export type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  invalid?: boolean;
  ref?: Ref<HTMLInputElement>;
};

export function Input({ invalid = false, className, ...rest }: InputProps) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cn(
        "h-10 w-full rounded-md border bg-canvas px-3 text-sm text-ink transition-colors duration-150",
        "placeholder:text-subtle",
        "disabled:cursor-not-allowed disabled:opacity-50",
        invalid
          ? "border-danger/60 focus:border-danger"
          : "border-hairline hover:border-hairline-strong focus:border-accent",
        className,
      )}
      {...rest}
    />
  );
}
