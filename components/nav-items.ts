import {
  Database,
  HardDrive,
  LayoutDashboard,
  MessageSquare,
  ScrollText,
  Settings,
  Sparkles,
} from "lucide-react";

export const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/r2", label: "R2 Hub", icon: HardDrive },
  { href: "/supabase", label: "Supabase", icon: Database },
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/openrouter", label: "OpenRouter", icon: Sparkles },
  { href: "/logs", label: "Logs", icon: ScrollText },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

export type NavItem = (typeof NAV_ITEMS)[number];

export function isActiveRoute(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}
