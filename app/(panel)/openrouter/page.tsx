import type { Metadata } from "next";
import { OpenRouterUsageSection } from "@/components/openrouter/OpenRouterUsageSection";

export const metadata: Metadata = {
  title: "OpenRouter · Craftify AI Admin Panel",
};

export default function OpenRouterPage() {
  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <OpenRouterUsageSection />
    </div>
  );
}
