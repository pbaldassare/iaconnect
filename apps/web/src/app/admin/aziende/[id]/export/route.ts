import { errorMessage } from "@/lib/action";
import { writeAudit } from "@/lib/audit";
import { slugify } from "@/lib/parse";
import { requireStaffForOrg } from "@/lib/session";

/** Downloads everything the organization owns as JSON (GDPR export). The export is logged. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase, session, organization } = await requireStaffForOrg(id);
  const { data, error } = await supabase.rpc("export_organization", { p_org: organization.id });
  if (error) {
    console.error("[export]", error.code, error.message);
    return new Response(`Esportazione non riuscita. ${errorMessage(error)}`, {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  await writeAudit(supabase, {
    organizationId: organization.id,
    actorId: session.user.id,
    actorType: "admin",
    action: "organization.export",
    entityType: "organizations",
    entityId: organization.id,
    isSupportAccess: true,
  });
  const date = new Date().toISOString().slice(0, 10);
  const filename = `${slugify(organization.name) || "azienda"}-${date}.json`;
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
