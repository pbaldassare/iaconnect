"use server";
import { type ActionResult, fail, failFromError, ok } from "@/lib/action";
import { requestJob } from "@/lib/jobs";
import { isUuid } from "@/lib/org-selection";
import { actorOf, requireOrg } from "@/lib/session";
import { revalidatePath } from "next/cache";

/**
 * Records the decision on the approval row, then asks the worker to resume the
 * flow (`approval_decided`). The worker reads the decision from the database.
 */
export async function decideApproval(
  approvalId: string,
  decision: "approved" | "rejected",
  _prev: ActionResult,
): Promise<ActionResult> {
  const context = await requireOrg();
  const { supabase, org, session } = context;
  if (!isUuid(approvalId)) return fail("Approvazione non valida.");
  // Only a pending row can be decided: a second click or a colleague's decision changes nothing.
  const { data: updated, error } = await supabase
    .from("approvals")
    .update({ status: decision, decided_by: session.user.id, decided_at: new Date().toISOString() })
    .eq("id", approvalId)
    .eq("organization_id", org.organization.id)
    .eq("status", "pending")
    .select("id");
  if (error) return failFromError(error);
  revalidatePath("/app/approvazioni");
  if (!updated || updated.length === 0) {
    return fail("Questa richiesta è già stata decisa o è scaduta. Ricarica la pagina.");
  }
  const job = await requestJob(supabase, {
    organizationId: org.organization.id,
    kind: "approval_decided",
    payload: { approval_id: approvalId },
    dedupeKey: `approval_decided:${approvalId}`,
    actor: actorOf(context),
  });
  if (job.error) {
    console.error("[approvals] job", job.error);
    return fail(
      "La decisione è stata registrata, ma il flusso non è stato avvisato. Contatta l'assistenza: il flusso resta in attesa fino alla scadenza.",
    );
  }
  return ok(
    decision === "approved"
      ? "Approvata: il flusso riprende tra pochi secondi."
      : "Rifiutata: il flusso prosegue dal ramo del rifiuto.",
  );
}
