import { DealFieldsEditor } from "@/components/settings/deal-fields-editor";
import { READ_ONLY_NOTE, SettingsNav } from "@/components/settings/settings-nav";
import { Card } from "@/components/ui/card";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Notice } from "@/components/ui/form-message";
import { PageHeader } from "@/components/ui/page-header";
import { errorMessage } from "@/lib/action";
import { parseDealFieldDefs } from "@/lib/deals/stages";
import { requireOrg } from "@/lib/session";
import type { Metadata } from "next";
import { saveDealFields } from "../actions";

export const metadata: Metadata = { title: "Campi delle trattative" };

export default async function DealFieldsSettingsPage() {
  const { supabase, org } = await requireOrg();
  const { data: settings, error } = await supabase
    .from("org_settings")
    .select("deal_custom_fields")
    .eq("organization_id", org.organization.id)
    .maybeSingle();
  const defs = parseDealFieldDefs(settings?.deal_custom_fields);
  return (
    <>
      <PageHeader
        title="Campi delle trattative"
        back={{ href: "/app/impostazioni", label: "Impostazioni" }}
        description="I dati in più che vuoi su ogni trattativa, oltre a titolo, valore e prossima azione. Per esempio: tipo di polizza, scadenza, metri quadri."
      />
      <SettingsNav current="campi" />
      {!org.canManage ? (
        <Notice tone="neutral" className="mb-4">
          {READ_ONLY_NOTE}
        </Notice>
      ) : null}
      {error ? (
        <Notice tone="error" announce="alert" className="mb-4">
          {errorMessage(error)}
        </Notice>
      ) : null}
      <Card className="max-w-3xl">
        <ActionForm action={saveDealFields} className="grid gap-4">
          <DealFieldsEditor initial={defs} disabled={!org.canManage} />
          <p className="text-[13px] text-muted">
            Il codice è il nome con cui i flussi leggono e scrivono il campo; se lo lasci vuoto viene ricavato
            dall'etichetta e poi non cambia più. Togliere un campo non cancella i valori già salvati sulle
            trattative: smettono solo di comparire nel modulo.
          </p>
          {org.canManage ? (
            <div>
              <SubmitButton>Salva i campi</SubmitButton>
            </div>
          ) : null}
        </ActionForm>
      </Card>
    </>
  );
}
