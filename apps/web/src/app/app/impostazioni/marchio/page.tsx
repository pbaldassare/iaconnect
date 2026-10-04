import { READ_ONLY_NOTE, SettingsNav } from "@/components/settings/settings-nav";
import { Card, CardHeader } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Notice } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { errorMessage } from "@/lib/action";
import { requireOrg } from "@/lib/session";
import { orgBrandFormValues } from "@/lib/settings/brand";
import type { Metadata } from "next";
import { saveBrand } from "../actions";

export const metadata: Metadata = { title: "Marchio" };

export default async function BrandSettingsPage() {
  const { supabase, org } = await requireOrg();
  const { data: settings, error } = await supabase
    .from("org_settings")
    .select("brand")
    .eq("organization_id", org.organization.id)
    .maybeSingle();
  const values = orgBrandFormValues(settings?.brand);
  const disabled = !org.canManage;
  return (
    <>
      <PageHeader
        title="Marchio"
        back={{ href: "/app/impostazioni", label: "Impostazioni" }}
        description="Come compare la tua azienda in questa applicazione e a chi arrivano gli avvisi per il titolare."
      />
      <SettingsNav current="marchio" />
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
        <ActionForm action={saveBrand} className="grid gap-6">
          <div className="grid gap-4">
            <CardHeader title="Aspetto" className="mb-0" />
            <Field
              label="Nome mostrato"
              htmlFor="name"
              name="name"
              optional
              hint={`Se lo lasci vuoto si usa il nome dell'azienda: ${org.organization.name}.`}
            >
              <Input id="name" name="name" defaultValue={values.name} maxLength={60} disabled={disabled} />
            </Field>
            <Field
              label="Indirizzo del logo"
              htmlFor="logoUrl"
              name="logoUrl"
              optional
              hint="Un'immagine quadrata già pubblicata su internet, con indirizzo https://"
            >
              <Input
                id="logoUrl"
                name="logoUrl"
                type="url"
                defaultValue={values.logoUrl}
                disabled={disabled}
              />
            </Field>
            <Field
              label="Colore"
              htmlFor="accent"
              name="accent"
              optional
              hint="Nel formato #rrggbb. Colora solo il riquadro del marchio in alto a sinistra."
            >
              <Input
                id="accent"
                name="accent"
                defaultValue={values.accent}
                placeholder="#1f7a4d"
                maxLength={7}
                className="max-w-40 font-mono"
                disabled={disabled}
              />
            </Field>
          </div>
          <div className="grid gap-4 border-t border-line pt-5">
            <CardHeader
              title="Recapiti del titolare"
              description="Dove i flussi mandano gli avvisi per il titolare (per esempio «un cliente chiede di parlare con una persona»)."
              className="mb-0"
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Telefono per gli avvisi WhatsApp"
                htmlFor="ownerPhone"
                name="ownerPhone"
                optional
                hint="Con il prefisso, es. +39 333 1234567."
              >
                <Input
                  id="ownerPhone"
                  name="ownerPhone"
                  type="tel"
                  defaultValue={values.ownerPhone}
                  disabled={disabled}
                />
              </Field>
              <Field label="Mail per gli avvisi" htmlFor="ownerEmail" name="ownerEmail" optional>
                <Input
                  id="ownerEmail"
                  name="ownerEmail"
                  type="email"
                  defaultValue={values.ownerEmail}
                  disabled={disabled}
                />
              </Field>
            </div>
          </div>
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
