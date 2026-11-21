import { AiTrainingEditor } from "@/components/settings/ai-training-editor";
import { READ_ONLY_NOTE, SettingsNav } from "@/components/settings/settings-nav";
import { AiBadge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Notice } from "@/components/ui/form-message";
import { PageHeader } from "@/components/ui/page-header";
import { errorMessage } from "@/lib/action";
import { requireOrg } from "@/lib/session";
import { aiTrainingFormValues } from "@/lib/settings/ai-training";
import { businessProfileFormValues } from "@/lib/settings/business-profile";
import { buildOrgAiInstructions } from "@ia-connect/core";
import type { Metadata } from "next";
import Link from "next/link";
import { saveAiTraining } from "../actions";

export const metadata: Metadata = { title: "Allenamento IA" };

export default async function AiTrainingPage() {
  const { supabase, org } = await requireOrg();
  const { data: settings, error } = await supabase
    .from("org_settings")
    .select("ai_training, ai_instructions, business_profile")
    .eq("organization_id", org.organization.id)
    .maybeSingle();
  const training = aiTrainingFormValues(settings?.ai_training);
  const profile = businessProfileFormValues(settings?.business_profile);
  const preview = buildOrgAiInstructions({
    manual: settings?.ai_instructions,
    businessProfile: profile,
    aiTraining: training,
  });
  const disabled = !org.canManage;

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            Allenamento IA <AiBadge />
          </span>
        }
        back={{ href: "/app/impostazioni", label: "Impostazioni" }}
        description="Insegna all'IA come rispondere su WhatsApp: domande frequenti e risposte verificate, per ogni cliente."
      />
      <SettingsNav current="allenamento" canManage={org.canManage} />
      {disabled ? (
        <Notice tone="neutral" className="mb-4">
          {READ_ONLY_NOTE}
        </Notice>
      ) : null}
      {error ? (
        <Notice tone="error" announce="alert" className="mb-4">
          {errorMessage(error)}
        </Notice>
      ) : null}
      <Notice tone="neutral" className="mb-4">
        <strong>Wallet crediti IA:</strong> in produzione collegheremo qui il wallet con i consumi del piano.
        Per ora non viene scalato nulla in questa schermata.
      </Notice>
      <Notice tone="neutral" className="mb-4">
        Prima compila{" "}
        <Link
          href="/app/impostazioni/azienda"
          className="font-medium text-accent underline-offset-2 hover:underline"
        >
          Profilo azienda
        </Link>{" "}
        (sedi e orari), poi aggiungi qui le risposte tipo.
      </Notice>
      <Card className="max-w-3xl">
        <ActionForm action={saveAiTraining} className="grid gap-6">
          <AiTrainingEditor initial={training} disabled={disabled} />
          {disabled ? null : (
            <div>
              <SubmitButton>Salva allenamento</SubmitButton>
            </div>
          )}
        </ActionForm>
      </Card>
      {preview ? (
        <Card className="mt-6 max-w-3xl">
          <h2 className="mb-2 font-display text-[15px] font-bold">Anteprima contesto IA</h2>
          <p className="mb-3 text-sm text-muted">
            Così viene riassunto al modello (senza dati del contatto).
          </p>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-2 p-4 text-sm leading-relaxed">
            {preview}
          </pre>
        </Card>
      ) : null}
    </>
  );
}
