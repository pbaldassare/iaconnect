import { READ_ONLY_NOTE, SettingsNav } from "@/components/settings/settings-nav";
import { AiBadge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Notice } from "@/components/ui/form-message";
import { Input, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { errorMessage } from "@/lib/action";
import { requireOrg } from "@/lib/session";
import type { Metadata } from "next";
import { saveAssistant } from "../actions";

export const metadata: Metadata = { title: "Assistente IA" };

export default async function AssistantSettingsPage() {
  const { supabase, org } = await requireOrg();
  const { data: settings, error } = await supabase
    .from("org_settings")
    .select("ai_tone, ai_instructions, out_of_scope_reply, ai_disclosure")
    .eq("organization_id", org.organization.id)
    .maybeSingle();
  const disabled = !org.canManage;
  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            Assistente IA <AiBadge />
          </span>
        }
        back={{ href: "/app/impostazioni", label: "Impostazioni" }}
        description="Come parla l'IA quando un flusso le fa rispondere a un contatto. Non cambia cosa fanno i flussi."
      />
      <SettingsNav current="assistente" />
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
      <Card className="max-w-3xl">
        <ActionForm action={saveAssistant} className="grid gap-5">
          <Field
            label="Tono"
            htmlFor="ai_tone"
            name="ai_tone"
            optional
            hint="Usato in ogni risposta scritta dall'IA. Per esempio: «Cordiale e diretto, dà del lei, frasi brevi»."
          >
            <Input
              id="ai_tone"
              name="ai_tone"
              defaultValue={settings?.ai_tone ?? ""}
              maxLength={300}
              disabled={disabled}
            />
          </Field>
          <Field
            label="Istruzioni"
            htmlFor="ai_instructions"
            name="ai_instructions"
            optional
            hint="Cosa deve sapere e rispettare l'IA quando risponde: orari, cosa offrite, cosa non promettere mai. Viene letto a ogni risposta, insieme alla memoria del contatto."
          >
            <Textarea
              id="ai_instructions"
              name="ai_instructions"
              rows={8}
              defaultValue={settings?.ai_instructions ?? ""}
              maxLength={4000}
              disabled={disabled}
            />
          </Field>
          <Field
            label="Risposta fuori tema"
            htmlFor="out_of_scope_reply"
            name="out_of_scope_reply"
            hint="La frase fissa inviata quando il contatto chiede qualcosa che l'IA non deve trattare. Non la scrive l'IA: parte così com'è."
          >
            <Textarea
              id="out_of_scope_reply"
              name="out_of_scope_reply"
              rows={2}
              defaultValue={settings?.out_of_scope_reply ?? ""}
              maxLength={500}
              required
              disabled={disabled}
            />
          </Field>
          <Field
            label="Avviso di messaggio automatico"
            htmlFor="ai_disclosure"
            name="ai_disclosure"
            hint="Aggiunta al primo messaggio automatico di ogni conversazione, se il testo non dice già che è automatico. I modelli WhatsApp approvati partono senza."
          >
            <Input
              id="ai_disclosure"
              name="ai_disclosure"
              defaultValue={settings?.ai_disclosure ?? ""}
              maxLength={300}
              required
              disabled={disabled}
            />
          </Field>
          {disabled ? null : (
            <div>
              <SubmitButton>Salva</SubmitButton>
            </div>
          )}
        </ActionForm>
      </Card>
    </>
  );
}
