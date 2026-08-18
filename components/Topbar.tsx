"use client";

import { usePathname } from "next/navigation";
import { NAV_ITEMS, isActiveRoute } from "./nav-items";

export function Topbar() {
  const pathname = usePathname();
  const current = NAV_ITEMS.find((item) => isActiveRoute(pathname, item.href));

  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-hairline bg-canvas/90 px-6 backdrop-blur">
      <h1 className="text-sm font-medium text-ink">{current?.label ?? "Craftify AI"}</h1>
      <span className="font-mono text-[11px] text-subtle">{pathname}</span>
    </header>
  );
}
