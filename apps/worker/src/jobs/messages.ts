import { type Channel, ConnectorError } from "@ia-connect/core";
import {
  type JobRow,
  type MessageRow,
  audit,
  getContact,
  getConversation,
  resolveConnection,
} from "../db/repo.ts";
import { iso, json } from "../db/sql.ts";
import { deliver } from "../delivery.ts";
import type { Deps } from "../deps.ts";
import { addressOf } from "../engine/send.ts";
import { StepError, errorMessage } from "../errors.ts";
import { RejectedJob } from "../queue.ts";
import { type JobResult, uuid } from "./types.ts";

const ACTIONS: Record<Channel, string> = {
  whatsapp: "sendText",
  mail: "send",
  sms: "send",
  social: "sendMessage",
};

/**
 * Sends a message written by an operator in the inbox (`delivery_status = 'queued'`).
 * Same rules as a flow: consent, quota, WhatsApp window. A refusal is stored on the
 * message in Italian, so the operator sees why it was not sent.
 */
export async function sendMessage(deps: Deps, job: JobRow): Promise<JobResult> {
  const organizationId = job.organization_id!;
  const messageId = uuid((job.payload as { message_id?: unknown }).message_id);
  const rows = await deps.sql.query<MessageRow & { meta: Record<string, unknown> }>(
    "select * from ia_connect.messages where id = $1 and organization_id = $2 and direction = 'out'",
    [messageId, organizationId],
  );
  const message = rows[0];
  if (!message) throw new RejectedJob("message not found in the job's organization");
  if (message.delivery_status !== "queued") return;

  const refuse = async (reason: string) => {
    await deps.sql.query(
      "update ia_connect.messages set delivery_status = 'failed', error = $2, meta = meta - 'sending_at' where id = $1",
      [message.id, reason],
    );
  };
  if (message.meta?.sending_at) {
    // A previous attempt stopped between the send and its bookkeeping.
    await refuse(
      "L'esito dell'invio non è certo dopo un'interruzione del servizio: verificare prima di reinviare.",
    );
    return;
  }

  const channel = message.channel as Channel;
  const conversation = await getConversation(deps.sql, organizationId, message.conversation_id);
  const contact = conversation
    ? await getContact(deps.sql, organizationId, conversation.contact_id)
    : undefined;
  if (!conversation || !contact) throw new RejectedJob("conversation not found in the job's organization");

  try {
    const to = addressOf(contact, channel);
    if (!to) throw new StepError("Il contatto non ha un recapito per questo canale.");
    const connection = await resolveConnection(
      deps.sql,
      organizationId,
      channel,
      null,
      conversation.connection_id,
      (row) => Boolean(deps.connectors.get(row.connector_type)?.actions[ACTIONS[channel]]),
    );
    let template: { name: string; language: string; variables: string[] } | undefined;
    if (message.template_id) {
      const templates = await deps.sql.query<{
        name: string;
        external_name: string | null;
        language: string;
        approval_status: string;
      }>(
        "select name, external_name, language, approval_status from ia_connect.message_templates where id = $1 and organization_id = $2",
        [message.template_id, organizationId],
      );
      const found = templates[0];
      if (!found || found.approval_status !== "approved")
        throw new StepError("Il modello scelto non è approvato.");
      const variables = Array.isArray(message.meta?.variables) ? message.meta.variables.map(String) : [];
      template = { name: found.external_name ?? found.name, language: found.language, variables };
    }
    await deps.sql.query("update ia_connect.messages set meta = meta || $2::jsonb where id = $1", [
      message.id,
      json({ sending_at: iso(deps.now()) }),
    ]);
    const sent = await deliver(deps, deps.sql, {
      organizationId,
      channel,
      connection,
      contact,
      conversation,
      to,
      text: message.content,
      subject: typeof message.meta?.subject === "string" ? message.meta.subject : undefined,
      template,
    });
    await deps.sql.query(
      `update ia_connect.messages set delivery_status = $2, external_id = $3, error = null, meta = meta - 'sending_at'
       where id = $1`,
      [message.id, sent.status, sent.externalId],
    );
    await deps.sql.query(
      "update ia_connect.conversations set last_message_at = $2::timestamptz where id = $1",
      [conversation.id, iso(deps.now())],
    );
    await audit(
      deps.sql,
      organizationId,
      "message.sent",
      { type: "message", id: message.id },
      { channel, by: "operator" },
    );
  } catch (error) {
    if (error instanceof ConnectorError && error.retryable && job.attempts < deps.config.maxAttempts) {
      // The connector says nothing was sent: safe to try again.
      await deps.sql.query("update ia_connect.messages set meta = meta - 'sending_at' where id = $1", [
        message.id,
      ]);
      throw error;
    }
    if (error instanceof StepError || error instanceof ConnectorError) await refuse(error.message);
    else await refuse(`Errore imprevisto, l'esito dell'invio non è certo: ${errorMessage(error)}`);
  }
}
