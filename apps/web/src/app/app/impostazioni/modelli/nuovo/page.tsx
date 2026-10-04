import { TemplateEditor } from "@/components/settings/template-editor";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { Tabs } from "@/components/ui/tabs";
import { CHANNEL_KEYS, channelLabel, isChannel } from "@/lib/customer-labels";
import { firstParam, withParams } from "@/lib/pagination";
import { requireOrgManager } from "@/lib/session";
import type { Metadata } from "next";
import { createTemplate } from "../actions";

export const metadata: Metadata = { title: "Nuovo modello" };

const PATH = "/app/impostazioni/modelli";

export default async function NewTemplatePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOrgManager();
  const wanted = firstParam((await searchParams).canale);
  const channel = isChannel(wanted) ? wanted : "whatsapp";
  return (
    <>
      <PageHeader
        title="Nuovo modello"
        back={{ href: withParams(PATH, { canale: channel }), label: "Modelli di messaggio" }}
      />
      <Tabs
        label="Canale del modello"
        className="mb-4"
        items={CHANNEL_KEYS.map((key) => ({
          href: withParams(`${PATH}/nuovo`, { canale: key }),
          label: channelLabel(key),
          current: key === channel,
        }))}
      />
      <Card>
        {/* The key makes the form start clean when the channel changes. */}
        <ActionForm key={channel} action={createTemplate} className="grid gap-5">
          <input type="hidden" name="channel" value={channel} />
          <TemplateEditor
            channel={channel}
            isNew
            disabled={false}
            initial={{
              name: "",
              language: "it",
              subject: "",
              body: "",
              external_name: "",
              approval_status: "draft",
            }}
          />
          <div className="flex flex-wrap gap-2">
            <SubmitButton>Crea modello</SubmitButton>
            <ButtonLink href={withParams(PATH, { canale: channel })} variant="ghost">
              Annulla
            </ButtonLink>
          </div>
        </ActionForm>
      </Card>
    </>
  );
}
