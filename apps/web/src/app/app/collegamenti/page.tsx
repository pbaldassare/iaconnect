import { Placeholder } from "@/components/placeholder";
import { requireOrg } from "@/lib/session";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Collegamenti" };

export default async function CollegamentiPage() {
  await requireOrg();
  return (
    <Placeholder
      title="Collegamenti"
      description="I sistemi collegati alla tua azienda: mail, WhatsApp, gestionale."
    />
  );
}
