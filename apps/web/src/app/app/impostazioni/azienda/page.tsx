import { BusinessProfileEditor } from "@/components/settings/business-profile-editor";
import { READ_ONLY_NOTE, SettingsNav } from "@/components/settings/settings-nav";
import { Card } from "@/components/ui/card";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Notice } from "@/components/ui/form-message";
import { PageHeader } from "@/components/ui/page-header";
import { errorMessage } from "@/lib/action";
import { requireOrg } from "@/lib/session";
import { businessProfileFormValues } from "@/lib/settings/business-profile";
import type { Metadata } from "next";
import Link from "next/link";
import { saveBusinessProfile } from "../actions";

export const metadata: Metadata = { title: "Profilo azienda" };

export default async function BusinessProfilePage() {
  const { supabase, org } = await requireOrg();
  const { data: settings, error } = await supabase
    .from("org_settings")
    .select("business_profile")
    .eq("organization_id", org.organization.id)
    .maybeSingle();
  const profile = businessProfileFormValues(settings?.business_profile);
  const disabled = !org.canManage;

  return (
    <>
      <PageHeader
        title="Profilo azienda"
        back={{ href: "/app/impostazioni", label: "Impostazioni" }}
        description="Sedi, orari e servizi usati dall'IA su WhatsApp e nei flussi automatici. Ogni azienda ha il proprio profilo."
      />
      <SettingsNav current="azienda" />
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
        Completa qui i dati fissi. Per il tono e le regole libere vai all&apos;{" "}
        <Link href="/app/impostazioni/assistente" className="font-medium text-accent underline-offset-2 hover:underline">
          Assistente IA
        </Link>{" "}
        e per domande frequenti all&apos;{" "}
        <Link href="/app/impostazioni/allenamento" className="font-medium text-accent underline-offset-2 hover:underline">
          Allenamento IA
        </Link>
        .
      </Notice>
      <Card className="max-w-3xl">
        <ActionForm action={saveBusinessProfile} className="grid gap-6">
          <BusinessProfileEditor initial={profile} disabled={disabled} />
          {disabled ? null : (
            <div>
              <SubmitButton>Salva profilo</SubmitButton>
            </div>
          )}
        </ActionForm>
      </Card>
    </>
  );
}