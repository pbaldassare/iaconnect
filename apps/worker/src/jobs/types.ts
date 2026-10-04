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
