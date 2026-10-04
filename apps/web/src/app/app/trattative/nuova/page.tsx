import { DealForm } from "@/components/deals/deal-form";
import { FeatureOff } from "@/components/feature-off";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { loadAssignees } from "@/lib/deals/assignees";
import { sortStages } from "@/lib/deals/board";
import { parseDealFieldDefs } from "@/lib/deals/stages";
import { featureOn } from "@/lib/feature-gate";
import { isUuid } from "@/lib/org-selection";
import { firstParam } from "@/lib/pagination";
import { requireOrg } from "@/lib/session";
import type { Metadata } from "next";
import { createDeal } from "../actions";

export const metadata: Metadata = { title: "Nuova trattativa" };

const CONTACT_OPTIONS = 300;

export default async function NewDealPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireOrg();
  const { supabase, org } = context;
  const organizationId = org.organization.id;
  if (!(await featureOn(supabase, organizationId, "deals"))) return <FeatureOff title="Trattative" />;
  const wanted = firstParam((await searchParams).contatto);
  const contactId = isUuid(wanted) ? wanted : null;

  const [stagesResult, settings, contactsResult, assignees] = await Promise.all([
    supabase.from("deal_stages").select("id, name, position, kind").eq("organization_id", organizationId),
    supabase
      .from("org_settings")
      .select("deal_custom_fields")
      .eq("organization_id", organizationId)
      .maybeSingle(),
    contactId
      ? supabase
          .from("contacts")
          .select("id, full_name, phones, emails")
          .eq("organization_id", organizationId)
          .eq("id", contactId)
      : supabase
          .from("contacts")
          .select("id, full_name, phones, emails")
          .eq("organization_id", organizationId)
          .order("created_at", { ascending: false })
          .limit(CONTACT_OPTIONS),
    loadAssignees(context),
  ]);
  const stages = sortStages(stagesResult.data ?? []);
  const contacts = [...(contactsResult.data ?? [])].sort((a, b) =>
    a.full_name.localeCompare(b.full_name, "it"),
  );
  const firstOpen = stages.find((stage) => stage.kind === "open") ?? stages[0];

  return (
    <>
      <PageHeader title="Nuova trattativa" back={{ href: "/app/trattative", label: "Trattative" }} />
      {contacts.length === 0 ? (
        <EmptyState
          icon="people"
          title="Serve prima un contatto"
          description="Ogni trattativa appartiene a un contatto. Crealo, poi torna qui."
          action={
            <ButtonLink href="/app/contatti/nuovo" icon="plus">
              Nuovo contatto
            </ButtonLink>
          }
        />
      ) : stages.length === 0 ? (
        <EmptyState
          icon="deal"
          title="Nessuna fase definita"
          description="Crea almeno una fase in Impostazioni → Fasi delle trattative."
          action={
            <ButtonLink href="/app/impostazioni/fasi" variant="secondary">
              Fasi delle trattative
            </ButtonLink>
          }
        />
      ) : (
        <Card className="max-w-2xl">
          <DealForm
            action={createDeal}
            assignees={assignees}
            fieldDefs={parseDealFieldDefs(settings.data?.deal_custom_fields)}
            submitLabel="Crea trattativa"
            cancelHref="/app/trattative"
          >
            <Field
              label="Contatto"
              htmlFor="contact_id"
              name="contact_id"
              hint={
                !contactId && contacts.length === CONTACT_OPTIONS
                  ? `Sono elencati i ${CONTACT_OPTIONS} contatti più recenti. Per gli altri apri la scheda del contatto e scegli «Nuova trattativa».`
                  : undefined
              }
            >
              <Select id="contact_id" name="contact_id" defaultValue={contactId ?? ""} required>
                {contactId ? null : <option value="">Scegli un contatto…</option>}
                {contacts.map((contact) => (
                  <option key={contact.id} value={contact.id}>
                    {contact.full_name.trim() || contact.phones[0] || contact.emails[0] || "Senza nome"}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Fase" htmlFor="stage_id" name="stage_id">
              <Select id="stage_id" name="stage_id" defaultValue={firstOpen?.id ?? ""} required>
                {stages.map((stage) => (
                  <option key={stage.id} value={stage.id}>
                    {stage.name}
                  </option>
                ))}
              </Select>
            </Field>
          </DealForm>
        </Card>
      )}
    </>
  );
}
