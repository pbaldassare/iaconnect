import { Placeholder } from "@/components/placeholder";
import { requireOrg } from "@/lib/session";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Inbox" };

export default async function InboxPage() {
  await requireOrg();
  return <Placeholder title="Inbox" description="Le conversazioni di tutti i canali in un posto solo." />;
}
