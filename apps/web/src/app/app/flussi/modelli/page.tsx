import { AiBadge, Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Notice } from "@/components/ui/form-message";
import { PageHeader } from "@/components/ui/page-header";
import { errorMessage } from "@/lib/action";
import { describeTrigger } from "@/lib/flows/describe";
import {
  parseRequirements,
  parseTemplateDefinition,
  planTemplateInstall,
  sortTemplatesForSector,
} from "@/lib/flows/install";
import { loadFlowEnvironment, loadFlowPermissions } from "@/lib/flows/server";
import { connectorCategoryLabel, sectorLabel } from "@/lib/labels";
import { requireOrg } from "@/lib/session";
import { getBlock } from "@ia-connect/core";
import type { Metadata } from "next";
import { installTemplate } from "../actions";

export const metadata: Metadata = { title: "Libreria di modelli" };

export default async function TemplatesPage() {
  const context = await requireOrg();
  const { supabase, org } = context;
  const [templates, environment, permissions, installed] = await Promise.all([
    supabase.from("flow_templates").select("*").eq("is_published", true).limit(200),
    loadFlowEnvironment(context),
    loadFlowPermissions(context),
    supabase
      .from("flows")
      .select("template_key")
      .eq("organization_id", org.organization.id)
      .not("template_key", "is", null)
      .limit(500),
  ]);
  const sector = org.organization.sector;
  const rows = sortTemplatesForSector(templates.data ?? [], sector);
  const installedKeys = new Set((installed.data ?? []).map((flow) => flow.template_key));

  return (
    <>
      <PageHeader
        title="Libreria di modelli"
        description="Flussi già pronti. Installarne uno crea una bozza tua, che puoi leggere, simulare e modificare prima di attivarla."
        back={{ href: "/app/flussi", label: "Flussi" }}
      />
      <div className="grid gap-5">
        {templates.error ? <Notice tone="error">{errorMessage(templates.error)}</Notice> : null}
        {rows.length === 0 && !templates.error ? (
          <EmptyState
            icon="grid"
            title="Nessun modello pubblicato"
            description="Quando la piattaforma pubblica modelli per il tuo settore, li trovi qui."
          />
        ) : null}
        <ul className="grid gap-4 lg:grid-cols-2">
          {rows.map((template) => {
            const definition = parseTemplateDefinition(template.definition);
            const requirements = parseRequirements(template.requirements);
            const plan = planTemplateInstall(requirements, {
              templates: environment.templates,
              connections: environment.connections,
            });
            const usesAi = definition?.steps.some((step) => getBlock(step.block)?.usesAi) ?? false;
            return (
              <Card as="li" key={template.id} className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={template.sector === sector ? "ok" : "neutral"}>
                    {template.sector === sector ? "Per il tuo settore" : sectorLabel(template.sector)}
                  </Badge>
                  {usesAi ? <AiBadge>Usa l'IA</AiBadge> : null}
                  {installedKeys.has(template.key) ? <Badge>Già installato</Badge> : null}
                </div>
                <h2 className="font-display text-[17px] font-bold leading-tight tracking-tight">
                  {template.name}
                </h2>
                <p className="text-sm text-muted">{template.description}</p>
                {definition ? (
                  <p className="text-sm">
                    <span className="text-muted">Parte quando: </span>
                    {describeTrigger(definition.trigger)} · {definition.steps.length} passi
                  </p>
                ) : (
                  <p className="text-sm text-danger">Definizione non valida: non installabile.</p>
                )}
                <div className="grid gap-1 text-sm">
                  <p className="font-semibold">Cosa serve</p>
                  <ul className="grid list-disc gap-0.5 pl-4 text-muted">
                    {requirements.connections.map((category) => {
                      const missing = plan.missingConnections.find((item) => item.category === category);
                      return (
                        <li key={category}>
                          Collegamento {connectorCategoryLabel(category)}:{" "}
                          {missing ? (
                            <span className="text-warn">
                              {missing.existing ? "da ricollegare" : "da collegare"}
                            </span>
                          ) : (
                            <span className="text-accent-strong">già attivo</span>
                          )}
                        </li>
                      );
                    })}
                    {requirements.messageTemplates.map((item) => {
                      const waiting = plan.templatesAwaitingApproval.find(
                        (entry) => entry.name === item.name && entry.channel === item.channel,
                      );
                      return (
                        <li key={`${item.channel}:${item.name}`}>
                          Modello di messaggio «{item.name}»:{" "}
                          {waiting ? (
                            <span className="text-warn">
                              {plan.templatesToCreate.some((entry) => entry.name === item.name)
                                ? "verrà creato come bozza, poi va approvato"
                                : "esiste, in attesa di approvazione"}
                            </span>
                          ) : (
                            <span className="text-accent-strong">già approvato</span>
                          )}
                        </li>
                      );
                    })}
                    {requirements.contactFields.length > 0 ? (
                      <li>Campi dei contatti: {requirements.contactFields.join(", ")}</li>
                    ) : null}
                    {requirements.stages.length > 0 ? (
                      <li>
                        Fasi delle trattative:{" "}
                        {requirements.stages.map((stage) => `«${stage.name}»`).join(", ")} (create se mancano,
                        prima di «vinta» e «persa»)
                      </li>
                    ) : null}
                    {requirements.dealFields.length > 0 ? (
                      <li>
                        Campi delle trattative:{" "}
                        {requirements.dealFields.map((field) => field.label).join(", ")} (aggiunti se mancano)
                      </li>
                    ) : null}
                    {requirements.connections.length === 0 &&
                    requirements.messageTemplates.length === 0 &&
                    requirements.contactFields.length === 0 &&
                    requirements.stages.length === 0 &&
                    requirements.dealFields.length === 0 ? (
                      <li>Nulla in particolare</li>
                    ) : null}
                  </ul>
                </div>
                {permissions.canEdit && definition ? (
                  <ActionForm
                    action={installTemplate.bind(null, template.id)}
                    className="mt-auto grid gap-2 pt-1"
                  >
                    <div>
                      <SubmitButton variant="secondary" pendingLabel="Installazione…">
                        Installa come bozza
                      </SubmitButton>
                    </div>
                  </ActionForm>
                ) : null}
              </Card>
            );
          })}
        </ul>
      </div>
    </>
  );
}
