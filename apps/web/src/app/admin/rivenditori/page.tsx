import { StatusPill } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Notice } from "@/components/ui/form-message";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Table, Td, Th } from "@/components/ui/table";
import { errorMessage } from "@/lib/action";
import { formatDate } from "@/lib/format";
import { organizationStatus } from "@/lib/labels";
import { requirePlatformAdmin } from "@/lib/session";
import type { Metadata } from "next";
import Link from "next/link";
import { createReseller } from "./actions";

export const metadata: Metadata = { title: "Rivenditori" };

export default async function ResellersPage() {
  const { supabase } = await requirePlatformAdmin();
  const [resellers, organizations] = await Promise.all([
    supabase.from("resellers").select("*").order("name"),
    supabase.from("organizations").select("reseller_id").limit(5000),
  ]);
  const counts = new Map<string, number>();
  for (const o of organizations.data ?? []) counts.set(o.reseller_id, (counts.get(o.reseller_id) ?? 0) + 1);
  const rows = resellers.data ?? [];

  return (
    <>
      <PageHeader
        title="Rivenditori"
        description="Chi vende IA Connect con il proprio marchio. Ogni azienda appartiene a un rivenditore; «default» siamo noi."
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div>
          {resellers.error ? (
            <Notice tone="error" announce="alert">
              {errorMessage(resellers.error)}
            </Notice>
          ) : rows.length === 0 ? (
            <EmptyState
              icon="people"
              title="Nessun rivenditore"
              description="Crea il primo dal modulo qui accanto."
            />
          ) : (
            <Table caption="Rivenditori" minWidth={520}>
              <thead>
                <tr>
                  <Th>Nome</Th>
                  <Th>Identificativo</Th>
                  <Th align="right">Aziende</Th>
                  <Th>Stato</Th>
                  <Th>Creato</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <Td>
                      <Link href={`/admin/rivenditori/${r.id}`} className="font-semibold hover:underline">
                        {r.name}
                      </Link>
                    </Td>
                    <Td mono muted>
                      {r.slug}
                    </Td>
                    <Td mono align="right">
                      {counts.get(r.id) ?? 0}
                    </Td>
                    <Td>
                      <StatusPill
                        {...organizationStatus(r.status)}
                        label={r.status === "active" ? "Attivo" : "Sospeso"}
                      />
                    </Td>
                    <Td mono muted>
                      {formatDate(r.created_at)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>
        <Card className="self-start">
          <CardHeader title="Nuovo rivenditore" />
          <ActionForm action={createReseller} className="grid gap-4">
            <Field label="Nome" htmlFor="name" name="name">
              <Input id="name" name="name" required maxLength={80} autoComplete="off" />
            </Field>
            <Field
              label="Identificativo"
              htmlFor="slug"
              name="slug"
              optional
              hint="Solo lettere minuscole, numeri e trattini. Se lo lasci vuoto lo ricaviamo dal nome."
            >
              <Input id="slug" name="slug" maxLength={48} autoComplete="off" className="font-mono" />
            </Field>
            <div>
              <SubmitButton icon="plus">Crea rivenditore</SubmitButton>
            </div>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
