import { AssistantChat } from "@/components/flows/assistant-chat";
import { Notice } from "@/components/ui/form-message";
import { PageHeader } from "@/components/ui/page-header";
import { loadFlowPermissions } from "@/lib/flows/server";
import { isUuid } from "@/lib/org-selection";
import { requireOrgManager } from "@/lib/session";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { askAssistant, saveProposal } from "../../assistant-actions";

export const metadata: Metadata = { title: "Modifica con l'assistente" };

export default async function EditWithAssistantPage({ params }: { params: Promise<{ id: string }> }) {
  const context = await requireOrgManager();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const { data: flow } = await context.supabase
    .from("flows")
    .select("id, name")
    .eq("id", id)
    .eq("organization_id", context.org.organization.id)
    .maybeSingle();
  if (!flow) notFound();
  const permissions = await loadFlowPermissions(context);

  return (
    <>
      <PageHeader
        title="Modifica con l'assistente"
        description="L'assistente parte dall'ultima versione del flusso. La modifica viene salvata come nuova versione in bozza: quella attiva non cambia finché non attivi la nuova."
        back={{ href: `/app/flussi/${flow.id}`, label: flow.name }}
      />
      {permissions.canUseAssistant ? (
        <AssistantChat
          flowId={flow.id}
          flowName={flow.name}
          ask={askAssistant}
          save={saveProposal}
          examples={[
            "Aggiungi un sollecito dopo tre giorni se il cliente non risponde.",
            "Prima di inviare il messaggio chiedi la mia approvazione.",
          ]}
        />
      ) : (
        <Notice tone="warning" title="Assistente non attivo">
          L'assistente dei flussi non è attivo per la tua azienda.
        </Notice>
      )}
    </>
  );
}
