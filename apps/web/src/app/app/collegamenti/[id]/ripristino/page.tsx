import { RecoverySheetView } from "@/components/connections/recovery-sheet";
import { PageHeader } from "@/components/ui/page-header";
import { recoverySheet, showsRecoverySheet } from "@/lib/connections/recovery";
import { isUuid } from "@/lib/org-selection";
import { requireOrgManager } from "@/lib/session";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

export const metadata: Metadata = { title: "Dati per il ripristino" };

export default async function ConnectionRecoveryPage({ params }: { params: Promise<{ id: string }> }) {
  const { supabase, org } = await requireOrgManager();
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const { data: connection } = await supabase
    .from("connections")
    .select("id, name, status, connector_type, config, external_account_id")
    .eq("id", id)
    .eq("organization_id", org.organization.id)
    .maybeSingle();
  if (!connection) notFound();

  const { data: type } = await supabase
    .from("connector_types")
    .select("connect_mode")
    .eq("key", connection.connector_type)
    .maybeSingle();
  if (!showsRecoverySheet(connection.connector_type, type?.connect_mode ?? "")) notFound();

  const sheet = recoverySheet({
    externalAccountId: connection.external_account_id,
    config: connection.config,
  });

  return (
    <>
      <PageHeader
        title="Dati per il ripristino"
        description="Dati pubblici per ripristinare la sessione WhatsApp sul gateway. La chiave di accesso non è in questa pagina."
        context={connection.name}
        back={{ href: `/app/collegamenti/${connection.id}`, label: "Collegamento" }}
      />
      <RecoverySheetView name={connection.name} status={connection.status} sheet={sheet} />
    </>
  );
}
