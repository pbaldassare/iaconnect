/**
 * GoHighLevel sub-account bridge (LeadConnector API v2).
 *
 * NOT VERIFIED against a live account: paths, the API version header and the body
 * fields below come from the public documentation as we remember it. Everything
 * provider-specific is in `GHL` and in the mapping functions of this file.
 */
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
import { randomHex, timingSafeEqual } from "./lib/crypto.ts";
import {
  HEALTHY,
  type HttpOptions,
  healthFromError,
  parseInput,
  requestJson,
  requireString,
} from "./lib/http.ts";
import { type Json, asRecord, asString, compact } from "./lib/values.ts";
import { UNVERIFIED, header, parseJson } from "./lib/webhook.ts";

const SERVICE = "GoHighLevel";

/** Assumed LeadConnector API v2 mapping. Check against a real sub-account before use. */
export const GHL = {
  baseUrl: "https://services.leadconnectorhq.com",
  versionHeader: "Version",
  version: "2021-07-28",
  /** Header our webhook expects, set in the GoHighLevel workflow "Webhook" action. */
  webhookSecretHeader: "x-ia-webhook-secret",
  /** GET → { location } */
  location: (locationId: string) => `/locations/${encodeURIComponent(locationId)}`,
  /** POST { type, contactId, message, replyMessageId? } → { messageId } */
  sendMessage: () => "/conversations/messages",
  /** POST { accountIds, summary, media, type, userId } → { results: { post: { _id } } } */
  createPost: (locationId: string) => `/social-media-posting/${encodeURIComponent(locationId)}/posts`,
  /** Conversation message types per platform. */
  messageTypes: { facebook: "FB", instagram: "IG" } as Record<string, string>,
  /** Inbound webhook `type` values we understand. */
  events: { message: "InboundMessage", contact: "ContactCreate", comment: "comment" },
} as const;

export const GhlSocialInput = z.object({
  privateToken: z.string().min(1).describe("Token dell'integrazione privata (Private Integration Token)"),
  locationId: z.string().min(1).describe("ID del sotto-account (Location ID)"),
  socialAccountIds: z
    .array(z.string())
    .default([])
    .describe("ID degli account social su cui pubblicare i post"),
  userId: z.string().optional().describe("ID dell'utente GoHighLevel a nome del quale pubblicare"),
});

function call(
  context: { fetch: typeof fetch },
  token: string,
  path: string,
  options: HttpOptions = {},
): Promise<Json> {
  return requestJson(context.fetch, SERVICE, `${GHL.baseUrl}${path}`, {
    ...options,
    headers: { ...options.headers, authorization: `Bearer ${token}`, [GHL.versionHeader]: GHL.version },
  });
}

function platformOf(messageType: unknown): string | undefined {
  const type = asString(messageType)?.toUpperCase() ?? "";
  if (type.includes("FB") || type.includes("FACEBOOK")) return "facebook";
  if (type.includes("IG") || type.includes("INSTAGRAM")) return "instagram";
  return undefined;
}

function sendConversationMessage(
  context: ConnectorContext,
  body: { platform?: string; contactId: string; text: string; replyMessageId?: string },
): Promise<Json> {
  const type = GHL.messageTypes[body.platform ?? "facebook"];
  if (!type) {
    throw new ConnectorError(`${SERVICE}: piattaforma non supportata`, {
      retryable: false,
      code: "unsupported",
    });
  }
  return call(context, requireString(context.secrets, "privateToken", SERVICE), GHL.sendMessage(), {
    json: compact({
      type,
      contactId: body.contactId,
      message: body.text,
      replyMessageId: body.replyMessageId,
    }),
  });
}

/** Maps the assumed GoHighLevel webhook body to normalized events. */
export function normalizeGhlWebhook(body: Json, locationId: string): NormalizedEventInput[] {
  const bodyLocation = asString(body.locationId);
  if (bodyLocation && bodyLocation !== locationId) return [];
  const contactId = asString(body.contactId) ?? asString(body.id);

  if (body.type === GHL.events.message) {
    const platform = platformOf(body.messageType);
    const messageId = asString(body.messageId);
    // Other channels of the sub-account (SMS, mail, calls) are not ours to handle.
    if (!platform || !messageId || !contactId || body.direction === "outbound") return [];
    return [
      {
        type: "social.message.received",
        occurredAt: toIso(body.dateAdded),
        dedupeKey: `ghl_social:msg:${messageId}`,
        payload: compact({
          from: contactId,
          fromName: asString(body.contactName),
          text: asString(body.body) ?? "",
          messageId,
          platform,
        }),
      },
    ];
  }

  if (body.type === GHL.events.contact) {
    if (!contactId) return [];
    const name =
      asString(body.name) ??
      ([asString(body.firstName), asString(body.lastName)].filter(Boolean).join(" ") || undefined);
    const rawPhone = asString(body.phone);
    const phone = rawPhone ? (normalizePhone(rawPhone) ?? undefined) : undefined;
    const email = asString(body.email);
    return [
      {
        type: "social.lead.received",
        occurredAt: toIso(body.dateAdded),
        dedupeKey: `ghl_social:lead:${contactId}`,
        payload: compact({
          name: name ?? "",
          phone,
          email,
          formName: asString(body.source) ?? "GoHighLevel",
          fields: asRecord(body.customFields),
          platform: "gohighlevel",
          contactId,
        }),
        contact: compact({ name, phone, email }),
      },
    ];
  }

  if (body.type === GHL.events.comment) {
    const messageId = asString(body.messageId);
    if (!messageId || !contactId) return [];
    return [
      {
        type: "social.comment.received",
        occurredAt: toIso(body.dateAdded),
        dedupeKey: `ghl_social:comment:${messageId}`,
        payload: compact({
          from: contactId,
          fromName: asString(body.contactName),
          text: asString(body.body) ?? "",
          // The reply needs both ids: they travel together in the comment id.
          commentId: `${platformOf(body.messageType) ?? "facebook"}:${contactId}:${messageId}`,
          postId: asString(body.postId) ?? "",
          platform: platformOf(body.messageType) ?? "facebook",
        }),
      },
    ];
  }
  return [];
}

function toIso(value: unknown): string | undefined {
  const ms = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

export const ghlSocialConnector: Connector = {
  key: "ghl_social",
  category: "social",
  name: "GoHighLevel",
  description: "Usa un sotto-account GoHighLevel come ponte verso i social.",
  connectMode: "api_key",
  inputSchema: GhlSocialInput,
  emits: ["social.lead.received", "social.message.received", "social.comment.received"],

  async connect(input, deps) {
    const { privateToken, ...config } = parseInput(GhlSocialInput, input);
    const result = await call(deps, privateToken, GHL.location(config.locationId));
    return {
      config: compact({ ...config, locationName: asString(asRecord(result.location).name) }),
      // The webhook secret is shown once by the caller of `connect`, to be pasted in the workflow.
      secrets: { privateToken, webhookSecret: randomHex(32) },
      externalAccountId: config.locationId,
    };
  },

  async verify(context) {
    try {
      const token = requireString(context.secrets, "privateToken", SERVICE);
      await call(
        context,
        token,
        GHL.location(requireString(context.connection.config, "locationId", SERVICE)),
      );
      return HEALTHY;
    } catch (error) {
      return healthFromError(error);
    }
  },

  async handleWebhook(context, request) {
    const secret = asString(context.secrets.webhookSecret);
    const provided = header(request, GHL.webhookSecretHeader);
    if (
      request.method.toUpperCase() !== "POST" ||
      !secret ||
      !provided ||
      !timingSafeEqual(secret, provided)
    ) {
      return UNVERIFIED;
    }
    const locationId = asString(context.connection.config.locationId) ?? "";
    return { verified: true, events: normalizeGhlWebhook(asRecord(parseJson(request.rawBody)), locationId) };
  },

  actions: {
    sendMessage: defineAction({
      key: "sendMessage",
      title: "Invia un messaggio social tramite GoHighLevel",
      input: SocialSendMessageInput,
      async execute(context, input): Promise<SendResult> {
        const result = await sendConversationMessage(context, {
          platform: input.platform,
          contactId: input.to,
          text: input.text,
        });
        return { externalId: asString(result.messageId) ?? "", status: "sent" };
      },
    }),
    publishPost: defineAction({
      key: "publishPost",
      title: "Pubblica un post tramite GoHighLevel",
      input: SocialPublishPostInput,
      async execute(context, input): Promise<SendResult> {
        const { config } = context.connection;
        const locationId = requireString(config, "locationId", SERVICE);
        const accountIds = Array.isArray(config.socialAccountIds) ? config.socialAccountIds.map(String) : [];
        if (accountIds.length === 0) {
          throw new ConnectorError(`${SERVICE}: nessun account social configurato per la pubblicazione`, {
            retryable: false,
            code: "invalid_connection",
          });
        }
        const result = await call(
          context,
          requireString(context.secrets, "privateToken", SERVICE),
          GHL.createPost(locationId),
          {
            json: compact({
              accountIds,
              summary: input.text,
              media: input.mediaUrl ? [{ url: input.mediaUrl }] : [],
              type: "post",
              status: "published",
              userId: asString(config.userId),
            }),
          },
        );
        const post = asRecord(asRecord(result.results).post);
        return { externalId: asString(post._id) ?? asString(result.id) ?? "", status: "queued" };
      },
    }),
    replyComment: defineAction({
      key: "replyComment",
      title: "Rispondi a un commento tramite GoHighLevel",
      input: SocialReplyCommentInput,
      async execute(context, input): Promise<SendResult> {
        const [platform, contactId, ...rest] = input.commentId.split(":");
        const replyMessageId = rest.join(":");
        if (!platform || !contactId || !replyMessageId) {
          throw new ConnectorError(`${SERVICE}: identificativo del commento non valido`, {
            retryable: false,
            code: "invalid_input",
          });
        }
        const result = await sendConversationMessage(context, {
          platform,
          contactId,
          text: input.text,
          replyMessageId,
        });
        return { externalId: asString(result.messageId) ?? "", status: "sent" };
      },
    }),
  },

  async disconnect() {
    // The private integration token is revoked from GoHighLevel; nothing to call here.
  },
};
