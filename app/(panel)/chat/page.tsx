import type { Metadata } from "next";
import { ChatPanel } from "@/components/chat/ChatPanel";

export const metadata: Metadata = {
  title: "Chat · Craftify AI Admin Panel",
};

export default function ChatPage() {
  return (
    <div className="-mx-6 -my-6">
      <ChatPanel />
    </div>
  );
}
