import { READ_ONLY_NOTE } from "@/components/settings/settings-nav";
import { TemplateEditor } from "@/components/settings/template-editor";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Notice } from "@/components/ui/form-message";
import { PageHeader } from "@/components/ui/page-header";
import { channelLabel } from "@/lib/customer-labels";
import { isUuid } from "@/lib/org-selection";
import { withParams } from "@/lib/pagination";
import { requireOrg } from "@/lib/session";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { deleteTemplate, updateTemplate } from "../actions";

export const metadata: Metadata = { title: "Modello di messaggio" };

export default async function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, org } = await requireOrg();
  if (!isUuid(id)) notFound();
  const { data: template } = await supabase
    .from("message_templates")
    .select("*")
    .eq("id", id)
    .eq("organization_id", org.organization.id)
    .maybeSingle();
  if (!template) notFound();
  const disabled = !org.canManage;
  return (
    <>
      <PageHeader
        title={template.name}
        eyebrow="Modello di messaggio"
        back={{
          href: withParams("/app/impostazioni/modelli", {
            canale: template.channel === "whatsapp" ? null : template.channel,
          }),
          label: "Modelli di messaggio",
        }}
        description={<Badge>{channelLabel(template.channel)}</Badge>}
        actions={
          disabled ? undefined : (
            <Dialog
              triggerLabel="Elimina"
              triggerVariant="ghost"
              triggerIcon="trash"
              title={`Eliminare «${template.name}»?`}
              description="I flussi che usano questo modello si fermeranno a quel passo con un errore. I messaggi già inviati restano."
            >
              <ActionForm action={deleteTemplate.bind(null, template.id)} className="grid gap-3">
                <SubmitButton variant="danger">Elimina il modello</SubmitButton>
              </ActionForm>
            </Dialog>
          )
        }
      />
      {disabled ? (
        <Notice tone="neutral" className="mb-4">
          {READ_ONLY_NOTE}
        </Notice>
      ) : null}
      <Card>
        <ActionForm action={updateTemplate.bind(null, template.id)} className="grid gap-5">
          <TemplateEditor
            channel={template.channel}
            isNew={false}
            disabled={disabled}
            initial={{
              name: template.name,
              language: template.language,
              subject: template.subject ?? "",
              body: template.body,
              external_name: template.external_name ?? "",
              approval_status: template.approval_status,
            }}
          />
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
