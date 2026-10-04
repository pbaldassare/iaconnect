import { iso } from "./db/sql.ts";
import type { Deps } from "./deps.ts";

/** A recurring job is one row per target; this revives it when it ended or failed a while ago. */
const REVIVE = `on conflict (dedupe_key) do update
  set status = 'pending', attempts = 0, run_at = excluded.run_at, last_error = null, locked_until = null
  where ia_connect.scheduled_jobs.status in ('done', 'cancelled')
     or (ia_connect.scheduled_jobs.status = 'failed' and ia_connect.scheduled_jobs.updated_at < $1::timestamptz - interval '1 hour')`;

/**
 * Keeps the recurring jobs in place: a poll per active pollable connection, a daily check
 * per connection, a scrape per active recipe, a weekly report per organization. Also books
 * a recovery for runs left `running` by a worker that died.
 */
export async function ensureRecurringJobs(deps: Deps): Promise<void> {
  const now = iso(deps.now());
  const pollable = deps.connectors
    .list()
    .filter((connector) => connector.poll)
    .map((connector) => connector.key);
  if (pollable.length) {
    await deps.sql.query(
      `insert into ia_connect.scheduled_jobs (organization_id, kind, payload, run_at, dedupe_key, created_by)
       select c.organization_id, 'poll_connection', jsonb_build_object('connection_id', c.id), $1::timestamptz, 'poll:' || c.id, null
       from ia_connect.connections c join ia_connect.organizations o on o.id = c.organization_id
       where c.status = 'active' and o.status = 'active' and c.connector_type = any($2::text[])
       ${REVIVE}`,
      [now, pollable],
    );
  }
  await deps.sql.query(
    `insert into ia_connect.scheduled_jobs (organization_id, kind, payload, run_at, dedupe_key, created_by)
     select c.organization_id, 'verify_connection', jsonb_build_object('connection_id', c.id),
       coalesce(c.last_checked_at + interval '1 day', $1::timestamptz), 'verify:' || c.id, null
     from ia_connect.connections c join ia_connect.organizations o on o.id = c.organization_id
     where c.status <> 'disconnected' and o.status = 'active'
     ${REVIVE}`,
    [now],
  );
  await deps.sql.query(
    `insert into ia_connect.scheduled_jobs (organization_id, kind, payload, run_at, dedupe_key, created_by)
     select r.organization_id, 'scrape_run', jsonb_build_object('recipe_id', r.id),
       coalesce(r.last_run_at + make_interval(mins => r.interval_minutes), $1::timestamptz), 'scrape:' || r.id, null
     from ia_connect.scrape_recipes r join ia_connect.organizations o on o.id = r.organization_id
     where r.status = 'active' and r.active_version_id is not null and o.status = 'active'
     ${REVIVE}`,
    [now],
  );
  await deps.sql.query(
    `insert into ia_connect.scheduled_jobs (organization_id, kind, payload, run_at, dedupe_key, created_by)
     select o.id, 'report', '{}'::jsonb, $1::timestamptz + interval '7 days', 'report:' || o.id, null
     from ia_connect.organizations o where o.status = 'active'
     ${REVIVE}`,
    [now],
  );
  // Runs still `running` with no live lock belong to a worker that died mid-run.
  await deps.sql.query(
    `insert into ia_connect.scheduled_jobs (organization_id, kind, payload, run_at, flow_run_id, dedupe_key, created_by)
     select r.organization_id, 'resume_run', jsonb_build_object('run_id', r.id), $1::timestamptz, r.id, 'recover:' || r.id, null
     from ia_connect.flow_runs r
     where r.status = 'running' and (r.locked_until is null or r.locked_until < $1::timestamptz)
       and r.updated_at < $1::timestamptz - interval '2 minutes'
     ${REVIVE}`,
    [now],
  );
}
