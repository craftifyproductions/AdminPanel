import type { Metadata } from "next";
import { ActivityLogsPanel } from "@/components/logs/ActivityLogsPanel";

export const metadata: Metadata = {
  title: "Logs · Craftify AI Admin Panel",
};

export default function LogsPage() {
  return <ActivityLogsPanel />;
}
