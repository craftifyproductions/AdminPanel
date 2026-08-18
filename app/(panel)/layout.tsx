import type { ReactNode } from "react";
import { NavSidebar } from "@/components/NavSidebar";
import { SessionEndOnClose } from "@/components/SessionEndOnClose";
import { Topbar } from "@/components/Topbar";
import { ToastProvider } from "@/components/ui/Toast";

export default function PanelLayout({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <SessionEndOnClose />
      <div className="min-h-screen">
        <NavSidebar />
        <div className="flex min-h-screen flex-col pl-56">
          <Topbar />
          <main className="flex-1 px-6 py-6">{children}</main>
        </div>
      </div>
    </ToastProvider>
  );
}
