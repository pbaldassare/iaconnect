import { offersAction, runAction } from "../../connectors.ts";
import { audit, resolveConnection } from "../../db/repo.ts";
import { StepError } from "../../errors.ts";
import { type FlowMessage, previewFromFlow, sendFromFlow } from "../send.ts";
import { type Executor, type StepContext, next } from "../types.ts";

/** A channel block is the same executor around a different message. */
function sender<P>(build: (ctx: StepContext, params: P) => Promise<FlowMessage> | FlowMessage): Executor<P> {
  return {
    async run(ctx, params) {
      const sent = await sendFromFlow(ctx, await build(ctx, params));
      return next({ messageId: sent.messageId, externalId: sent.externalId, text: sent.text });
    },
    async simulate(ctx, params) {
      return next(await previewFromFlow(ctx, await build(ctx, params)));
    },
  };
}

interface TemplateParams {
  connection?: string;
  template: string;
  variables: Record<string, unknown>;
  to?: string;
}

export const whatsappSendTemplate = sender<TemplateParams>(async (ctx, params) => {
  const rows = await ctx.sql.query<{
    id: string;
    body: string;
    language: string;
    approval_status: string;
    external_name: string | null;
  }>(
    `select id, body, language, approval_status, external_name from ia_connect.message_templates
     where organization_id = $1 and channel = 'whatsapp' and name = $2`,
    [ctx.org.id, params.template],
  );
  const template = rows[0];
  if (!template) throw new StepError(`Il modello "${params.template}" non esiste.`, "template");
  if (template.approval_status !== "approved") {
    throw new StepError(`Il modello "${params.template}" non è ancora approvato.`, "template");
  }
  // { "1": "Mario", "2": "RC auto" } → ordered body variables.
  const variables = Object.keys(params.variables)
    .sort((a, b) => Number(a) - Number(b))
    .map((key) => String(params.variables[key] ?? ""));
  const text = template.body.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, index: string) =>
    String(params.variables[index] ?? ""),
  );
  return {
    channel: "whatsapp",
    text,
    to: params.to,
    connectionId: params.connection,
    template: {
      id: template.id,
      name: template.external_name ?? params.template,
      language: template.language,
      variables,
    },
  };
});

export const whatsappSendText = sender<{ connection?: string; text: string; to?: string }>(
  (_ctx, params) => ({
    channel: "whatsapp",
    text: params.text,
    to: params.to,
    connectionId: params.connection,
  }),
);

export const mailSend = sender<{ connection?: string; to?: string; subject: string; body: string }>(
  (_ctx, params) => ({
    channel: "mail",
    text: params.body,
    subject: params.subject,
    to: params.to,
    connectionId: params.connection,
  }),
);

export const smsSend = sender<{ connection?: string; text: string; to?: string }>((_ctx, params) => ({
  channel: "sms",
  text: params.text,
  to: params.to,
  connectionId: params.connection,
}));

export const socialSendMessage = sender<{ connection?: string; text: string; to?: string }>(
  (_ctx, params) => ({
    channel: "social",
    text: params.text,
    to: params.to,
    connectionId: params.connection,
  }),
);

export const socialPublishPost: Executor<{ connection?: string; text: string; mediaUrl?: string }> = {
  async run(ctx, params) {
    const connection = await resolveConnection(
      ctx.sql,
      ctx.org.id,
      "social",
      params.connection,
      null,
      (row) => offersAction(ctx.deps, row, "publishPost"),
    );
    const result = await runAction<Record<string, unknown>>(ctx.deps, connection, "publishPost", {
      text: params.text,
      mediaUrl: params.mediaUrl,
    });
    const postId = String(result?.externalId ?? result?.postId ?? result?.id ?? "");
    await audit(
      ctx.sql,
      ctx.org.id,
      "social.post_published",
      { type: "connection", id: connection.id },
      {
        flow_run_id: ctx.run.id,
      },
    );
    return next({ postId });
  },
  async simulate(_ctx, params) {
    return next({ simulated: true, postId: null, text: params.text, mediaUrl: params.mediaUrl ?? null });
  },
};
