import { APP_LINKS } from "@ia-connect/core";
import { type JobRow, notify } from "../db/repo.ts";
import { iso } from "../db/sql.ts";
import type { Deps } from "../deps.ts";
import type { JobResult } from "./types.ts";

const WEEK_MS = 7 * 86_400_000;

/** Weekly summary for one organization: plain counts, no AI. */
export async function report(deps: Deps, job: JobRow): Promise<JobResult> {
  const organizationId = job.organization_id;
  if (!organizationId) return;
  const now = deps.now();
  const since = iso(new Date(now.getTime() - WEEK_MS));
  const rows = await deps.sql.query<
    Record<"runs" | "failed" | "sent" | "received" | "contacts" | "deals" | "won", number>
  >(
    `select
       (select count(*) from ia_connect.flow_runs where organization_id = $1 and mode = 'live' and started_at >= $2::timestamptz)::int as runs,
       (select count(*) from ia_connect.flow_runs where organization_id = $1 and mode = 'live' and status = 'failed' and started_at >= $2::timestamptz)::int as failed,
       (select count(*) from ia_connect.messages where organization_id = $1 and direction = 'out' and created_at >= $2::timestamptz)::int as sent,
       (select count(*) from ia_connect.messages where organization_id = $1 and direction = 'in' and created_at >= $2::timestamptz)::int as received,
       (select count(*) from ia_connect.contacts where organization_id = $1 and created_at >= $2::timestamptz)::int as contacts,
       (select count(*) from ia_connect.deals where organization_id = $1 and created_at >= $2::timestamptz)::int as deals,
       (select count(*) from ia_connect.deals d join ia_connect.deal_stages s on s.id = d.stage_id
         where d.organization_id = $1 and s.kind = 'won' and d.closed_at >= $2::timestamptz)::int as won`,
    [organizationId, since],
  );
  const counts = rows[0]!;
  await notify(deps.sql, organizationId, {
    kind: "report",
    title: "Riepilogo della settimana",
    body:
      `Flussi eseguiti: ${counts.runs} (non completati: ${counts.failed}). ` +
      `Messaggi inviati: ${counts.sent}, ricevuti: ${counts.received}. ` +
      `Nuovi contatti: ${counts.contacts}. Nuove trattative: ${counts.deals}, chiuse con successo: ${counts.won}.`,
    link: APP_LINKS.report(),
  });
  return { rescheduleAt: new Date(now.getTime() + WEEK_MS) };
}
