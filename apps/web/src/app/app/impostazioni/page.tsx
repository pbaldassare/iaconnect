import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { requireOrg } from "@/lib/session";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Impostazioni" };

/** Placeholder: the settings agent replaces this page. Keep the link to the Registro. */
export default async function SettingsPage() {
  await requireOrg();
  return (
    <>
      <PageHeader title="Impostazioni" description="Utenti, modelli di messaggio, tono dell'IA e marchio." />
      <div className="grid gap-4">
        <Card>
          <CardHeader
            title="Registro delle azioni"
            description="Chi ha fatto cosa nella tua azienda, compresi gli accessi dell'assistenza."
            actions={
              <ButtonLink href="/app/impostazioni/registro" variant="secondary" size="sm">
                Apri il registro
              </ButtonLink>
            }
            className="mb-0"
          />
        </Card>
        <EmptyState title="In costruzione" description="Le altre impostazioni arrivano tra poco." />
      </div>
    </>
  );
}
