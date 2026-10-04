import { USER_JOB_PAYLOADS, type UserJobKind, type UserJobPayload } from "@ia-connect/core";
import type { JobRow } from "../db/repo.ts";
import type { Deps } from "../deps.ts";
import { RejectedJob } from "../queue.ts";

/** `rescheduleAt` keeps a recurring job alive: the same row runs again at that time. */
// biome-ignore lint/suspicious/noConfusingVoidType: handlers without a result simply return nothing
export type JobResult = { rescheduleAt?: Date } | void;
export type JobHandler = (deps: Deps, job: JobRow) => Promise<JobResult>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Payload ids come from users: anything that is not a uuid is refused before it reaches SQL. */
export function uuid(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new RejectedJob("payload id is not a uuid");
  return value;
}

/**
 * The payload of a job a user can request, checked with the schema the web app builds it
 * from (`USER_JOB_PAYLOADS` in packages/core). Anything else is refused, never retried.
 */
export function userPayload<K extends UserJobKind>(kind: K, job: JobRow): UserJobPayload<K> {
  const parsed = USER_JOB_PAYLOADS[kind].safeParse(job.payload);
  if (!parsed.success) {
    const where = parsed.error.issues[0]?.path.join(".") || "payload";
    throw new RejectedJob(`payload id is not a uuid or the payload is malformed (${where})`);
  }
  return parsed.data as UserJobPayload<K>;
}
