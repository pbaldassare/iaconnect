import { Placeholder } from "@/components/placeholder";
import { requireOrg } from "@/lib/session";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Report" };

export default async function ReportPage() {
  await requireOrg();
  return <Placeholder title="Report" description="Risultati e ritorno economico." />;
}
