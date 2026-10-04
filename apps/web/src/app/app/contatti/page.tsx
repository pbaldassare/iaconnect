import { Placeholder } from "@/components/placeholder";
import { requireOrg } from "@/lib/session";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Contatti" };

export default async function ContattiPage() {
  await requireOrg();
  return (
    <Placeholder title="Contatti" description="Le persone con cui l'azienda parla, con storico e consensi." />
  );
}
