import { AssistantChat } from "@/components/flows/assistant-chat";
import { ButtonLink } from "@/components/ui/button";
import { Notice } from "@/components/ui/form-message";
import { PageHeader } from "@/components/ui/page-header";
import { loadFlowPermissions } from "@/lib/flows/server";
import { requireOrgManager } from "@/lib/session";
import { hasServiceKey } from "@/lib/supabase/service";
import type { Metadata } from "next";
import { askAssistant, saveProposal } from "../assistant-actions";

export const metadata: Metadata = { title: "Crea con l'assistente" };

const EXAMPLES: Record<string, string[]> = {
  insurance: [
    "Quando arriva una mail con una richiesta di preventivo, ricava nome, telefono e tipo di polizza, scrivi al cliente su WhatsApp con il modello approvato e apri una trattativa. Se dopo due giorni non risponde, mandagli un sollecito.",
  ],
  ecommerce: [
    "Quando arriva un nuovo ordine, conferma al cliente su WhatsApp e, se chiede a che punto è, rispondi leggendo lo stato dal gestionale.",
  ],
  real_estate: [
    "Quando esce un nuovo immobile su un portale, trova i contatti che cercano in quella zona con un budget compatibile e avvisami con l'elenco.",
  ],
  other: [
    "Quando arriva un messaggio WhatsApp fuori orario, rispondi che richiameremo domani e avvisa il titolare nell'app.",
  ],
};

export default async function NewFlowPage() {
  const context = await requireOrgManager();
  const permissions = await loadFlowPermissions(context);
  const ready = Boolean(process.env.ANTHROPIC_API_KEY) && hasServiceKey();

  return (
    <>
      <PageHeader
        title="Crea con l'assistente"
        description="L'IA progetta il flusso una volta sola; poi lo esegue il server, senza altra IA se non nei passi che la dichiarano."
        back={{ href: "/app/flussi", label: "Flussi" }}
        actions={
          <ButtonLink href="/app/flussi/modelli" variant="secondary">
            Parti da un modello
          </ButtonLink>
        }
      />
      <div className="grid gap-5">
        {!permissions.canUseAssistant ? (
          <Notice tone="warning" title="Assistente non attivo">
            L'assistente dei flussi non è attivo per la tua azienda. Puoi partire da un modello della libreria
            oppure chiedere all'assistenza di attivarlo.
          </Notice>
        ) : (
          <>
            {!ready ? (
              <Notice tone="warning" title="L'assistente non è ancora configurato su questo server">
                {process.env.ANTHROPIC_API_KEY
                  ? "Manca la chiave di servizio Supabase (SUPABASE_SERVICE_ROLE_KEY), che serve a registrare l'uso dell'IA."
                  : "Manca la chiave ANTHROPIC_API_KEY."}{" "}
                Finché non viene impostata, le richieste all'assistente vengono rifiutate.
              </Notice>
            ) : null}
            <AssistantChat
              flowId={null}
              ask={askAssistant}
              save={saveProposal}
              examples={EXAMPLES[context.org.organization.sector] ?? EXAMPLES.other}
            />
          </>
        )}
      </div>
    </>
  );
}
