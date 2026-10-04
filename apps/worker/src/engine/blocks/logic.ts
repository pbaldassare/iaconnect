import { type FilterOperator, evaluateFilter, parseDuration } from "@ia-connect/core";
import { getPath } from "@ia-connect/core";
import { iso, json } from "../../db/sql.ts";
import { type Executor, next } from "../types.ts";

/** Reply used by simulations, where nobody actually answers. */
export const SIMULATED_REPLY = "(risposta di prova del contatto)";

const sameText = (left: unknown, right: unknown) =>
  String(left ?? "").toLowerCase() === String(right ?? "").toLowerCase();

export const condition: Executor<{ left: unknown; operator: FilterOperator; right?: unknown }> = {
  async run(_ctx, params) {
    const result = evaluateFilter(
      { field: "left", operator: params.operator, value: params.right },
      params.left,
    );
    return next({ result }, result ? "onTrue" : "onFalse");
  },
};

export const switchBlock: Executor<{
  value: unknown;
  cases: { equals: unknown; goto: string }[];
  default?: string;
}> = {
  async run(_ctx, params) {
    const hit = params.cases.find((item) => sameText(item.equals, params.value));
    return {
      type: "next",
      outlet: "next",
      output: { matched: hit ? hit.equals : null },
      goto: hit?.goto ?? params.default,
    };
  },
};

interface ForEachParams {
  items: unknown;
  emitEvent: string;
  payload: Record<string, unknown>;
  limit: number;
}

function listItems(params: ForEachParams): unknown[] {
  return (Array.isArray(params.items) ? params.items : []).slice(0, params.limit);
}

export const forEach: Executor<ForEachParams> = {
  async run(ctx, params) {
    const items = listItems(params);
    let emitted = 0;
    for (const [index, item] of items.entries()) {
      // Deterministic key: executing the step again cannot emit an item twice.
      const rows = await ctx.sql.query(
        `insert into ia_connect.events (organization_id, type, payload, dedupe_key, occurred_at, available_at)
         values ($1, $2, $3::jsonb, $4, $5::timestamptz, $5::timestamptz)
         on conflict (organization_id, dedupe_key) do nothing returning id`,
        [
          ctx.org.id,
          params.emitEvent,
          json({ ...params.payload, item }),
          `${ctx.run.id}:${ctx.step.id}:${index}`,
          iso(ctx.now),
        ],
      );
      emitted += rows.length;
    }
    return next({ emitted, total: items.length });
  },
  async simulate(_ctx, params) {
    const items = listItems(params);
    return next({
      simulated: true,
      emitted: items.length,
      event: params.emitEvent,
      sample: items.slice(0, 3),
    });
  },
};

export const delay: Executor<{ duration: string }> = {
  async run(ctx, params) {
    if (ctx.signal?.kind === "timer") return next({});
    const until = new Date(ctx.now.getTime() + parseDuration(params.duration));
    return { type: "wait", waitingFor: "timer", until, job: "resume_run" };
  },
  async simulate(_ctx, params) {
    return next({ simulated: true, skipped: params.duration });
  },
};

export const forReply: Executor<{ timeout: string; channel?: string }> = {
  async run(ctx, params) {
    if (ctx.signal?.kind === "reply") {
      return next({ text: ctx.signal.text, messageId: ctx.signal.messageId }, "onReply");
    }
    if (ctx.signal?.kind === "timeout") return next({ text: null, messageId: null }, "onTimeout");
    const until = new Date(ctx.now.getTime() + parseDuration(params.timeout));
    return { type: "wait", waitingFor: "reply", until, job: "wait_timeout" };
  },
  async simulate(ctx) {
    // Waits do not wait in a simulation: the contact "answers" at once.
    const text = String(getPath(ctx.state, "reply.text") ?? SIMULATED_REPLY);
    ctx.state.reply = { text, messageId: null };
    return next({ simulated: true, text, messageId: null }, "onReply");
  },
};
