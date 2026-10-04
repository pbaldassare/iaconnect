import { Badge, StatusPill } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Notice } from "@/components/ui/form-message";
import { Input, Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { Table, Td, Th } from "@/components/ui/table";
import { pendingAccessRequestCount } from "@/lib/access";
import { errorMessage } from "@/lib/action";
import { formatDate } from "@/lib/format";
import { organizationStatus, sectorLabel } from "@/lib/labels";
import { escapeLike, firstParam, pageWindow, parsePage, withParams } from "@/lib/pagination";
import { requireStaff } from "@/lib/session";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Aziende" };

const PAGE_SIZE = 25;
const PATH = "/admin/aziende";

export default async function OrganizationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { supabase, session } = await requireStaff();
  const params = await searchParams;
  const q = firstParam(params.q).trim().slice(0, 80);
  const status = ["active", "suspended"].includes(firstParam(params.stato)) ? firstParam(params.stato) : "";
  const deleted = firstParam(params.eliminata).slice(0, 120);
  const page = parsePage(params.pagina);
  const { from, to } = pageWindow(page, PAGE_SIZE);

  let query = supabase.from("organizations").select("*", { count: "exact" }).order("name").range(from, to);
  if (q) query = query.ilike("name", `%${escapeLike(q)}%`);
  if (status) query = query.eq("status", status);
  // Reseller admins who are also members elsewhere must only see the organizations they administer.
  if (!session.isPlatformAdmin) query = query.in("reseller_id", session.resellerIds);

  const [organizations, plans, resellers] = await Promise.all([
    query,
    supabase.from("plans").select("id, name"),
    supabase.from("resellers").select("id, name"),
  ]);
  const rows = organizations.data ?? [];
  const planNames = new Map((plans.data ?? []).map((p) => [p.id, p.name]));
  const resellerNames = new Map((resellers.data ?? []).map((r) => [r.id, r.name]));
  const showReseller = session.isPlatformAdmin || session.resellerIds.length > 1;
  const filtered = q !== "" || status !== "";
  const pendingRequests = session.isPlatformAdmin ? await pendingAccessRequestCount(supabase) : 0;

  return (
    <>
      <PageHeader
        title="Aziende"
        description="Le aziende clienti: crea, cerca, entra nella scheda."
        actions={
          <ButtonLink href="/admin/aziende/nuova" icon="plus">
            Nuova azienda
          </ButtonLink>
        }
      />
      {pendingRequests > 0 ? (
        <Notice
          tone="warning"
          title={
            pendingRequests === 1
              ? "1 richiesta di accesso in attesa"
              : `${pendingRequests} richieste di accesso in attesa`
          }
          className="mb-4"
        >
          Qualcuno si è registrato e aspetta l'attivazione della propria azienda.{" "}
          <Link href="/admin/richieste" className="font-semibold">
            Vedi le richieste
          </Link>
        </Notice>
      ) : null}
      {deleted ? (
        <Notice tone="ok" announce="status" className="mb-4">
          L'azienda «{deleted}» e tutti i suoi dati sono stati eliminati.
        </Notice>
      ) : null}
      <search>
        <form method="get" action={PATH} className="mb-4 flex flex-wrap items-end gap-3">
          <Field label="Cerca per nome" htmlFor="q" className="min-w-[200px] flex-1 sm:max-w-xs">
            <Input id="q" name="q" type="search" defaultValue={q} />
          </Field>
          <Field label="Stato" htmlFor="stato" className="w-40">
            <Select id="stato" name="stato" defaultValue={status}>
              <option value="">Tutte</option>
              <option value="active">Attive</option>
              <option value="suspended">Sospese</option>
            </Select>
          </Field>
          <Button variant="secondary" icon="search">
            Cerca
          </Button>
          {filtered ? (
            <ButtonLink href={PATH} variant="ghost">
              Togli i filtri
            </ButtonLink>
          ) : null}
        </form>
      </search>

      {organizations.error ? (
        <Notice tone="error" announce="alert">
          {errorMessage(organizations.error)}
        </Notice>
      ) : rows.length === 0 ? (
        <EmptyState
          icon="building"
          title={filtered ? "Nessuna azienda corrisponde alla ricerca" : "Ancora nessuna azienda"}
          description={
            filtered
              ? "Prova con un altro nome o togli i filtri."
              : "Crea la prima azienda e invita il titolare: riceverà una mail per entrare."
          }
          action={
            filtered ? null : (
              <ButtonLink href="/admin/aziende/nuova" icon="plus">
                Nuova azienda
              </ButtonLink>
            )
          }
        />
      ) : (
        <>
          <Table caption="Aziende" minWidth={showReseller ? 760 : 620}>
            <thead>
              <tr>
                <Th>Nome</Th>
                <Th>Settore</Th>
                <Th>Piano</Th>
                {showReseller ? <Th>Rivenditore</Th> : null}
                <Th>Stato</Th>
                <Th>Creata</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id}>
                  <Td>
                    <Link href={`/admin/aziende/${o.id}`} className="font-semibold hover:underline">
                      {o.name}
                    </Link>
                  </Td>
                  <Td>{sectorLabel(o.sector)}</Td>
                  <Td>
                    <Badge>{planNames.get(o.plan_id) ?? "—"}</Badge>
                  </Td>
                  {showReseller ? <Td muted>{resellerNames.get(o.reseller_id) ?? "—"}</Td> : null}
                  <Td>
                    <StatusPill {...organizationStatus(o.status)} />
                  </Td>
                  <Td mono muted className="whitespace-nowrap">
                    {formatDate(o.created_at)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={organizations.count ?? rows.length}
            hrefFor={(p) => withParams(PATH, { q, stato: status, pagina: p })}
          />
        </>
      )}
    </>
  );
}
