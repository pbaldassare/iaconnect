import {
  type Connector,
  type ConnectorContext,
  ConnectorError,
  MailSendInput,
  type NormalizedEventInput,
  type SendResult,
} from "@ia-connect/core";
import { defineAction } from "./lib/actions.ts";
import { base64DecodeToString } from "./lib/crypto.ts";
import { googleAuthorizationUrl, googleOAuth, revokeGoogleToken } from "./lib/google.ts";
import { HEALTHY, ensureOk, healthFromError, parseInput, requestJson, requireString } from "./lib/http.ts";
import { buildRawBase64Url, parseAddress } from "./lib/mime.ts";
import { authorizedJson, authorizedSend, exchangeCode } from "./lib/oauth.ts";
import { OAuthCallbackInput } from "./lib/schemas.ts";
import { type Json, asArray, asRecord, asString, compact, unique } from "./lib/values.ts";

const SERVICE = "Gmail";
const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const OAUTH = googleOAuth(SERVICE);
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
];
/** Upper bound of messages fetched per poll, to keep one run short. */
const MAX_MESSAGES_PER_POLL = 50;

function headerValue(headers: unknown[], name: string): string | undefined {
  const wanted = name.toLowerCase();
  for (const item of headers) {
    const record = asRecord(item);
    if (asString(record.name)?.toLowerCase() === wanted) return asString(record.value);
  }
  return undefined;
}

interface ParsedBody {
  text?: string;
  html?: string;
  attachments: Json[];
}

function walkParts(part: Json, out: ParsedBody): void {
  const mimeType = asString(part.mimeType) ?? "";
  const body = asRecord(part.body);
  const filename = asString(part.filename);
  if (filename) {
    out.attachments.push(
      compact({
        filename,
        mimeType,
        size: Number(body.size) || 0,
        attachmentId: asString(body.attachmentId),
      }),
    );
  } else if (typeof body.data === "string" && body.data) {
    if (mimeType === "text/plain" && out.text === undefined) out.text = base64DecodeToString(body.data);
    if (mimeType === "text/html" && out.html === undefined) out.html = base64DecodeToString(body.data);
  }
  for (const child of asArray(part.parts)) walkParts(asRecord(child), out);
}

/** Converts a Gmail `messages.get?format=full` resource into a `mail.received` event. */
export function gmailMessageToEvent(message: Json): NormalizedEventInput | null {
  const id = asString(message.id);
  if (!id) return null;
  const labels = asArray(message.labelIds);
  if (!labels.includes("INBOX") || labels.includes("SENT") || labels.includes("DRAFT")) return null;
  const payload = asRecord(message.payload);
  const headers = asArray(payload.headers);
  const from = parseAddress(headerValue(headers, "From"));
  const body: ParsedBody = { attachments: [] };
  walkParts(payload, body);
  const internalDate = Number(message.internalDate);
  return {
    type: "mail.received",
    occurredAt:
      Number.isFinite(internalDate) && internalDate > 0 ? new Date(internalDate).toISOString() : undefined,
    dedupeKey: `gmail:${id}`,
    payload: compact({
      from: from.email,
      fromName: from.name,
      to: parseAddress(headerValue(headers, "To")).email,
      subject: headerValue(headers, "Subject") ?? "",
      text: body.text ?? asString(message.snippet) ?? "",
      html: body.html,
      // RFC 822 Message-ID: what `send.inReplyTo` expects back.
      messageId: headerValue(headers, "Message-ID") ?? id,
      threadId: asString(message.threadId),
      externalId: id,
      attachments: body.attachments,
    }),
    contact: compact({ name: from.name, email: from.email }),
  };
}

async function listNewMessageIds(
  context: ConnectorContext,
  cursor: Record<string, unknown>,
): Promise<{ ids: string[]; historyId?: string }> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  let historyId: string | undefined;
  do {
    const response = await authorizedSend(context, OAUTH, `${API}/history`, {
      query: {
        startHistoryId: asString(cursor.historyId),
        historyTypes: "messageAdded",
        labelId: "INBOX",
        maxResults: "100",
        pageToken,
      },
    });
    if (response.status === 404) {
      // The history id is too old for Gmail: fall back to a date search.
      await response.body?.cancel().catch(() => undefined);
      const since = Math.floor(
        (Number(cursor.lastInternalDate) || context.now().getTime() - 86_400_000) / 1000,
      );
      const list = await authorizedJson(context, OAUTH, `${API}/messages`, {
        query: { labelIds: "INBOX", q: `after:${since}`, maxResults: String(MAX_MESSAGES_PER_POLL) },
      });
      const profile = await authorizedJson(context, OAUTH, `${API}/profile`);
      const found = asArray(list.messages).map((item) => asString(asRecord(item).id) ?? "");
      return { ids: found.filter(Boolean).reverse(), historyId: asString(profile.historyId) };
    }
    await ensureOk(SERVICE, response);
    const page = asRecord(await response.json());
    historyId = asString(page.historyId) ?? historyId;
    for (const entry of asArray(page.history)) {
      for (const added of asArray(asRecord(entry).messagesAdded)) {
        const id = asString(asRecord(asRecord(added).message).id);
        if (id) ids.push(id);
      }
    }
    pageToken = asString(page.nextPageToken);
  } while (pageToken);
  return { ids: unique(ids), historyId };
}

export const gmailConnector: Connector = {
  key: "gmail",
  category: "mail",
  name: "Gmail",
  description: "Legge le mail in arrivo e invia dal tuo indirizzo Gmail.",
  connectMode: "oauth",
  inputSchema: OAuthCallbackInput,
  emits: ["mail.received"],

  startOAuth(input) {
    return { authorizationUrl: googleAuthorizationUrl(SCOPES, input) };
  },

  async connect(input, deps) {
    const { code, redirectUri } = parseInput(OAuthCallbackInput, input);
    const tokens = await exchangeCode(deps, OAUTH, { code, redirectUri });
    if (!tokens.refreshToken) {
      throw new ConnectorError(`${SERVICE}: autorizzazione incompleta, ripeti il collegamento`, {
        retryable: false,
        code: "oauth_no_refresh_token",
      });
    }
    const profile = await requestJson(deps.fetch, SERVICE, `${API}/profile`, {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    });
    const email = asString(profile.emailAddress) ?? "";
    return {
      config: { email },
      secrets: { ...tokens },
      externalAccountId: email || undefined,
    };
  },

  async verify(context) {
    try {
      await authorizedJson(context, OAUTH, `${API}/profile`);
      return HEALTHY;
    } catch (error) {
      return healthFromError(error);
    }
  },

  async poll(context, cursor) {
    if (!cursor?.historyId) {
      // First poll: start from now, older mail is not replayed.
      const profile = await authorizedJson(context, OAUTH, `${API}/profile`);
      return {
        events: [],
        cursor: { historyId: asString(profile.historyId), lastInternalDate: context.now().getTime() },
      };
    }
    const { ids, historyId } = await listNewMessageIds(context, cursor);
    const events: NormalizedEventInput[] = [];
    let lastInternalDate = Number(cursor.lastInternalDate) || 0;
    for (const id of ids.slice(0, MAX_MESSAGES_PER_POLL)) {
      const response = await authorizedSend(context, OAUTH, `${API}/messages/${encodeURIComponent(id)}`, {
        query: { format: "full" },
      });
      if (response.status === 404) {
        // Deleted between the history call and now.
        await response.body?.cancel().catch(() => undefined);
        continue;
      }
      await ensureOk(SERVICE, response);
      const message = asRecord(await response.json());
      lastInternalDate = Math.max(lastInternalDate, Number(message.internalDate) || 0);
      const event = gmailMessageToEvent(message);
      if (event) events.push(event);
    }
    if (ids.length > MAX_MESSAGES_PER_POLL) {
      context.logger.warn("gmail poll truncated", { connectionId: context.connection.id, found: ids.length });
    }
    return { events, cursor: { historyId: historyId ?? asString(cursor.historyId), lastInternalDate } };
  },

  actions: {
    send: defineAction({
      key: "send",
      title: "Invia una mail",
      input: MailSendInput,
      async execute(context, input): Promise<SendResult> {
        const from = requireString(context.connection.config, "email", SERVICE);
        const raw = buildRawBase64Url({ from, ...input });
        const sent = await authorizedJson(context, OAUTH, `${API}/messages/send`, {
          json: input.threadId ? { raw, threadId: input.threadId } : { raw },
        });
        return { externalId: asString(sent.id) ?? "", status: "sent" };
      },
    }),
  },

  async disconnect(context) {
    await revokeGoogleToken(
      context.fetch,
      SERVICE,
      context.secrets.refreshToken ?? context.secrets.accessToken,
    );
  },
};
