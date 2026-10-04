import { ButtonLink } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Notice } from "@/components/ui/form-message";
import { Input, Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Table, Td, Th } from "@/components/ui/table";
import { parseBrand } from "@/lib/brand";
import { formatDate, shortId } from "@/lib/format";
import { isUuid } from "@/lib/org-selection";
import { requirePlatformAdmin } from "@/lib/session";
import { hasServiceKey } from "@/lib/supabase/service";
import { resolveUserEmails } from "@/lib/users";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { addResellerAdmin, removeResellerAdmin, updateReseller } from "../actions";

export const metadata: Metadata = { title: "Rivenditore" };

export default async function ResellerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requirePlatformAdmin();
  if (!isUuid(id)) notFound();
  const [reseller, admins, organizations] = await Promise.all([
    supabase.from("resellers").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("memberships")
      .select("*")
      .eq("reseller_id", id)
      .eq("role", "reseller_admin")
      .order("created_at"),
    supabase.from("organizations").select("id", { count: "exact", head: true }).eq("reseller_id", id),
  ]);
  if (!reseller.data) notFound();
  const r = reseller.data;
  const brand = parseBrand(r.brand);
  const adminRows = admins.data ?? [];
  const emails = await resolveUserEmails(adminRows.map((a) => a.user_id));

  return (
    <>
      <PageHeader
        title={r.name}
        eyebrow="Rivenditore"
        description={`${organizations.count ?? 0} aziende · identificativo ${r.slug}`}
        back={{ href: "/admin/rivenditori", label: "Rivenditori" }}
        actions={
          <ButtonLink href="/admin/aziende" variant="secondary">
            Vedi le aziende
          </ButtonLink>
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="self-start">
          <CardHeader
            title="Dati e marchio"
            description="Il marchio vale per le aziende che non ne hanno uno proprio."
          />
          <ActionForm action={updateReseller.bind(null, r.id)} className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Nome" htmlFor="name" name="name">
                <Input id="name" name="name" defaultValue={r.name} required maxLength={80} />
              </Field>
              <Field label="Stato" htmlFor="status" name="status">
                <Select id="status" name="status" defaultValue={r.status}>
                  <option value="active">Attivo</option>
                  <option value="suspended">Sospeso</option>
                </Select>
              </Field>
              <Field label="Nome mostrato ai clienti" htmlFor="brand_name" name="brand_name" optional>
                <Input id="brand_name" name="brand_name" defaultValue={brand.name ?? ""} maxLength={60} />
              </Field>
              <Field
                label="Colore"
                htmlFor="brand_accent"
                name="brand_accent"
                optional
                hint="Formato #rrggbb."
              >
                <Input
                  id="brand_accent"
                  name="brand_accent"
                  defaultValue={brand.accent ?? ""}
                  placeholder="#06724f"
                  className="font-mono"
                />
              </Field>
              <Field
                label="Indirizzo del logo"
                htmlFor="brand_logo"
                name="brand_logo"
                optional
                hint="Un'immagine quadrata raggiungibile via https."
                className="sm:col-span-2"
              >
                <Input id="brand_logo" name="brand_logo" type="url" defaultValue={brand.logoUrl ?? ""} />
              </Field>
            </div>
            <div>
              <SubmitButton>Salva</SubmitButton>
            </div>
          </ActionForm>
        </Card>

        <Card className="self-start">
          <CardHeader
            title="Amministratori"
            description="Vedono e gestiscono solo le aziende di questo rivenditore. Si possono aggiungere solo persone che hanno già un account."
          />
          {adminRows.length === 0 ? (
            <EmptyState
              compact
              icon="people"
              title="Nessun amministratore"
              description="Aggiungine uno con la sua mail."
            />
          ) : (
            <Table caption="Amministratori del rivenditore" minWidth={420} bare>
              <thead>
                <tr>
                  <Th>Utente</Th>
                  <Th>Dal</Th>
                  <Th align="right">Azioni</Th>
                </tr>
              </thead>
              <tbody>
                {adminRows.map((a) => (
                  <tr key={a.id}>
                    <Td>
                      {emails.get(a.user_id) ?? (
                        <span className="font-mono text-[13px]">{shortId(a.user_id)}</span>
                      )}
                    </Td>
                    <Td mono muted>
                      {formatDate(a.created_at)}
                    </Td>
                    <Td align="right">
                      <ActionForm
                        action={removeResellerAdmin.bind(null, r.id)}
                        className="grid justify-items-end gap-2"
                      >
                        <input type="hidden" name="membership_id" value={a.id} />
                        <SubmitButton variant="ghost" size="sm">
                          Togli
                        </SubmitButton>
                      </ActionForm>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          <ActionForm
            action={addResellerAdmin.bind(null, r.id)}
            className="mt-4 grid items-start gap-3 border-t border-line pt-4 sm:grid-cols-[minmax(0,1fr)_auto]"
          >
            <Field label="Mail di un utente già registrato" htmlFor="admin-email" name="email">
              <Input
                id="admin-email"
                name="email"
                type="email"
                required
                autoComplete="off"
                inputMode="email"
              />
            </Field>
            <div className="sm:pt-[26px]">
              <SubmitButton variant="secondary" icon="plus">
                Aggiungi
              </SubmitButton>
            </div>
          </ActionForm>
          {hasServiceKey() ? null : (
            <Notice tone="warning" className="mt-3">
              Su questo server manca SUPABASE_SERVICE_ROLE_KEY: non possiamo cercare gli utenti dalla mail,
              quindi qui non si possono aggiungere amministratori.
            </Notice>
          )}
        </Card>
      </div>
    </>
  );
}
