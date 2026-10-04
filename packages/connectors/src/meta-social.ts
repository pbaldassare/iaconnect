import {
  type Connector,
  type ConnectorContext,
  ConnectorError,
  type NormalizedEventInput,
  type SendResult,
  SocialPublishPostInput,
  SocialReplyCommentInput,
  SocialSendMessageInput,
  normalizePhone,
} from "@ia-connect/core";
import { z } from "zod";
import { defineAction } from "./lib/actions.ts";
import {
  HEALTHY,
  healthFromError,
  parseInput,
  readJson,
  requireEnv,
  requireString,
  send,
} from "./lib/http.ts";
import {
  META_GRAPH_DEFAULT_VERSION,
  graphRequest,
  graphUrl,
  receiveMetaWebhook,
  verifyMetaSignature,
} from "./lib/meta.ts";
import { OAuthCallbackInput } from "./lib/schemas.ts";
import { type Json, asArray, asRecord, asString, compact, unique } from "./lib/values.ts";
import { UNVERIFIED, parseJson } from "./lib/webhook.ts";

const SERVICE = "Facebook e Instagram";
const SCOPES = [
  "pages_show_list",
  "pages_manage_metadata",
  "pages_messaging",
  "pages_read_engagement",
  "pages_manage_posts",
  "pages_manage_engagement",
  "leads_retrieval",
  "instagram_basic",
  "instagram_manage_messages",
  "instagram_manage_comments",
];
const PAGE_SUBSCRIBED_FIELDS = "leadgen,messages,feed";
/** Prefix that marks an Instagram comment id, so `replyComment` knows which endpoint to call. */
const INSTAGRAM_COMMENT_PREFIX = "ig:";

export const MetaSocialInput = OAuthCallbackInput.extend({
  pageId: z
    .string()
    .optional()
    .describe("Pagina Facebook da collegare (se l'account ne gestisce più di una)"),
});

interface PageAccess {
  pageId: string;
  token: string;
  instagramAccountId?: string;
}

function access(context: ConnectorContext): PageAccess {
  return {
    pageId: requireString(context.connection.config, "pageId", SERVICE),
    token: requireString(context.secrets, "pageAccessToken", SERVICE),
    instagramAccountId: asString(context.connection.config.instagramAccountId),
  };
}

async function exchangeToken(
  deps: { fetch: typeof fetch; env: Record<string, string | undefined> },
  form: Record<string, string>,
): Promise<string> {
  // POST keeps the app secret and the code out of URLs (and therefore out of access logs).
  const response = await send(deps.fetch, SERVICE, graphUrl(deps.env, "oauth/access_token"), {
    form: {
      client_id: requireEnv(deps.env, "META_APP_ID"),
      client_secret: requireEnv(deps.env, "META_APP_SECRET"),
      ...form,
    },
  });
  const token = asString(asRecord(await readJson(response)).access_token);
  if (!response.ok || !token) {
    throw new ConnectorError(`${SERVICE}: autorizzazione rifiutata, ripeti il collegamento`, {
      retryable: response.status === 429 || response.status >= 500,
      code: "oauth_exchange_failed",
      status: response.status,
    });
  }
  return token;
}

/** Page and Instagram account ids a webhook delivery is addressed to. */
export function metaSocialAccountIds(body: Json): string[] {
  if (body.object !== "page" && body.object !== "instagram") return [];
  return unique(
    asArray(body.entry)
      .map((entry) => asString(asRecord(entry).id) ?? "")
      .filter(Boolean),
  );
}

function leadFields(lead: Json): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const item of asArray(lead.field_data)) {
    const name = asString(asRecord(item).name);
    const value = asArray(asRecord(item).values).map(String).join(", ");
    if (name) fields[name] = value;
  }
  return fields;
}

async function leadEvent(
  context: ConnectorContext,
  page: PageAccess,
  value: Json,
): Promise<NormalizedEventInput | null> {
  const leadId = asString(value.leadgen_id);
  if (!leadId) return null;
  // The webhook only carries ids: the answers must be read with the page token.
  const lead = await graphRequest(context, SERVICE, page.token, leadId, {
    query: { fields: "id,created_time,form_id,field_data" },
  });
  const formId = asString(lead.form_id) ?? asString(value.form_id);
  let formName = formId ?? "";
  if (formId) {
    try {
      formName =
        asString(
          (await graphRequest(context, SERVICE, page.token, formId, { query: { fields: "name" } })).name,
        ) ?? formId;
    } catch {
      // The form name is a nicety: the lead is not lost when it cannot be read.
    }
  }
  const fields = leadFields(lead);
  const name =
    fields.full_name ?? ([fields.first_name, fields.last_name].filter(Boolean).join(" ") || undefined);
  const rawPhone = fields.phone_number ?? fields.phone;
  const phone = rawPhone ? (normalizePhone(rawPhone) ?? undefined) : undefined;
  const email = fields.email;
  const created = asString(lead.created_time);
  const createdMs = created ? Date.parse(created) : Number.NaN;
  return {
    type: "social.lead.received",
    occurredAt: Number.isNaN(createdMs) ? undefined : new Date(createdMs).toISOString(),
    dedupeKey: `meta_social:lead:${leadId}`,
    payload: compact({
      name: name ?? "",
      phone,
      email,
      formName,
      fields,
      platform: "facebook",
      leadId,
      formId,
    }),
    contact: compact({ name, phone, email }),
  };
}

function messageEvents(entry: Json, page: PageAccess, platform: string): NormalizedEventInput[] {
  const events: NormalizedEventInput[] = [];
  for (const item of asArray(entry.messaging)) {
    const messaging = asRecord(item);
    const message = asRecord(messaging.message);
    const mid = asString(message.mid);
    const sender = asString(asRecord(messaging.sender).id);
    // Echoes are our own outgoing messages.
    if (!mid || !sender || message.is_echo === true) continue;
    if (sender === page.pageId || sender === page.instagramAccountId) continue;
    const timestamp = Number(messaging.timestamp);
    events.push({
      type: "social.message.received",
      occurredAt: Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp).toISOString() : undefined,
      dedupeKey: `meta_social:msg:${mid}`,
      payload: { from: sender, text: asString(message.text) ?? "", messageId: mid, platform },
    });
  }
  return events;
}

function commentEvent(change: Json, page: PageAccess, platform: string): NormalizedEventInput | null {
  const value = asRecord(change.value);
  const from = asRecord(value.from);
  const fromId = asString(from.id);
  if (platform === "instagram") {
    const id = asString(value.id);
    if (change.field !== "comments" || !id || !fromId || fromId === page.instagramAccountId) return null;
    return {
      type: "social.comment.received",
      dedupeKey: `meta_social:comment:ig:${id}`,
      payload: compact({
        from: fromId,
        fromName: asString(from.username),
        text: asString(value.text) ?? "",
        commentId: `${INSTAGRAM_COMMENT_PREFIX}${id}`,
        postId: asString(asRecord(value.media).id) ?? "",
        platform,
      }),
    };
  }
  const id = asString(value.comment_id);
  if (change.field !== "feed" || value.item !== "comment" || value.verb !== "add") return null;
  if (!id || !fromId || fromId === page.pageId) return null;
  const created = Number(value.created_time);
  return {
    type: "social.comment.received",
    occurredAt: Number.isFinite(created) && created > 0 ? new Date(created * 1000).toISOString() : undefined,
    dedupeKey: `meta_social:comment:fb:${id}`,
    payload: compact({
      from: fromId,
      fromName: asString(from.name),
      text: asString(value.message) ?? "",
      commentId: id,
      postId: asString(value.post_id) ?? "",
      platform,
    }),
  };
}

export const metaSocialConnector: Connector = {
  key: "meta_social",
  category: "social",
  name: "Facebook e Instagram",
  description: "Contatti dai moduli, messaggi, commenti e post.",
  connectMode: "oauth",
  inputSchema: MetaSocialInput,
  emits: ["social.lead.received", "social.message.received", "social.comment.received"],

  startOAuth(input) {
    const version = input.env.META_GRAPH_VERSION || META_GRAPH_DEFAULT_VERSION;
    const url = new URL(`https://www.facebook.com/${version}/dialog/oauth`);
    url.search = new URLSearchParams({
      client_id: requireEnv(input.env, "META_APP_ID"),
      redirect_uri: input.redirectUri,
      response_type: "code",
      scope: SCOPES.join(","),
      state: input.state,
    }).toString();
    return { authorizationUrl: url.toString() };
  },

  async connect(input, deps) {
    const { code, redirectUri, pageId: wantedPageId } = parseInput(MetaSocialInput, input);
    const shortLived = await exchangeToken(deps, { code, redirect_uri: redirectUri });
    // Page tokens derived from a long-lived user token do not expire.
    const userToken = await exchangeToken(deps, {
      grant_type: "fb_exchange_token",
      fb_exchange_token: shortLived,
    });
    const accounts = await graphRequest(deps, SERVICE, userToken, "me/accounts", {
      query: { fields: "id,name,access_token,instagram_business_account", limit: "100" },
    });
    const pages = asArray(accounts.data).map(asRecord);
    const page = wantedPageId ? pages.find((item) => asString(item.id) === wantedPageId) : pages[0];
    const pageId = asString(page?.id);
    const pageAccessToken = asString(page?.access_token);
    if (!page || !pageId || !pageAccessToken) {
      throw new ConnectorError(`${SERVICE}: nessuna pagina Facebook disponibile per questo account`, {
        retryable: false,
        code: "no_page",
      });
    }
    await graphRequest(deps, SERVICE, pageAccessToken, `${pageId}/subscribed_apps`, {
      form: { subscribed_fields: PAGE_SUBSCRIBED_FIELDS },
    });
    const instagramAccountId = asString(asRecord(page.instagram_business_account).id);
    return {
      config: compact({
        pageId,
        pageName: asString(page.name),
        instagramAccountId,
        // Instagram deliveries are addressed to the Instagram account id, not to the page id.
        accountAliases: instagramAccountId ? [instagramAccountId] : undefined,
        availablePages: pages.map((item) => ({ id: asString(item.id), name: asString(item.name) })),
      }),
      secrets: { pageAccessToken },
      externalAccountId: pageId,
    };
  },

  async verify(context) {
    try {
      const page = access(context);
      await graphRequest(context, SERVICE, page.token, page.pageId, { query: { fields: "id" } });
      return HEALTHY;
    } catch (error) {
      return healthFromError(error);
    }
  },

  receiveProviderWebhook(request, env) {
    return receiveMetaWebhook(request, env, metaSocialAccountIds);
  },

  async handleWebhook(context, request) {
    if (request.method.toUpperCase() !== "POST") return UNVERIFIED;
    if (!(await verifyMetaSignature(request, context.env))) return UNVERIFIED;
    const body = asRecord(parseJson(request.rawBody));
    const page = access(context);
    const platform = body.object === "instagram" ? "instagram" : "facebook";
    const events: NormalizedEventInput[] = [];
    if (body.object !== "page" && body.object !== "instagram") return { verified: true, events };

    for (const item of asArray(body.entry)) {
      const entry = asRecord(item);
      const entryId = asString(entry.id);
      if (entryId !== page.pageId && entryId !== page.instagramAccountId) continue;
      events.push(...messageEvents(entry, page, platform));
      for (const changeItem of asArray(entry.changes)) {
        const change = asRecord(changeItem);
        if (platform === "facebook" && change.field === "leadgen") {
          const lead = await leadEvent(context, page, asRecord(change.value));
          if (lead) events.push(lead);
          continue;
        }
        const comment = commentEvent(change, page, platform);
        if (comment) events.push(comment);
      }
    }
    return { verified: true, events };
  },

  actions: {
    sendMessage: defineAction({
      key: "sendMessage",
      title: "Invia un messaggio su Messenger o Instagram",
      input: SocialSendMessageInput,
      async execute(context, input): Promise<SendResult> {
        const page = access(context);
        const result = await graphRequest(context, SERVICE, page.token, `${page.pageId}/messages`, {
          json: { recipient: { id: input.to }, messaging_type: "RESPONSE", message: { text: input.text } },
        });
        return { externalId: asString(result.message_id) ?? "", status: "sent" };
      },
    }),
    publishPost: defineAction({
      key: "publishPost",
      title: "Pubblica un post sulla pagina Facebook",
      input: SocialPublishPostInput,
      async execute(context, input): Promise<SendResult> {
        const page = access(context);
        const result = input.mediaUrl
          ? await graphRequest(context, SERVICE, page.token, `${page.pageId}/photos`, {
              json: { url: input.mediaUrl, caption: input.text },
            })
          : await graphRequest(context, SERVICE, page.token, `${page.pageId}/feed`, {
              json: { message: input.text },
            });
        return { externalId: asString(result.post_id) ?? asString(result.id) ?? "", status: "sent" };
      },
    }),
    replyComment: defineAction({
      key: "replyComment",
      title: "Rispondi a un commento",
      input: SocialReplyCommentInput,
      async execute(context, input): Promise<SendResult> {
        const page = access(context);
        const instagram = input.commentId.startsWith(INSTAGRAM_COMMENT_PREFIX);
        const path = instagram
          ? `${encodeURIComponent(input.commentId.slice(INSTAGRAM_COMMENT_PREFIX.length))}/replies`
          : `${encodeURIComponent(input.commentId)}/comments`;
        const result = await graphRequest(context, SERVICE, page.token, path, {
          json: { message: input.text },
        });
        return { externalId: asString(result.id) ?? "", status: "sent" };
      },
    }),
  },

  async disconnect(context) {
    try {
      const page = access(context);
      await graphRequest(context, SERVICE, page.token, `${page.pageId}/subscribed_apps`, {
        method: "DELETE",
      });
    } catch {
      // Best effort: the customer can also remove the app from the page settings.
    }
  },
};
