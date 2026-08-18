"use client";

import { HardDrive } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoutButton } from "@/components/LogoutButton";
import { cn } from "@/lib/cn";
import { NAV_ITEMS, isActiveRoute } from "./nav-items";

export function NavSidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed inset-y-0 left-0 z-30 flex w-56 flex-col border-r border-hairline bg-panel">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-hairline px-4">
        <span className="flex size-7 items-center justify-center rounded-md border border-hairline bg-raised text-accent">
          <HardDrive aria-hidden className="size-3.5" />
        </span>
        <span className="text-sm font-semibold text-ink">Craftify AI</span>
      </div>

      <nav
        aria-label="Main"
        className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2"
      >
        {NAV_ITEMS.map((item) => {
          const active = isActiveRoute(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors duration-150",
                active
                  ? "bg-accent/12 text-accent-ink"
                  : "text-muted hover:bg-raised hover:text-ink",
              )}
            >
              <Icon aria-hidden className="size-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto shrink-0 border-t border-hairline">
        <div className="px-4 py-3 text-[11px] text-subtle">Cloudflare R2 management</div>
        <div className="border-t border-hairline p-2">
          <LogoutButton
            iconClassName="size-4"
            className="h-auto w-full justify-start gap-2 border-transparent px-3 py-2 text-sm font-normal text-muted hover:border-transparent hover:bg-danger/10 hover:text-danger"
          />
        </div>
      </div>
    </aside>
  );
}
