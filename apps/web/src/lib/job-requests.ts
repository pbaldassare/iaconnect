import {
  USER_JOB_KEY_PREFIX,
  USER_JOB_PAYLOADS,
  type UserJobKind,
  type UserJobPayload,
} from "@ia-connect/core";

/**
 * Every job the web app asks the worker to run: kind, payload and dedupe key, built in
 * one place. Pure (no `server-only`, no `@/` imports) so the worker's tests can import
 * these builders and feed the handlers exactly what the web inserts.
 *
 * The payload types come from `USER_JOB_PAYLOADS` in packages/core, the same schemas the
 * worker's handlers parse.
 */
export interface JobRequest<K extends UserJobKind = UserJobKind> {
  kind: K;
  payload: UserJobPayload<K>;
  /**
   * `scheduled_jobs.dedupe_key` is unique: a second insert with the same key fails with 23505.
   * Always starts with `user:` (RLS refuses anything else): the keys without the prefix are
   * the worker's own recurring jobs, which a customer must not be able to occupy.
   */
  dedupeKey: string;
}

const bucket = (now: Date, ms: number) => Math.floor(now.getTime() / ms);

/** The operator's queued message. One job per message, ever. */
export function sendMessageJob(messageId: string): JobRequest<"send_message"> {
  return {
    kind: "send_message",
    payload: { message_id: messageId },
    dedupeKey: `${USER_JOB_KEY_PREFIX}send_message:${messageId}`,
  };
}

/**
 * Resumes the run after a decision. The approval row is reused when a flow comes back to
 * the same step, so the key carries the moment of the decision: a later decision on the
 * same row is a new job. (A double click is already stopped by the `status = 'pending'`
 * condition of the update that records the decision.)
 */
export function approvalDecidedJob(approvalId: string, decidedAt: Date): JobRequest<"approval_decided"> {
  return {
    kind: "approval_decided",
    payload: { approval_id: approvalId },
    dedupeKey: `${USER_JOB_KEY_PREFIX}approval_decided:${approvalId}:${decidedAt.getTime()}`,
  };
}

/** A double click within ten seconds is one request. */
export function simulateFlowJob(flowVersionId: string, now: Date = new Date()): JobRequest<"simulate_flow"> {
  return {
    kind: "simulate_flow",
    payload: { flow_version_id: flowVersionId },
    dedupeKey: `${USER_JOB_KEY_PREFIX}simulate:${flowVersionId}:${bucket(now, 10_000)}`,
  };
}

/**
 * The "evento di prova" of a flow triggered by an event reserved to connectors (an inbound
 * message, a payment…): one simulation over the sample content. No event row is created.
 */
export function simulateSampleJob(
  flowVersionId: string,
  payload: Record<string, unknown>,
  now: Date = new Date(),
): JobRequest<"simulate_flow"> {
  return {
    kind: "simulate_flow",
    payload: { flow_version_id: flowVersionId, sample: { payload } },
    dedupeKey: `${USER_JOB_KEY_PREFIX}simulate-sample:${flowVersionId}:${bucket(now, 10_000)}`,
  };
}

/** One extra run now; at most one request per recipe per minute. */
export function scrapeRunJob(recipeId: string, now: Date = new Date()): JobRequest<"scrape_run"> {
  return {
    kind: "scrape_run",
    payload: { recipe_id: recipeId },
    dedupeKey: `${USER_JOB_KEY_PREFIX}scrape-now:${recipeId}:${bucket(now, 60_000)}`,
  };
}

export function scrapeTraceJob(recipeId: string, now: Date = new Date()): JobRequest<"scrape_trace"> {
  return {
    kind: "scrape_trace",
    payload: { recipe_id: recipeId },
    dedupeKey: `${USER_JOB_KEY_PREFIX}trace-now:${recipeId}:${bucket(now, 60_000)}`,
  };
}

/** "Verifica ora"; the worker's own daily check uses the key `verify:<id>` and reschedules itself. */
export function verifyConnectionJob(
  connectionId: string,
  now: Date = new Date(),
): JobRequest<"verify_connection"> {
  return {
    kind: "verify_connection",
    payload: { connection_id: connectionId },
    dedupeKey: `${USER_JOB_KEY_PREFIX}verify-now:${connectionId}:${bucket(now, 60_000)}`,
  };
}

/**
 * The `scheduled_jobs` row the web inserts: only these columns. `created_by` (the signed-in
 * user), `status` ("pending") and `attempts` (0) are column defaults, which is what the RLS
 * policy of migration 20261004000500_user_jobs.sql requires.
 * Throws when the payload does not match the shared schema: a bug, never user input.
 */
export function jobInsertRow<K extends UserJobKind>(
  organizationId: string,
  request: JobRequest<K>,
  runAt: Date = new Date(),
): {
  organization_id: string;
  kind: K;
  payload: UserJobPayload<K>;
  run_at: string;
  dedupe_key: string;
} {
  return {
    organization_id: organizationId,
    kind: request.kind,
    payload: USER_JOB_PAYLOADS[request.kind].parse(request.payload) as UserJobPayload<K>,
    run_at: runAt.toISOString(),
    dedupe_key: request.dedupeKey,
  };
}
