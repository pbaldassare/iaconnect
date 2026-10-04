import "server-only";
import { writeAudit } from "@/lib/audit";
import type { Db } from "@/lib/supabase/types";
import type { Json } from "@ia-connect/core";

/**
 * Asks the worker to do something, by inserting a row in `scheduled_jobs`.
 * The web app never calls connectors, AI or scraping itself: it requests a
 * job and shows its outcome (the worker updates the related rows).
 *
 * RLS (migration 20261004000500_user_jobs.sql) accepts only these kinds:
 *   - any member:  send_message, approval_decided
 *   - managers:    simulate_flow, scrape_run, scrape_trace, verify_connection
 * and only with status "pending", attempts 0 and created_by = the signed-in user
 * (the column default). The worker treats the payload as untrusted and looks
 * every record up by the job's organization. Payload shapes are defined by the
 * handlers in apps/worker/src/jobs/.
 */
export const USER_JOB_KINDS = [
  "send_message",
  "approval_decided",
  "simulate_flow",
  "scrape_run",
  "scrape_trace",
  "verify_connection",
] as const;
export type UserJobKind = (typeof USER_JOB_KINDS)[number];

export async function requestJob(
  supabase: Db,
  job: {
    organizationId: string;
    kind: UserJobKind;
    payload: Record<string, Json>;
    /** When to run; default now. */
    runAt?: Date;
    /** Set it to make a double click harmless: a second insert with the same key fails with 23505. */
    dedupeKey?: string;
    /** Who asks, for the audit log. */
    actor: { id: string; type: "user" | "admin" };
  },
): Promise<{ id: string; error: null } | { id: null; error: unknown }> {
  const { data, error } = await supabase
    .from("scheduled_jobs")
    .insert({
      organization_id: job.organizationId,
      kind: job.kind,
      payload: job.payload,
      run_at: (job.runAt ?? new Date()).toISOString(),
      dedupe_key: job.dedupeKey ?? null,
    })
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
