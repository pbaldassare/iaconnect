import {
  type AiTool,
  type AiUsage,
  type Channel,
  CrmReadOutput,
  type ExtractField,
  creditsFor,
  parseDuration,
} from "@ia-connect/core";
import { offersAction, runAction } from "../../connectors.ts";
import { addUsage, getContact, getSettings, quotaLeft, resolveConnection } from "../../db/repo.ts";
import { StepError } from "../../errors.ts";
import { sendFromFlow } from "../send.ts";
import { type Executor, type StepContext, type StepResult, next } from "../types.ts";
import { SIMULATED_REPLY } from "./logic.ts";
import { handoffConversation } from "./people.ts";

/**
 * Every AI call goes through here: quota check before, `ai_calls` row and credits after.
 * Runs in simulation too, because a simulated AI step still calls (and pays for) the model.
 */
export async function metered<T extends { usage: AiUsage }>(
  ctx: StepContext,
  call: () => Promise<T>,
): Promise<T> {
  const left = await quotaLeft(ctx.sql, ctx.org.id, "ai_credits");
  if (left !== null && left <= 0) {
    throw new StepError("I crediti IA del mese previsti dal piano sono esauriti.", "quota");
  }
  const result = await call();
  const credits = creditsFor(result.usage);
  await ctx.sql.query(
    `insert into ia_connect.ai_calls
       (organization_id, purpose, model, input_tokens, output_tokens, cost_micros, credits, flow_run_id, flow_run_step_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      ctx.org.id,
      ctx.block.key,
      result.usage.model,
      result.usage.inputTokens,
      result.usage.outputTokens,
      Math.round(result.usage.costMicros),
      credits,
      ctx.run.id,
      ctx.stepRowId,
    ],
  );
  await addUsage(ctx.sql, ctx.org.id, "ai_credits", credits);
  ctx.meter.aiCostMicros += Math.round(result.usage.costMicros);
  return result;
}

export const extract: Executor<{ text: string; fields: ExtractField[]; instructions?: string }> = {
  async run(ctx, params) {
    const result = await metered(ctx, () => ctx.deps.ai.extract(params));
    return next({ data: result.data, missing: result.missing });
  },
};

export const classify: Executor<{ text: string; categories: { key: string; description?: string }[] }> = {
  async run(ctx, params) {
    const result = await metered(ctx, () => ctx.deps.ai.classify(params));
    return next({ category: result.category });
  },
};

export const summarize: Executor<{ text: string; maxWords: number }> = {
  async run(ctx, params) {
    const result = await metered(ctx, () => ctx.deps.ai.summarize(params));
    return next({ summary: result.summary });
  },
};

interface ReplyParams {
  scope: string;
  maxTurns: number;
  idleTimeout: string;
  readResources: { connection?: string; resource: string; description: string }[];
  channel?: Channel;
}
type History = { role: "contact" | "business"; content: string }[];

async function findConversation(ctx: StepContext, params: ReplyParams) {
  const rows = await ctx.sql.query<{ id: string; channel: Channel }>(
    `select id, channel from ia_connect.conversations
     where organization_id = $1 and (id = $2::uuid or ($2::uuid is null and contact_id = $3::uuid))
       and ($4::text is null or channel = $4::text)
     order by last_message_at desc nulls last limit 1`,
    [ctx.org.id, ctx.run.conversation_id, ctx.run.contact_id, params.channel ?? null],
  );
  return rows[0];
}

/** Oldest first. Inbound text is passed as data in `history`, never merged into instructions. */
async function loadHistory(ctx: StepContext, conversationId: string): Promise<History> {
  const rows = await ctx.sql.query<{ direction: string; content: string }>(
    `select direction, content from (
       select direction, content, created_at from ia_connect.messages
       where conversation_id = $1 and content <> '' order by created_at desc limit 30
     ) recent order by created_at`,
    [conversationId],
  );
  return rows.map((row) => ({ role: row.direction === "in" ? "contact" : "business", content: row.content }));
}

/** Read-only tools: each one reads a single CRM resource named by the flow. Nothing else is granted. */
function buildTools(ctx: StepContext, params: ReplyParams): AiTool[] {
  return params.readResources.map((item, index) => ({
    name: `read_${item.resource.replace(/[^a-zA-Z0-9_]/g, "_")}_${index + 1}`,
    description: item.description,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "object", description: 'Filtri di ricerca, ad esempio { "orderNumber": "123" }' },
      },
    },
    async run(input) {
      if (ctx.simulation) return { records: [], note: "Simulazione: il gestionale non viene letto." };
      const connection = await resolveConnection(ctx.sql, ctx.org.id, "crm", item.connection, null, (row) =>
        offersAction(ctx.deps, row, "read"),
      );
      const query = input.query && typeof input.query === "object" ? input.query : {};
      return CrmReadOutput.parse(
        await runAction(ctx.deps, connection, "read", { resource: item.resource, query }),
      );
    },
  }));
}

async function generate(ctx: StepContext, params: ReplyParams, history: History, turn: number) {
  const settings = await getSettings(ctx.sql, ctx.org.id);
  const contact = ctx.run.contact_id ? await getContact(ctx.sql, ctx.org.id, ctx.run.contact_id) : undefined;
  const result = await metered(ctx, () =>
    ctx.deps.ai.reply({
      scope: params.scope,
      organizationName: ctx.org.name,
      tone: settings.ai_tone ?? undefined,
      instructions: settings.ai_instructions ?? undefined,
      history,
      tools: buildTools(ctx, params),
      contactMemory: contact?.memory || undefined,
      turn,
      maxTurns: params.maxTurns,
    }),
  );
  // Out of scope: the organization's standard sentence, not text written by the model.
  const outOfScope = result.outcome === "out_of_scope";
  return { result, text: outOfScope ? settings.out_of_scope_reply : result.text, outOfScope };
}

export const reply: Executor<ReplyParams> = {
  async run(ctx, params): Promise<StepResult> {
    const previous = ctx.state.steps[ctx.step.id]?.output ?? {};
    const turns = Number(previous.turns ?? 0);
    if (ctx.signal?.kind === "timeout") {
      return next({ turns, outcome: "timeout", lastReply: previous.lastReply ?? null }, "onTimeout");
    }
    const conversation = await findConversation(ctx, params);
    if (!conversation) {
      throw new StepError("Non c'è una conversazione con il contatto a cui rispondere.", "conversation");
    }
    ctx.run.conversation_id = conversation.id;
    const idleUntil = new Date(ctx.now.getTime() + parseDuration(params.idleTimeout));
    const history = await loadHistory(ctx, conversation.id);
    if (history.at(-1)?.role !== "contact") {
      // Nothing to answer yet: wait for the contact's first message.
      return { type: "wait", waitingFor: "reply", until: idleUntil, job: "wait_timeout", output: previous };
    }

    const turn = turns + 1;
    const { result, text, outOfScope } = await generate(ctx, params, history, turn);
    if (text.trim()) {
      await sendFromFlow(ctx, {
        channel: conversation.channel,
        text,
        subject: conversation.channel === "mail" ? `Risposta da ${ctx.org.name}` : undefined,
        aiGenerated: !outOfScope,
        aiModel: result.usage.model,
      });
    }
    const output = { turns: turn, outcome: result.outcome as string, lastReply: text };
    if (result.outcome === "done") return next(output);
    if (result.outcome === "continue" && turn < params.maxTurns) {
      return {
        type: "wait",
        waitingFor: "reply",
        until: idleUntil,
        job: "wait_timeout",
        output,
        repeat: true,
      };
    }
    const reason =
      result.outcome === "continue"
        ? `Raggiunto il limite di ${params.maxTurns} risposte automatiche.`
        : outOfScope
          ? "Richiesta fuori dall'ambito dell'assistente."
          : "Il contatto ha bisogno di una persona.";
    await handoffConversation(ctx, reason);
    return next({ ...output, outcome: outOfScope ? "out_of_scope" : "handoff", reason }, "onHandoff");
  },

  /** One reply is generated (and metered) but not sent; nothing waits. */
  async simulate(ctx, params) {
    const conversation = await findConversation(ctx, params);
    const history = conversation ? await loadHistory(ctx, conversation.id) : [];
    if (history.at(-1)?.role !== "contact") {
      const inbound = ctx.state.reply?.text ?? ctx.state.event.payload.text;
      history.push({
        role: "contact",
        content: typeof inbound === "string" && inbound ? inbound : SIMULATED_REPLY,
      });
    }
    const { result, text, outOfScope } = await generate(ctx, params, history, 1);
    const output = { simulated: true, turns: 1, outcome: result.outcome as string, lastReply: text };
    return result.outcome === "handoff" || outOfScope ? next(output, "onHandoff") : next(output);
  },
};
