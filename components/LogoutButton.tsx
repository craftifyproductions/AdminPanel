"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, type ButtonVariant } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/cn";

type LogoutButtonProps = {
  className?: string;
  variant?: ButtonVariant;
  iconClassName?: string;
};

export function LogoutButton({
  className,
  variant = "ghost",
  iconClassName,
}: LogoutButtonProps) {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState(false);

  async function onClick() {
    setPending(true);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("Logout failed");
      router.replace("/login");
      router.refresh();
    } catch {
      toast.error("Could not sign out. Please try again.");
      setPending(false);
    }
  }

  return (
    <Button
      variant={variant}
      size="sm"
      loading={pending}
      onClick={onClick}
      className={className}
    >
      {pending ? null : (
        <LogOut aria-hidden className={cn("size-3.5", iconClassName)} />
      )}
      Sign out
    </Button>
  );
}
