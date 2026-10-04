import { Placeholder } from "@/components/placeholder";
import { requireOrg } from "@/lib/session";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Flussi" };

export default async function FlussiPage() {
  await requireOrg();
  return <Placeholder title="Flussi" description="Le automazioni che lavorano per te." />;
}
