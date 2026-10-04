import { type Channel, FlowDefinitionSchema, INBOUND_MESSAGE_EVENTS, normalizePhone } from "@ia-connect/core";
import { type EventRow, type JobRow, cleanContactKeys, findContact } from "../db/repo.ts";
import type { Deps } from "../deps.ts";
import { executeRun, signalRun } from "../engine/engine.ts";
import { createRun, triggerMatches } from "../events.ts";
import { RejectedJob } from "../queue.ts";
import { type JobResult, userPayload, uuid } from "./types.ts";

async function ownRun(deps: Deps, job: JobRow, runId: string): Promise<void> {
  const rows = await deps.sql.query(
    "select 1 from ia_connect.flow_runs where id = $1 and organization_id = $2",
    [runId, job.organization_id],
  );
  if (!rows.length) throw new RejectedJob("run not found in the job's organization");
}

/** Wakes a run up after a delay or a retry pause; without a key it only recovers an orphaned run. */
export async function resumeRun(deps: Deps, job: JobRow): Promise<JobResult> {
  const payload = job.payload as { run_id?: unknown; key?: unknown; signal?: unknown };
  const runId = uuid(payload.run_id);
  await ownRun(deps, job, runId);
  if (typeof payload.key === "string") {
    await signalRun(deps.sql, job.organization_id!, runId, {
      kind: payload.signal === "retry" ? "retry" : "timer",
      key: payload.key,
    });
  }
  await executeRun(deps, runId);
}

/** The reply or the decision did not arrive in time. A late timeout finds the run elsewhere and does nothing. */
export async function waitTimeout(deps: Deps, job: JobRow): Promise<JobResult> {
  const payload = job.payload as { run_id?: unknown; key?: unknown };
  const runId = uuid(payload.run_id);
  await ownRun(deps, job, runId);
  await signalRun(deps.sql, job.organization_id!, runId, { kind: "timeout", key: String(payload.key ?? "") });
  await executeRun(deps, runId);
}

/** The decision is read from the database, never from the payload. */
export async function approvalDecided(deps: Deps, job: JobRow): Promise<JobResult> {
  const approvalId = userPayload("approval_decided", job).approval_id;
  const rows = await deps.sql.query<{
    flow_run_id: string;
    step_id: string;
    status: string;
    current: string | null;
  }>(
    `select a.flow_run_id, a.step_id, a.status, r.current_step_id as current
     from ia_connect.approvals a join ia_connect.flow_runs r on r.id = a.flow_run_id
     where a.id = $1 and a.organization_id = $2`,
    [approvalId, job.organization_id],
  );
  const approval = rows[0];
  if (!approval) throw new RejectedJob("approval not found in the job's organization");
  if (approval.status !== "approved" && approval.status !== "rejected") return;
  if (approval.current === approval.step_id) {
    await signalRun(deps.sql, job.organization_id!, approval.flow_run_id, {
      kind: "approval",
      decision: approval.status,
    });
  }
  await executeRun(deps, approval.flow_run_id);
}

/** Read-only lookup of who an event is about, so a simulation can show real names. */
async function simulationLink(deps: Deps, event: EventRow) {
  const channel: Channel | undefined = INBOUND_MESSAGE_EVENTS[event.type];
  const payload = event.payload as Record<string, unknown>;
  const from = typeof payload.from === "string" ? payload.from : "";
  const keys = channel
    ? channel === "mail"
      ? { email: from.toLowerCase() }
      : channel === "social"
        ? { socialId: from }
        : { phone: normalizePhone(from) }
    : cleanContactKeys((event.contact_hint ?? {}) as { phone?: unknown; email?: unknown });
  const contact = await findContact(deps.sql, event.organization_id, keys);
  if (!contact || !channel) return { contactId: contact?.id ?? null, conversationId: null };
  const conversations = await deps.sql.query<{ id: string }>(
    `select id from ia_connect.conversations where organization_id = $1 and contact_id = $2 and channel = $3
     order by last_message_at desc nulls last limit 1`,
    [event.organization_id, contact.id, channel],
  );
  return { contactId: contact.id, conversationId: conversations[0]?.id ?? null };
}

/** Runs a flow version in simulation over the organization's most recent matching events. */
export async function simulateFlow(deps: Deps, job: JobRow): Promise<JobResult> {
  const payload = userPayload("simulate_flow", job);
  const versionId = payload.flow_version_id;
  const organizationId = job.organization_id!;
  const versions = await deps.sql.query<{ flow_id: string; definition: unknown }>(
    "select flow_id, definition from ia_connect.flow_versions where id = $1 and organization_id = $2",
    [versionId, organizationId],
  );
  if (!versions[0]) throw new RejectedJob("flow version not found in the job's organization");
  const parsed = FlowDefinitionSchema.safeParse(versions[0].definition);
  if (!parsed.success) throw new RejectedJob("flow version with an invalid definition");
  const definition = parsed.data;
  const limit = payload.limit ?? 3;

  const recent = await deps.sql.query<EventRow>(
    `select * from ia_connect.events where organization_id = $1 and type = $2
     order by created_at desc limit 200`,
    [organizationId, definition.trigger.event],
  );
  const events = recent.filter((event) => triggerMatches(definition, event)).slice(0, limit);
  const base = {
    organizationId,
    flowId: versions[0].flow_id,
    versionId,
    definition,
    mode: "simulation" as const,
  };

  // A new simulation replaces the previous one over the same event.
  if (events.length === 0) {
    await deps.sql.query(
      "delete from ia_connect.flow_runs where flow_version_id = $1 and event_id is null and mode = 'simulation'",
      [versionId],
    );
    // No real event yet: one run over an empty event still shows the path of the flow.
    const run = await createRun(deps.sql, {
      ...base,
      event: { id: null, type: definition.trigger.event, payload: {} },
    });
    await executeRun(deps, run.id);
    return;
  }
  for (const event of events) {
    await deps.sql.query(
      "delete from ia_connect.flow_runs where flow_version_id = $1 and event_id = $2 and mode = 'simulation'",
      [versionId, event.id],
    );
    const run = await createRun(deps.sql, { ...base, event, ...(await simulationLink(deps, event)) });
    await executeRun(deps, run.id);
  }
}
