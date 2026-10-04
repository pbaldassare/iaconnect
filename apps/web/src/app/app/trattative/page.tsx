import { Placeholder } from "@/components/placeholder";
import { requireOrg } from "@/lib/session";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Trattative" };

export default async function TrattativePage() {
  await requireOrg();
  return <Placeholder title="Trattative" description="Le trattative aperte, fase per fase." />;
}
