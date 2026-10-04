import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Notice } from "@/components/ui/form-message";
import { Input, Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { formatMoney } from "@/lib/format";
import { sectorLabel } from "@/lib/labels";
import { requireStaff } from "@/lib/session";
import { hasServiceKey } from "@/lib/supabase/service";
import { SECTORS } from "@ia-connect/core";
import type { Metadata } from "next";
import { createOrganization } from "../actions";

export const metadata: Metadata = { title: "Nuova azienda" };

export default async function NewOrganizationPage() {
  const { supabase, session } = await requireStaff();
  const [plans, resellers] = await Promise.all([
    supabase
      .from("plans")
      .select("id, name, price_monthly_cents, is_active")
      .eq("is_active", true)
      .order("price_monthly_cents"),
    supabase.from("resellers").select("id, name, status").order("name"),
  ]);
  const resellerRows = (resellers.data ?? []).filter(
    (r) => r.status === "active" && (session.isPlatformAdmin || session.resellerIds.includes(r.id)),
  );
  const planRows = plans.data ?? [];

  return (
    <>
      <PageHeader
        title="Nuova azienda"
        description="Crea l'azienda e, se vuoi, invita subito il titolare."
        back={{ href: "/admin/aziende", label: "Aziende" }}
      />
      {planRows.length === 0 || resellerRows.length === 0 ? (
        <Notice tone="error" announce="alert" title="Mancano piani o rivenditori">
          Per creare un'azienda servono almeno un piano attivo e un rivenditore attivo. Controlla che le
          migrazioni del database siano state applicate.
        </Notice>
      ) : (
        <Card className="max-w-2xl">
          <ActionForm action={createOrganization} className="grid gap-4">
            <Field label="Nome dell'azienda" htmlFor="name" name="name">
              <Input id="name" name="name" required maxLength={120} autoComplete="off" />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Settore"
                htmlFor="sector"
                name="sector"
                hint="Decide quali modelli di flusso vengono proposti."
              >
                <Select id="sector" name="sector" defaultValue="other">
                  {SECTORS.map((s) => (
                    <option key={s} value={s}>
                      {sectorLabel(s)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Piano" htmlFor="plan_id" name="plan_id">
                <Select id="plan_id" name="plan_id" defaultValue={planRows[0]?.id}>
                  {planRows.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {formatMoney(p.price_monthly_cents)}/mese
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            {resellerRows.length > 1 ? (
              <Field label="Rivenditore" htmlFor="reseller_id" name="reseller_id">
                <Select id="reseller_id" name="reseller_id" defaultValue={resellerRows[0]?.id}>
                  {resellerRows.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <input type="hidden" name="reseller_id" value={resellerRows[0]?.id} />
            )}
            <Field
              label="Mail del titolare"
              htmlFor="owner_email"
              name="owner_email"
              optional
              hint="Riceve un invito e diventa titolare dell'azienda. Puoi invitarlo anche dopo, dalla scheda."
            >
              <Input id="owner_email" name="owner_email" type="email" autoComplete="off" inputMode="email" />
            </Field>
            {hasServiceKey() ? null : (
              <Notice tone="warning" title="La mail di invito non partirà da questo server">
                Manca SUPABASE_SERVICE_ROLE_KEY. L'invito viene registrato lo stesso: dopo la creazione ti
                diciamo come far entrare il titolare.
              </Notice>
            )}
            <div className="flex flex-wrap gap-2">
              <SubmitButton>Crea l'azienda</SubmitButton>
              <ButtonLink href="/admin/aziende" variant="ghost">
                Annulla
              </ButtonLink>
            </div>
          </ActionForm>
        </Card>
      )}
    </>
  );
}
