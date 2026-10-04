import { READ_ONLY_NOTE, SettingsNav } from "@/components/settings/settings-nav";
import { StatusPill } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Notice } from "@/components/ui/form-message";
import { Input, Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { errorMessage } from "@/lib/action";
import { STAGE_KINDS, stageKind } from "@/lib/customer-labels";
import { sortStages } from "@/lib/deals/board";
import { formatNumber } from "@/lib/format";
import { fetchAllRows } from "@/lib/report/fetch";
import { requireOrg } from "@/lib/session";
import type { Metadata } from "next";
import { addStage, deleteStage, moveStage, updateStage } from "./actions";

export const metadata: Metadata = { title: "Fasi delle trattative" };

export default async function StagesSettingsPage() {
  const { supabase, org } = await requireOrg();
  const organizationId = org.organization.id;
  const [stagesResult, deals] = await Promise.all([
    supabase
      .from("deal_stages")
      .select("id, key, name, position, kind")
      .eq("organization_id", organizationId),
    fetchAllRows(
      (from, to) =>
        supabase
          .from("deals")
          .select("stage_id")
          .eq("organization_id", organizationId)
          .order("id")
          .range(from, to),
      10_000,
    ),
  ]);
  const stages = sortStages(stagesResult.data ?? []);
  const counts = new Map<string, number>();
  for (const deal of deals.rows) counts.set(deal.stage_id, (counts.get(deal.stage_id) ?? 0) + 1);

  return (
    <>
      <PageHeader
        title="Fasi delle trattative"
        back={{ href: "/app/impostazioni", label: "Impostazioni" }}
        description="Le colonne della sezione Trattative, nell'ordine in cui le vedi. Una trattativa che entra in una fase «vinta» o «persa» viene chiusa."
      />
      <SettingsNav current="fasi" />
      {!org.canManage ? (
        <Notice tone="neutral" className="mb-4">
          {READ_ONLY_NOTE}
        </Notice>
      ) : null}
      {stagesResult.error ? (
        <Notice tone="error" announce="alert" className="mb-4">
          {errorMessage(stagesResult.error)}
        </Notice>
      ) : null}
      <div className="grid max-w-3xl gap-4">
        <Card aria-labelledby="elenco-fasi">
          <CardHeader
            id="elenco-fasi"
            title="Fasi"
            description="Puoi cambiare nome e ordine quando vuoi: i flussi riconoscono le fasi da un codice interno che non cambia."
          />
          {stages.length === 0 ? (
            <p className="text-sm text-muted">
              Nessuna fase. Aggiungine una qui sotto: serve almeno una fase aperta.
            </p>
          ) : (
            <ol className="grid gap-4">
              {stages.map((stage, index) => {
                const count = counts.get(stage.id) ?? 0;
                return (
                  <li
                    key={stage.id}
                    className="grid gap-2 border-b border-line pb-4 last:border-b-0 last:pb-0"
                  >
                    <p className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-mono text-[12px] text-muted">{index + 1}.</span>
                      <span className="font-semibold">{stage.name}</span>
                      <StatusPill {...stageKind(stage.kind)} />
                      <span className="text-muted">
                        {count === 1 ? "1 trattativa" : `${formatNumber(count)} trattative`}
                      </span>
                    </p>
                    {org.canManage ? (
                      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                        <ActionForm action={updateStage.bind(null, stage.id)} className="grid gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <label htmlFor={`name-${stage.id}`} className="sr-only">
                              Nome della fase {stage.name}
                            </label>
                            <Input
                              id={`name-${stage.id}`}
                              name="name"
                              defaultValue={stage.name}
                              maxLength={60}
                              required
                              className="h-8 w-44 text-[13px]"
                            />
                            <label htmlFor={`kind-${stage.id}`} className="sr-only">
                              Tipo della fase {stage.name}
                            </label>
                            <Select
                              id={`kind-${stage.id}`}
                              name="kind"
                              defaultValue={stage.kind}
                              className="h-8 w-auto text-[13px]"
                            >
                              {STAGE_KINDS.map((kind) => (
                                <option key={kind} value={kind}>
                                  {stageKind(kind).label}
                                </option>
                              ))}
                            </Select>
                            <SubmitButton size="sm" variant="secondary">
                              Salva
                            </SubmitButton>
                          </div>
                        </ActionForm>
                        {index > 0 ? (
                          <ActionForm action={moveStage.bind(null, stage.id, "up")}>
                            <SubmitButton size="sm" variant="ghost" pendingLabel="…">
                              <span aria-hidden>↑</span> Su
                              <span className="sr-only">: sposta {stage.name} prima</span>
                            </SubmitButton>
                          </ActionForm>
                        ) : null}
                        {index < stages.length - 1 ? (
                          <ActionForm action={moveStage.bind(null, stage.id, "down")}>
                            <SubmitButton size="sm" variant="ghost" pendingLabel="…">
                              <span aria-hidden>↓</span> Giù
                              <span className="sr-only">: sposta {stage.name} dopo</span>
                            </SubmitButton>
                          </ActionForm>
                        ) : null}
                        {count === 0 ? (
                          <ActionForm action={deleteStage.bind(null, stage.id)} className="grid gap-2">
                            <SubmitButton size="sm" variant="ghost" icon="trash">
                              Elimina<span className="sr-only"> la fase {stage.name}</span>
                            </SubmitButton>
                          </ActionForm>
                        ) : (
                          <p className="self-center text-[13px] text-muted">
                            Non si può eliminare finché contiene trattative.
                          </p>
                        )}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          )}
          {deals.truncated ? (
            <p className="mt-3 text-[13px] text-muted">
              I conteggi sono parziali (oltre 10.000 trattative); l'eliminazione controlla comunque il numero
              esatto.
            </p>
          ) : null}
        </Card>

        {org.canManage ? (
          <Card aria-labelledby="nuova-fase">
            <CardHeader id="nuova-fase" title="Aggiungi una fase" />
            <ActionForm
              action={addStage}
              className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px] sm:items-start"
            >
              <Field label="Nome" htmlFor="stage-name" name="name">
                <Input
                  id="stage-name"
                  name="name"
                  maxLength={60}
                  required
                  placeholder="Es. Sopralluogo fatto"
                />
              </Field>
              <Field label="Tipo" htmlFor="stage-kind" name="kind">
                <Select id="stage-kind" name="kind" defaultValue="open">
                  {STAGE_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {stageKind(kind).label}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="sm:col-span-2">
                <SubmitButton icon="plus">Aggiungi</SubmitButton>
              </div>
            </ActionForm>
          </Card>
        ) : null}
      </div>
    </>
  );
}
