import type { Metadata } from "next";
import { SupabaseBrowser } from "@/components/supabase/SupabaseBrowser";

export const metadata: Metadata = {
  title: "Supabase · Craftify AI Admin Panel",
};

export default function SupabasePage() {
  return <SupabaseBrowser />;
}
