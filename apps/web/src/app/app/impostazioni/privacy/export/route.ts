import { errorMessage } from "@/lib/action";
import { writeAudit } from "@/lib/audit";
import { DEMO_READ_ONLY_MESSAGE } from "@/lib/demo/client";
import { slugify } from "@/lib/parse";
import { actorOf, requireOrgManager } from "@/lib/session";

/** Everything the organization owns as JSON (managers only; the RPC checks it again). Logged. */
export async function GET() {
  const context = await requireOrgManager();
  // Downloads stay closed in the demo (the middleware already sends demo visitors back).
  if (context.demo) {
    return new Response(DEMO_READ_ONLY_MESSAGE, {
      status: 403,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  const { supabase, org } = context;
  const { data, error } = await supabase.rpc("export_organization", { p_org: org.organization.id });
  if (error) {
    console.error("[org export]", error.code, error.message);
    return new Response(`Esportazione non riuscita. ${errorMessage(error)}`, {
      status: 500,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  const actor = actorOf(context);
  await writeAudit(supabase, {
    organizationId: org.organization.id,
    actorId: actor.id,
    actorType: actor.type,
    action: "organization.export",
    entityType: "organizations",
    entityId: org.organization.id,
    isSupportAccess: actor.type === "admin",
  });
  const date = new Date().toISOString().slice(0, 10);
  const filename = `${slugify(org.organization.name) || "azienda"}-${date}.json`;
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
