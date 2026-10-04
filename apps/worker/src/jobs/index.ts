import { type JobRow, getOrganization } from "../db/repo.ts";
import type { Deps } from "../deps.ts";
import { RejectedJob } from "../queue.ts";
import { scrapeRun, scrapeTrace } from "../scrape/jobs.ts";
import { pollConnection, verifyConnection } from "./connections.ts";
import { sendMessage } from "./messages.ts";
import { report } from "./report.ts";
import { approvalDecided, resumeRun, simulateFlow, waitTimeout } from "./runs.ts";
import type { JobHandler, JobResult } from "./types.ts";

export const JOB_HANDLERS: Record<string, JobHandler> = {
  resume_run: resumeRun,
  wait_timeout: waitTimeout,
  send_message: sendMessage,
  approval_decided: approvalDecided,
  simulate_flow: simulateFlow,
  scrape_run: scrapeRun,
  scrape_trace: scrapeTrace,
  poll_connection: pollConnection,
  verify_connection: verifyConnection,
  report,
};

/** Kinds a signed-in user may insert (see the RLS policy on scheduled_jobs). */
export const USER_JOB_KINDS = new Set([
  "send_message",
  "approval_decided",
  "simulate_flow",
  "scrape_run",
  "scrape_trace",
  "verify_connection",
]);

/** Kinds that must reach the engine even for a suspended organization, so its runs are closed. */
const RUN_KINDS = new Set(["resume_run", "wait_timeout", "approval_decided"]);

/**
 * Runs one claimed job. A job with `created_by` came from a user through RLS: its payload
 * is untrusted, so only the allowed kinds run and every handler looks records up by
 * `job.organization_id`, never by the payload alone.
 */
export async function processJob(deps: Deps, job: JobRow): Promise<JobResult> {
  const handler = JOB_HANDLERS[job.kind];
  if (!handler) throw new RejectedJob(`unknown job kind "${job.kind}"`);
  if (job.created_by && !USER_JOB_KINDS.has(job.kind)) {
    throw new RejectedJob(`job kind "${job.kind}" cannot be requested by a user`);
  }
  if (!job.organization_id) throw new RejectedJob("job without an organization");
  if (!job.payload || typeof job.payload !== "object" || Array.isArray(job.payload)) {
    throw new RejectedJob("job payload is not an object");
  }
  const org = await getOrganization(deps.sql, job.organization_id);
  if (!org) throw new RejectedJob("organization not found");
  if (org.status !== "active" && !RUN_KINDS.has(job.kind)) return;
  return handler(deps, job);
}
