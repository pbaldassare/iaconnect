import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Notice } from "@/components/ui/form-message";
import { Input, Switch } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { errorMessage } from "@/lib/action";
import { centsToEurosInput } from "@/lib/parse";
import { requirePlatformAdmin } from "@/lib/session";
import { parsePlanLimits } from "@/lib/usage";
import type { Metadata } from "next";
import { savePlan } from "./actions";
import { LIMIT_FIELDS } from "./fields";

export const metadata: Metadata = { title: "Piani" };

export default async function PlansPage() {
  const { supabase } = await requirePlatformAdmin();
  const [plans, organizations] = await Promise.all([
    supabase.from("plans").select("*").order("price_monthly_cents"),
    supabase.from("organizations").select("plan_id").limit(5000),
  ]);
  const usage = new Map<string, number>();
  for (const o of organizations.data ?? []) usage.set(o.plan_id, (usage.get(o.plan_id) ?? 0) + 1);
  const rows = plans.data ?? [];

  return (
    <>
      <PageHeader
        title="Piani"
        description="Prezzo e limiti mensili di ogni piano. Scrivi -1 dove non vuoi un limite, 0 dove la funzione non è inclusa."
      />
      {plans.error ? (
        <Notice tone="error" announce="alert">
          {errorMessage(plans.error)}
        </Notice>
      ) : rows.length === 0 ? (
        <EmptyState
          icon="tag"
          title="Nessun piano"
          description="I piani vengono creati dalle migrazioni del database. Controlla che siano state applicate."
        />
      ) : (
        <ul className="grid gap-4 xl:grid-cols-2">
          {rows.map((plan) => {
            const limits = parsePlanLimits(plan.limits);
            const count = usage.get(plan.id) ?? 0;
            return (
              <Card as="li" key={plan.id}>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-display text-[17px] font-bold tracking-tight">{plan.name}</h2>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[12px] text-muted">{plan.key}</span>
                    <Badge>{count === 1 ? "1 azienda" : `${count} aziende`}</Badge>
                  </div>
                </div>
                <ActionForm action={savePlan} className="grid gap-4">
                  <input type="hidden" name="id" value={plan.id} />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Nome" htmlFor={`name-${plan.id}`} name="name">
                      <Input
                        id={`name-${plan.id}`}
                        name="name"
                        defaultValue={plan.name}
                        required
                        maxLength={60}
                      />
                    </Field>
                    <Field label="Prezzo al mese (€)" htmlFor={`price-${plan.id}`} name="price">
                      <Input
                        id={`price-${plan.id}`}
                        name="price"
                        inputMode="decimal"
                        defaultValue={centsToEurosInput(plan.price_monthly_cents)}
                        required
                        className="font-mono"
                      />
                    </Field>
                    {LIMIT_FIELDS.map((field) => (
                      <Field
                        key={field.key}
                        label={field.label}
                        htmlFor={`${field.key}-${plan.id}`}
                        name={field.key}
                      >
                        <Input
                          id={`${field.key}-${plan.id}`}
                          name={field.key}
                          type="number"
                          min={-1}
                          step={1}
                          defaultValue={limits[field.key] ?? -1}
                          required
                          className="font-mono"
                        />
                      </Field>
                    ))}
                  </div>
                  <Switch
                    name="is_active"
                    defaultChecked={plan.is_active}
                    label="Proponibile alle nuove aziende"
                    description="Se spento, resta valido per chi lo ha già ma non si può più assegnare."
                  />
                  <div>
                    <SubmitButton>Salva il piano</SubmitButton>
                  </div>
                </ActionForm>
              </Card>
            );
          })}
        </ul>
      )}
    </>
  );
}
