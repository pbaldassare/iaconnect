import { APP_LINKS, ConnectorError, type HealthStatus, NormalizedEventInputSchema } from "@ia-connect/core";
import { connectorContext } from "../connectors.ts";
import { type JobRow, getConnection, notify } from "../db/repo.ts";
import { iso, json } from "../db/sql.ts";
import type { Deps } from "../deps.ts";
import { errorMessage } from "../errors.ts";
import { RejectedJob, scheduleJob } from "../queue.ts";
import { type JobResult, userPayload, uuid } from "./types.ts";

/** Polls one connection, stores the cursor, turns what it found into events, and books the next poll. */
export async function pollConnection(deps: Deps, job: JobRow): Promise<JobResult> {
  const connectionId = uuid((job.payload as { connection_id?: unknown }).connection_id);
  const connection = await getConnection(deps.sql, job.organization_id!, connectionId);
  const connector = connection ? deps.connectors.get(connection.connector_type) : undefined;
  // Not pollable (any more): the job ends; the ensure pass books it again when the connection is back.
  if (!connection || connection.status !== "active" || !connector?.poll) return;

  const minutes = Number(connection.config.pollIntervalMinutes) || deps.config.pollIntervalMinutes;
  const rescheduleAt = new Date(deps.now().getTime() + minutes * 60_000);
  try {
    const cursor = connection.config.cursor as Record<string, unknown> | undefined;
    const result = await connector.poll(await connectorContext(deps, connection), cursor);
    await deps.sql.transaction(async (tx) => {
      for (const input of result.events) {
        const parsed = NormalizedEventInputSchema.safeParse(input);
        if (!parsed.success) {
          deps.logger.warn("connector returned an invalid event", { connectionId, connector: connector.key });
          continue;
        }
        await tx.query(
          `insert into ia_connect.events (organization_id, type, connection_id, payload, contact_hint, dedupe_key, occurred_at)
           values ($1, $2, $3, $4::jsonb, $5::jsonb, $6, coalesce($7::timestamptz, now()))
           on conflict (organization_id, dedupe_key) do nothing`,
          [
            connection.organization_id,
            parsed.data.type,
            connection.id,
            json(parsed.data.payload),
            parsed.data.contact ? json(parsed.data.contact) : null,
            parsed.data.dedupeKey,
            parsed.data.occurredAt ?? null,
          ],
        );
      }
      if (result.cursor !== undefined) {
        await tx.query(
          "update ia_connect.connections set config = jsonb_set(config, '{cursor}', $2::jsonb), last_error = null where id = $1",
          [connection.id, json(result.cursor)],
        );
      }
    });
  } catch (error) {
    // A failed poll is not retried on its own: the next one comes anyway. A permanent
    // failure (revoked access) asks for a health check, which tells the customer.
    deps.logger.warn("poll failed", { connectionId, error: errorMessage(error) });
    await deps.sql.query("update ia_connect.connections set last_error = $2 where id = $1", [
      connection.id,
      errorMessage(error),
    ]);
    if (error instanceof ConnectorError && !error.retryable) {
      await scheduleJob(deps.sql, {
        organizationId: connection.organization_id,
        kind: "verify_connection",
        payload: { connection_id: connection.id },
        runAt: deps.now(),
        dedupeKey: `verify:${connection.id}`,
      });
    }
  }
  return { rescheduleAt };
}

/** Health check: decides `connections.status` and tells the organization when access is lost. */
export async function verifyConnection(deps: Deps, job: JobRow): Promise<JobResult> {
  const connectionId = userPayload("verify_connection", job).connection_id;
  const connection = await getConnection(deps.sql, job.organization_id!, connectionId);
  if (!connection) throw new RejectedJob("connection not found in the job's organization");
  const recurring = job.dedupe_key === `verify:${connection.id}`;
  const rescheduleAt = recurring ? new Date(deps.now().getTime() + 24 * 3_600_000) : undefined;
  const connector = deps.connectors.get(connection.connector_type);
  if (connection.status === "disconnected" || !connector) return;

  let health: HealthStatus;
  try {
    health = await connector.verify(await connectorContext(deps, connection));
  } catch (error) {
    if (error instanceof ConnectorError && error.retryable) throw error;
    health = { status: "error", message: errorMessage(error) };
  }
  await deps.sql.query(
    "update ia_connect.connections set status = $2, last_checked_at = $3::timestamptz, last_error = $4 where id = $1",
    [
      connection.id,
      health.status,
      iso(deps.now()),
      health.status === "active" ? null : (health.message ?? null),
    ],
  );
  if ((health.status === "expired" || health.status === "error") && connection.status !== health.status) {
    await notify(deps.sql, connection.organization_id, {
      kind: "connection",
      title: health.status === "expired" ? "Collegamento scaduto" : "Collegamento con problemi",
      body:
        health.status === "expired"
          ? `Il collegamento "${connection.name}" è scaduto: va ricollegato dalla pagina Collegamenti.`
          : `Il collegamento "${connection.name}" non risponde${health.message ? `: ${health.message}` : "."}`,
      link: APP_LINKS.connection(connection.id),
    });
  }
  return { rescheduleAt };
}
