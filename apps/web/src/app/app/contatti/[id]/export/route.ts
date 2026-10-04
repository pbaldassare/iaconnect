import { errorMessage } from "@/lib/action";
import { writeAudit } from "@/lib/audit";
import { isUuid } from "@/lib/org-selection";
import { slugify } from "@/lib/parse";
import { actorOf, requireOrg } from "@/lib/session";

const plain = (body: string, status: number) =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

/** GDPR export of one contact: data, conversations, messages, deals, appointments as JSON. Logged. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = await requireOrg();
  const { supabase, org } = context;
  if (!isUuid(id)) return plain("Contatto non trovato.", 404);
  // `export_contact` runs with the caller's RLS; staff sees every organization, so check the current one here.
  const { data: contact } = await supabase
    .from("contacts")
    .select("id, full_name")
    .eq("id", id)
    .eq("organization_id", org.organization.id)
    .maybeSingle();
  if (!contact) return plain("Contatto non trovato.", 404);
  const { data, error } = await supabase.rpc("export_contact", { p_contact: contact.id });
  if (error) {
    console.error("[contact export]", error.code, error.message);
    return plain(`Esportazione non riuscita. ${errorMessage(error)}`, 500);
  }
  const actor = actorOf(context);
  await writeAudit(supabase, {
    organizationId: org.organization.id,
    actorId: actor.id,
    actorType: actor.type,
    action: "contact.export",
    entityType: "contacts",
    entityId: contact.id,
    isSupportAccess: actor.type === "admin",
  });
  const date = new Date().toISOString().slice(0, 10);
  const filename = `contatto-${slugify(contact.full_name) || contact.id.slice(0, 8)}-${date}.json`;
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
