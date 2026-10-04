import { z } from "zod";

/**
 * The contract between the web app and the worker, in one place.
 *
 * The two never call each other: the web inserts rows (`scheduled_jobs`, `messages`),
 * the worker reads them. Both sides import these schemas, so a payload the web builds
 * is by construction a payload the worker accepts.
 */

/** Kinds a signed-in user may insert (RLS policy `org_insert` on `scheduled_jobs`). */
export const USER_JOB_KINDS = [
  "send_message",
  "approval_decided",
  "simulate_flow",
  "scrape_run",
  "scrape_trace",
  "verify_connection",
] as const;
export type UserJobKind = (typeof USER_JOB_KINDS)[number];

/**
 * Every `scheduled_jobs.dedupe_key` of a job requested by a user starts with this (RLS policy
 * `org_insert`). Keys without it belong to the worker (`poll:<id>`, `verify:<id>`, `scrape:<id>`…).
 */
export const USER_JOB_KEY_PREFIX = "user:";

/** Same check the worker always applied to payload ids: 8-4-4-4-12 hex, any version. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const Id = z.string().regex(UUID, "not a uuid");

/** `scheduled_jobs.payload` of every job a user can request. Unknown keys are dropped. */
export const USER_JOB_PAYLOADS = {
  /** The operator's message, already stored with `delivery_status = 'queued'`. */
  send_message: z.object({ message_id: Id }),
  /** The decision itself is read from `approvals`, never from the payload. */
  approval_decided: z.object({ approval_id: Id }),
  /**
   * `limit`: how many recent matching events to simulate (default 3).
   * `sample`: simulate once over this made-up event instead (the "evento di prova" of a flow
   * whose trigger is reserved to connectors, e.g. an inbound message: nothing real is stored
   * and nothing is sent).
   */
  simulate_flow: z.object({
    flow_version_id: Id,
    limit: z.number().int().min(1).max(10).optional(),
    sample: z.object({ payload: z.record(z.string(), z.unknown()) }).optional(),
  }),
  scrape_run: z.object({ recipe_id: Id }),
  scrape_trace: z.object({ recipe_id: Id }),
  verify_connection: z.object({ connection_id: Id }),
} as const satisfies Record<UserJobKind, z.ZodType>;

export type UserJobPayload<K extends UserJobKind> = z.infer<(typeof USER_JOB_PAYLOADS)[K]>;

export function isUserJobKind(kind: string): kind is UserJobKind {
  return (USER_JOB_KINDS as readonly string[]).includes(kind);
}

/**
 * `messages.meta` of a message written by an operator in the inbox.
 * - `variables`: values of the WhatsApp template placeholders, in order ({{1}}, {{2}}…);
 *   the template itself is `messages.template_id`, the filled text is `messages.content`.
 * - `subject`: mail only.
 * Other keys (the worker's own `sending_at`, anything added later) pass through.
 */
export const OperatorMessageMetaSchema = z.looseObject({
  variables: z.array(z.string()).max(20).optional(),
  subject: z.string().max(200).optional(),
});
export type OperatorMessageMeta = { variables?: string[]; subject?: string };

/** Lenient read used by the worker: a malformed `meta` is treated as empty, never as a crash. */
export function readOperatorMessageMeta(meta: unknown): OperatorMessageMeta {
  const record =
    meta && typeof meta === "object" && !Array.isArray(meta) ? (meta as Record<string, unknown>) : {};
  return {
    variables: Array.isArray(record.variables) ? record.variables.map(String) : undefined,
    subject: typeof record.subject === "string" ? record.subject : undefined,
  };
}
