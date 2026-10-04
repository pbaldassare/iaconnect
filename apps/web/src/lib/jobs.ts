import "server-only";
import { writeAudit } from "@/lib/audit";
import { type JobRequest, jobInsertRow } from "@/lib/job-requests";
import type { Db } from "@/lib/supabase/types";
import type { Json, UserJobKind } from "@ia-connect/core";

export { USER_JOB_KINDS, type UserJobKind } from "@ia-connect/core";

/**
 * Asks the worker to do something, by inserting a row in `scheduled_jobs`.
 * The web app never calls connectors, AI or scraping itself: it requests a
 * job and shows its outcome (the worker updates the related rows).
 *
 * RLS (migration 20261004000500_user_jobs.sql) accepts only these kinds:
 *   - any member:  send_message, approval_decided
 *   - managers:    simulate_flow, scrape_run, scrape_trace, verify_connection
 * and only with status "pending", attempts 0 and created_by = the signed-in user
 * (column defaults). The worker treats the payload as untrusted and looks every
 * record up by the job's organization.
 *
 * Build the request with the functions of `lib/job-requests.ts`: kind, payload and
 * dedupe key live there, and the payload shapes are the schemas of packages/core
 * (`USER_JOB_PAYLOADS`) that the worker's handlers parse.
 */
export async function requestJob<K extends UserJobKind>(
  supabase: Db,
  job: JobRequest<K> & {
    organizationId: string;
    /** When to run; default now. */
    runAt?: Date;
    /** Who asks, for the audit log. */
    actor: { id: string; type: "user" | "admin" };
  },
): Promise<{ id: string; error: null } | { id: null; error: unknown }> {
  const row = jobInsertRow(job.organizationId, job, job.runAt);
  const { data, error } = await supabase
    .from("scheduled_jobs")
    .insert({ ...row, payload: row.payload as Json })
    .select("id")
    .single();
  if (error) return { id: null, error };
  await writeAudit(supabase, {
    organizationId: job.organizationId,
    actorId: job.actor.id,
    actorType: job.actor.type,
    action: `job.${job.kind}`,
    entityType: "scheduled_jobs",
    entityId: data.id,
    isSupportAccess: job.actor.type === "admin",
  });
  return { id: data.id, error: null };
}
