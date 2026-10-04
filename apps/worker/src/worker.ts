import type { EventRow, JobRow } from "./db/repo.ts";
import type { Deps } from "./deps.ts";
import { ensureRecurringJobs } from "./ensure.ts";
import { errorMessage } from "./errors.ts";
import { processEvent } from "./events.ts";
import { processJob } from "./jobs/index.ts";
import { claimEvents, claimJobs, completeEvent, completeJob, failEvent, failJob } from "./queue.ts";

/**
 * Keeps the lease of a claimed row alive while its handler runs, so a long job
 * (a scrape with a repair) is not taken by a second worker halfway through.
 */
async function withLease<T>(
  deps: Deps,
  table: "events" | "scheduled_jobs",
  id: string,
  work: () => Promise<T>,
) {
  const timer = setInterval(
    () => {
      const until = new Date(deps.now().getTime() + deps.config.lockMs).toISOString();
      deps.sql
        .query(`update ia_connect.${table} set locked_until = $2::timestamptz where id = $1`, [id, until])
        .catch(() => undefined);
    },
    Math.max(1_000, Math.floor(deps.config.lockMs / 3)),
  );
  timer.unref();
  try {
    return await work();
  } finally {
    clearInterval(timer);
  }
}

/** Processes one claimed event and settles it: processed, ignored, retried or failed. */
export async function handleEvent(deps: Deps, event: EventRow): Promise<void> {
  try {
    const outcome = await withLease(deps, "events", event.id, () => processEvent(deps, event));
    await completeEvent(deps.sql, event.id, outcome.status, deps.now(), outcome.note);
    deps.logger.info("event handled", { eventId: event.id, type: event.type, status: outcome.status });
  } catch (error) {
    deps.logger.error("event failed", {
      eventId: event.id,
      type: event.type,
      attempt: event.attempts,
      error: errorMessage(error),
    });
    await failEvent(deps, event, error);
  }
}

export async function handleJob(deps: Deps, job: JobRow): Promise<void> {
  try {
    const result = await withLease(deps, "scheduled_jobs", job.id, () => processJob(deps, job));
    await completeJob(deps.sql, job.id, result?.rescheduleAt);
    deps.logger.info("job handled", { jobId: job.id, kind: job.kind });
  } catch (error) {
    deps.logger.error("job failed", {
      jobId: job.id,
      kind: job.kind,
      attempt: job.attempts,
      error: errorMessage(error),
    });
    await failJob(deps, job, error);
  }
}

/** Handles everything that is due right now, one item at a time. Used by tests and at shutdown. */
export async function drain(deps: Deps, maxItems = 200): Promise<number> {
  let handled = 0;
  while (handled < maxItems) {
    const [event] = await claimEvents(deps, 1);
    if (event) {
      await handleEvent(deps, event);
      handled += 1;
      continue;
    }
    const [job] = await claimJobs(deps, 1);
    if (!job) break;
    await handleJob(deps, job);
    handled += 1;
  }
  return handled;
}

export interface WorkerOptions {
  concurrency: number;
  /** Pause of an idle slot before it looks at the queue again. */
  idleMs?: number;
  ensureEveryMs?: number;
}

/**
 * Starts `concurrency` slots, each taking one event or job at a time, plus the pass
 * that keeps recurring jobs booked. `stop()` lets the items in progress finish.
 */
export function startWorker(deps: Deps, options: WorkerOptions): { stop(): Promise<void> } {
  let stopping = false;
  // Every sleeping loop registers its own wake-up, so `stop()` ends all of them at once.
  const sleepers = new Set<() => void>();
  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      if (stopping) return resolve();
      const wake = () => {
        clearTimeout(timer);
        sleepers.delete(wake);
        resolve();
      };
      const timer = setTimeout(wake, ms);
      sleepers.add(wake);
    });

  const slot = async () => {
    while (!stopping) {
      try {
        const [event] = await claimEvents(deps, 1);
        if (event) {
          await handleEvent(deps, event);
          continue;
        }
        const [job] = await claimJobs(deps, 1);
        if (job) {
          await handleJob(deps, job);
          continue;
        }
      } catch (error) {
        // The database is unreachable or a settle failed: the lease will expire and the item comes back.
        deps.logger.error("worker loop error", { error: errorMessage(error) });
      }
      await sleep(options.idleMs ?? 1_000);
    }
  };

  const ensure = async () => {
    while (!stopping) {
      try {
        await ensureRecurringJobs(deps);
      } catch (error) {
        deps.logger.error("ensure pass failed", { error: errorMessage(error) });
      }
      await sleep(options.ensureEveryMs ?? 60_000);
    }
  };

  const loops = [ensure(), ...Array.from({ length: Math.max(1, options.concurrency) }, slot)];
  return {
    async stop() {
      stopping = true;
      for (const wake of [...sleepers]) wake();
      await Promise.all(loops);
    },
  };
}
