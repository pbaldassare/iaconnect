import { APP_LINKS, SendResultSchema, parseDuration } from "@ia-connect/core";
import { offersAction, runAction } from "../../connectors.ts";
import {
  type ConversationRow,
  addUsage,
  audit,
  consumeQuota,
  getSettings,
  notify,
  resolveConnection,
} from "../../db/repo.ts";
import type { Sql } from "../../db/sql.ts";
import { overrideRecipient } from "../../delivery.ts";
import { errorMessage } from "../../errors.ts";
import { type Executor, type StepContext, next } from "../types.ts";

export const requestApproval: Executor<{ summary: string; timeout: string }> = {
  async run(ctx, params) {
    const existing = await ctx.sql.query<{ id: string }>(
      "select id from ia_connect.approvals where flow_run_id = $1 and step_id = $2 and organization_id = $3",
      [ctx.run.id, ctx.step.id, ctx.org.id],
    );
    if (ctx.signal?.kind === "approval") {
      const outlet = ctx.signal.decision === "approved" ? "onApproved" : "onRejected";
      return next({ approvalId: existing[0]?.id ?? null, decision: ctx.signal.decision }, outlet);
    }
    if (ctx.signal?.kind === "timeout") {
      await ctx.sql.query(
        "update ia_connect.approvals set status = 'expired' where flow_run_id = $1 and step_id = $2 and organization_id = $3 and status = 'pending'",
        [ctx.run.id, ctx.step.id, ctx.org.id],
      );
      return next({ approvalId: existing[0]?.id ?? null, decision: "expired" }, "onTimeout");
    }
    const rows = await ctx.sql.query<{ id: string }>(
      `insert into ia_connect.approvals (organization_id, flow_run_id, step_id, summary)
       values ($1, $2, $3, $4)
       on conflict (flow_run_id, step_id) do update
         set summary = excluded.summary, status = 'pending', decided_by = null, decided_at = null
       returning id`,
      [ctx.org.id, ctx.run.id, ctx.step.id, params.summary],
    );
    await notify(ctx.sql, ctx.org.id, {
      kind: "approval",
      title: "Approvazione richiesta",
      body: params.summary,
      link: APP_LINKS.approvals(),
    });
    return {
      type: "wait",
      waitingFor: "approval",
      until: new Date(ctx.now.getTime() + parseDuration(params.timeout)),
      job: "wait_timeout",
      output: { approvalId: rows[0]!.id },
    };
  },
  async simulate(_ctx, params) {
    return next(
      { simulated: true, approvalId: null, decision: "approved", summary: params.summary },
      "onApproved",
    );
  },
};

/**
 * Gives the conversation to a person: from now on inbound messages start no automation,
 * and other runs waiting for a reply on it are cancelled.
 */
export async function handoffConversation(ctx: StepContext, note?: string): Promise<string | null> {
  const sql: Sql = ctx.sql;
  const rows = await sql.query<ConversationRow>(
    `select * from ia_connect.conversations
     where organization_id = $1 and (id = $2::uuid or ($2::uuid is null and contact_id = $3::uuid))
     order by last_message_at desc nulls last limit 1`,
    [ctx.org.id, ctx.run.conversation_id, ctx.run.contact_id],
  );
  const conversation = rows[0];
  if (conversation) {
    await sql.query(
      "update ia_connect.conversations set assignee_type = 'user', status = 'open' where id = $1 and organization_id = $2",
      [conversation.id, ctx.org.id],
    );
    const cancelled = await sql.query<{ id: string }>(
      `update ia_connect.flow_runs set status = 'cancelled', finished_at = $3::timestamptz, waiting_for = null,
         error = 'Conversazione passata a un operatore.'
       where conversation_id = $1 and organization_id = $4 and id <> $2
         and status = 'waiting' and waiting_for = 'reply' returning id`,
      [conversation.id, ctx.run.id, ctx.now.toISOString(), ctx.org.id],
    );
    for (const run of cancelled) {
      await sql.query(
        "update ia_connect.scheduled_jobs set status = 'cancelled' where flow_run_id = $1 and organization_id = $2 and status = 'pending'",
        [run.id, ctx.org.id],
      );
    }
    await audit(
      sql,
      ctx.org.id,
      "conversation.handoff",
      { type: "conversation", id: conversation.id },
      {
        flow_run_id: ctx.run.id,
      },
    );
  }
  await notify(sql, ctx.org.id, {
    kind: "handoff",
    title: "Conversazione da prendere in carico",
    body: note?.trim() || "Un contatto attende la risposta di una persona.",
    link: conversation ? APP_LINKS.conversation(conversation.id) : APP_LINKS.inbox(),
  });
  return conversation?.id ?? null;
}

export const handoff: Executor<{ note?: string }> = {
  async run(ctx, params) {
    const conversationId = await handoffConversation(ctx, params.note);
    return next({ conversationId });
  },
  async simulate(_ctx, params) {
    return next({ simulated: true, note: params.note ?? null });
  },
};

interface NotifyParams {
  message: string;
  via: "app" | "whatsapp" | "mail";
}

/** Best effort: the notification in the app is what counts, the copy on a channel may fail. */
async function sendToOwner(
  ctx: StepContext,
  params: NotifyParams,
): Promise<{ sent: boolean; reason?: string }> {
  const { brand } = await getSettings(ctx.sql, ctx.org.id);
  const channel = params.via === "whatsapp" ? "whatsapp" : "mail";
  const address = channel === "whatsapp" ? brand.ownerPhone : brand.ownerEmail;
  if (typeof address !== "string" || !address) {
    return { sent: false, reason: "Recapito del titolare non configurato: avviso solo nell'applicazione." };
  }
  let consumed = false;
  try {
    const action = channel === "whatsapp" ? "sendText" : "send";
    const connection = await resolveConnection(ctx.sql, ctx.org.id, channel, null, null, (row) =>
      offersAction(ctx.deps, row, action),
    );
    const to = overrideRecipient(ctx.deps.config, channel, address);
    consumed = await consumeQuota(ctx.sql, ctx.org.id, "messages");
    if (!consumed)
      return { sent: false, reason: "Messaggi del mese esauriti: avviso solo nell'applicazione." };
    const input =
      channel === "whatsapp"
        ? { to, text: params.message }
        : { to, subject: `Avviso da ${ctx.org.name}`, text: params.message };
    SendResultSchema.parse(await runAction(ctx.deps, connection, action, input));
    return { sent: true };
  } catch (error) {
    if (consumed) await addUsage(ctx.sql, ctx.org.id, "messages", -1).catch(() => undefined);
    return { sent: false, reason: errorMessage(error) };
  }
}

export const notifyOwner: Executor<NotifyParams> = {
  external: (params) => params.via !== "app",
  async run(ctx, params) {
    const delivery = params.via === "app" ? undefined : await sendToOwner(ctx, params);
    const notificationId = await notify(ctx.sql, ctx.org.id, {
      kind: "flow",
      title: "Avviso dal flusso",
      body: params.message,
    });
    return next({ notificationId, ...(delivery ? { via: params.via, ...delivery } : {}) });
  },
  async simulate(_ctx, params) {
    return next({ simulated: true, notificationId: null, message: params.message, via: params.via });
  },
};
