import { type EventRow, type JobRow, notify } from "./db/repo.ts";
import { type Sql, iso, json } from "./db/sql.ts";
import { type Deps, backoffMs } from "./deps.ts";
import { RetryLater, errorMessage } from "./errors.ts";

/**
 * The queue is two tables (see docs/decisioni: no pgmq/pg_cron). Rows are claimed with
 * FOR UPDATE SKIP LOCKED and a `locked_until` lease, so a crashed worker's rows are
 * picked up again once the lease expires: at-least-once delivery.
 */
export async function claimEvents(deps: Deps, limit: number): Promise<EventRow[]> {
  const now = deps.now();
  return deps.sql.query<EventRow>(
    `update ia_connect.events set status = 'processing', attempts = attempts + 1, locked_until = $2::timestamptz
     where id in (
       select id from ia_connect.events
       where (status = 'pending' and available_at <= $1::timestamptz)
          or (status = 'processing' and locked_until < $1::timestamptz)
       order by available_at, created_at
       limit $3::int
       for update skip locked)
     returning *`,
    [iso(now), iso(new Date(now.getTime() + deps.config.lockMs)), limit],
  );
}

export async function completeEvent(
  sql: Sql,
  id: string,
  status: "processed" | "ignored",
  at: Date,
  note?: string,
) {
  await sql.query(
    `update ia_connect.events set status = $2, processed_at = $3::timestamptz, locked_until = null, error = $4
     where id = $1`,
    [id, status, iso(at), note ?? null],
  );
}

/** Retries with a growing delay; after the last attempt the event fails and the organization is told. */
export async function failEvent(deps: Deps, event: EventRow, error: unknown): Promise<void> {
  const now = deps.now();
  if (error instanceof RetryLater) {
    await deps.sql.query(
      `update ia_connect.events set status = 'pending', attempts = greatest(attempts - 1, 0), locked_until = null,
         available_at = $2::timestamptz where id = $1`,
      [event.id, iso(new Date(now.getTime() + error.delayMs))],
    );
    return;
  }
  const message = errorMessage(error);
  if (event.attempts >= deps.config.maxAttempts) {
    await deps.sql.transaction(async (tx) => {
      await tx.query(
        "update ia_connect.events set status = 'failed', locked_until = null, error = $2, processed_at = $3::timestamptz where id = $1",
        [event.id, message, iso(now)],
      );
      await notify(tx, event.organization_id, {
        kind: "error",
        title: "Evento non elaborato",
        body: `Un evento di tipo "${event.type}" non è stato elaborato dopo ${event.attempts} tentativi.`,
      });
    });
    return;
  }
  await deps.sql.query(
    `update ia_connect.events set status = 'pending', locked_until = null, error = $2, available_at = $3::timestamptz
     where id = $1`,
    [event.id, message, iso(new Date(now.getTime() + backoffMs(deps.config, event.attempts)))],
  );
}

export async function claimJobs(deps: Deps, limit: number): Promise<JobRow[]> {
  const now = deps.now();
  return deps.sql.query<JobRow>(
    `update ia_connect.scheduled_jobs set status = 'running', attempts = attempts + 1, locked_until = $2::timestamptz
     where id in (
       select id from ia_connect.scheduled_jobs
       where (status = 'pending' and run_at <= $1::timestamptz)
          or (status = 'running' and locked_until < $1::timestamptz)
       order by run_at
       limit $3::int
       for update skip locked)
     returning *`,
    [iso(now), iso(new Date(now.getTime() + deps.config.lockMs)), limit],
  );
}

/** A recurring job goes back to `pending` at `rescheduleAt` instead of being closed. */
export async function completeJob(sql: Sql, id: string, rescheduleAt?: Date) {
  if (rescheduleAt) {
    await sql.query(
      `update ia_connect.scheduled_jobs set status = 'pending', attempts = 0, locked_until = null, last_error = null,
         run_at = $2::timestamptz where id = $1`,
      [id, iso(rescheduleAt)],
    );
    return;
  }
  await sql.query(
    "update ia_connect.scheduled_jobs set status = 'done', locked_until = null, last_error = null where id = $1",
    [id],
  );
}

export async function failJob(
  deps: Deps,
  job: JobRow,
  error: unknown,
  title = JOB_TITLES[job.kind],
): Promise<void> {
  const now = deps.now();
  if (error instanceof RetryLater) {
    await deps.sql.query(
      `update ia_connect.scheduled_jobs set status = 'pending', attempts = greatest(attempts - 1, 0), locked_until = null,
         run_at = $2::timestamptz where id = $1`,
      [job.id, iso(new Date(now.getTime() + error.delayMs))],
    );
    return;
  }
  const message = errorMessage(error);
  // Refused, or failed for good by its own handler: no retry, and no second notification.
  const final = error instanceof RejectedJob || error instanceof FinalJobFailure;
  if (final || job.attempts >= deps.config.maxAttempts) {
    await deps.sql.transaction(async (tx) => {
      await tx.query(
        "update ia_connect.scheduled_jobs set status = 'failed', locked_until = null, last_error = $2 where id = $1",
        [job.id, message],
      );
      if (job.organization_id && !final) {
        await notify(tx, job.organization_id, {
          kind: "error",
          title: "Operazione non completata",
          body: `${title ?? "Un'operazione pianificata"} non è riuscita dopo ${job.attempts} tentativi.`,
        });
      }
    });
    return;
  }
  await deps.sql.query(
    `update ia_connect.scheduled_jobs set status = 'pending', locked_until = null, last_error = $2, run_at = $3::timestamptz
     where id = $1`,
    [job.id, message, iso(new Date(now.getTime() + backoffMs(deps.config, job.attempts)))],
  );
}

/** A job the worker refuses to run (untrusted payload, unknown kind). Failed at once, never retried. */
export class RejectedJob extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RejectedJob";
  }
}

/**
 * A job that ran and failed in a way another attempt would not fix (a site that cannot be
 * traced). The handler has already told the organization: the row becomes `failed` with the
 * reason in `last_error`, which is what the web app reads.
 */
export class FinalJobFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FinalJobFailure";
  }
}

const JOB_TITLES: Record<string, string> = {
  resume_run: "La ripresa di un flusso",
  wait_timeout: "La scadenza di un'attesa",
  send_message: "L'invio di un messaggio",
  approval_decided: "La ripresa dopo un'approvazione",
  simulate_flow: "La simulazione di un flusso",
  scrape_run: "La lettura di un sito",
  scrape_trace: "La tracciatura di un sito",
  poll_connection: "La lettura di un collegamento",
  verify_connection: "Il controllo di un collegamento",
  report: "Il riepilogo settimanale",
};

export interface ScheduleInput {
  organizationId: string | null;
  kind: string;
  payload: Record<string, unknown>;
  runAt: Date;
  flowRunId?: string | null;
  /** With a key the job is unique: scheduling again revives or moves the same row. */
  dedupeKey?: string;
}

export async function scheduleJob(sql: Sql, input: ScheduleInput): Promise<void> {
  await sql.query(
    `insert into ia_connect.scheduled_jobs (organization_id, kind, payload, run_at, flow_run_id, dedupe_key, created_by)
     values ($1, $2, $3::jsonb, $4::timestamptz, $5, $6, null)
     on conflict (dedupe_key) do update
       set status = 'pending', attempts = 0, run_at = excluded.run_at, payload = excluded.payload,
           locked_until = null, last_error = null`,
    [
      input.organizationId,
      input.kind,
      json(input.payload),
      iso(input.runAt),
      input.flowRunId ?? null,
      input.dedupeKey ?? null,
    ],
  );
}
