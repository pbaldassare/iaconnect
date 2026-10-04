import { AuditTable } from "@/components/audit-table";
import { Button, ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field } from "@/components/ui/field";
import { Notice } from "@/components/ui/form-message";
import { Checkbox, Input, Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { errorMessage } from "@/lib/action";
import { AUDIT_ACTOR_TYPES, actorTypeLabel } from "@/lib/audit-labels";
import { isUuid } from "@/lib/org-selection";
import { escapeLike, firstParam, pageWindow, parsePage, withParams } from "@/lib/pagination";
import { nextDay, parseIsoDate } from "@/lib/parse";
import { requireStaff } from "@/lib/session";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Registro" };

const PAGE_SIZE = 50;
const PATH = "/admin/registro";

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { supabase, session } = await requireStaff();
  const params = await searchParams;
  const organizationId = isUuid(firstParam(params.azienda)) ? firstParam(params.azienda) : "";
  const actorParam = firstParam(params.chi);
  const actor = (AUDIT_ACTOR_TYPES as readonly string[]).includes(actorParam) ? actorParam : "";
  const action = firstParam(params.azione).trim().slice(0, 60);
  const fromDate = parseIsoDate(firstParam(params.dal)) ?? "";
  const toDate = parseIsoDate(firstParam(params.al)) ?? "";
  const onlySupport = firstParam(params.assistenza) === "1";
  const page = parsePage(params.pagina);
  const { from, to } = pageWindow(page, PAGE_SIZE);
  const filters = {
    azienda: organizationId,
    chi: actor,
    azione: action,
    dal: fromDate,
    al: toDate,
    assistenza: onlySupport ? "1" : "",
  };
  const filtered = Object.values(filters).some((v) => v !== "");

  // Organizations this staff member administers (RLS already limits the rows).
  let orgQuery = supabase.from("organizations").select("id, name, reseller_id").order("name").limit(2000);
  if (!session.isPlatformAdmin) orgQuery = orgQuery.in("reseller_id", session.resellerIds);
  const organizations = await orgQuery;
  const orgRows = organizations.data ?? [];
  const orgNames = new Map(orgRows.map((o) => [o.id, o.name]));

  let query = supabase
    .from("audit_log")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);
  if (organizationId) query = query.eq("organization_id", organizationId);
  else if (!session.isPlatformAdmin)
    query = query.in(
      "organization_id",
      orgRows.map((o) => o.id),
    );
  if (actor) query = query.eq("actor_type", actor);
  if (action) query = query.ilike("action", `%${escapeLike(action)}%`);
  if (fromDate) query = query.gte("created_at", fromDate);
  if (toDate) query = query.lt("created_at", nextDay(toDate));
  if (onlySupport) query = query.or("is_support_access.eq.true,entity_type.eq.support_sessions");
  const { data, count, error } = await query;
  const rows = data ?? [];

  return (
    <>
      <PageHeader
        title="Registro"
        description="Ogni azione di utenti, assistenza e automazioni. Non si può modificare né cancellare; gli accessi in assistenza sono evidenziati."
      />
      <search>
        <form method="get" action={PATH} className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <Field label="Azienda" htmlFor="azienda" className="lg:col-span-2">
            <Select id="azienda" name="azienda" defaultValue={organizationId}>
              <option value="">Tutte</option>
              {orgRows.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Chi" htmlFor="chi">
            <Select id="chi" name="chi" defaultValue={actor}>
              <option value="">Tutti</option>
              {AUDIT_ACTOR_TYPES.map((t) => (
                <option key={t} value={t}>
                  {actorTypeLabel(t)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Azione contiene" htmlFor="azione" hint="Es. connections, flows.update">
            <Input id="azione" name="azione" defaultValue={action} className="font-mono" />
          </Field>
          <Field label="Dal" htmlFor="dal">
            <Input id="dal" name="dal" type="date" defaultValue={fromDate} />
          </Field>
          <Field label="Al" htmlFor="al">
            <Input id="al" name="al" type="date" defaultValue={toDate} />
          </Field>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 sm:col-span-2 lg:col-span-6">
            <Checkbox
              name="assistenza"
              value="1"
              defaultChecked={onlySupport}
              label="Solo accessi in assistenza"
            />
            <Button variant="secondary" icon="search">
              Filtra
            </Button>
            {filtered ? (
              <ButtonLink href={PATH} variant="ghost">
                Togli i filtri
              </ButtonLink>
            ) : null}
          </div>
        </form>
      </search>

      {error ? (
        <Notice tone="error" announce="alert">
          {errorMessage(error)}
        </Notice>
      ) : rows.length === 0 ? (
        <EmptyState
          icon="list"
          title={filtered ? "Nessuna azione corrisponde ai filtri" : "Il registro è vuoto"}
          description={
            filtered
              ? "Allarga il periodo o togli un filtro."
              : "Le azioni compaiono qui man mano che la piattaforma viene usata."
          }
        />
      ) : (
        <>
          <AuditTable rows={rows} organizationNames={orgNames} currentUserId={session.user.id} />
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={count ?? rows.length}
            hrefFor={(p) => withParams(PATH, { ...filters, pagina: p })}
          />
        </>
      )}
    </>
  );
}
