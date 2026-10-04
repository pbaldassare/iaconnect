import {
  type Connector,
  ConnectorError,
  MailSendInput,
  type NormalizedEventInput,
  type SendResult,
} from "@ia-connect/core";
import { defineAction } from "./lib/actions.ts";
import { HEALTHY, healthFromError, parseInput, requestJson, requireEnv } from "./lib/http.ts";
import { type OAuthProvider, authorizedJson, authorizedRequest, exchangeCode } from "./lib/oauth.ts";
import { OAuthCallbackInput } from "./lib/schemas.ts";
import { type Json, asArray, asRecord, asString, compact } from "./lib/values.ts";

const SERVICE = "Microsoft 365";
const GRAPH = "https://graph.microsoft.com/v1.0";
const SCOPES = ["offline_access", "User.Read", "Mail.Read", "Mail.Send"];
const OAUTH: OAuthProvider = {
  service: SERVICE,
  tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
  clientIdEnv: "MICROSOFT_CLIENT_ID",
  clientSecretEnv: "MICROSOFT_CLIENT_SECRET",
};
const PAGE_SIZE = 50;
const MAX_PAGES = 4;
const MESSAGE_FIELDS =
  "id,internetMessageId,conversationId,subject,from,toRecipients,receivedDateTime,body,hasAttachments";

function emailAddress(value: unknown): { name?: string; email: string } {
  const address = asRecord(asRecord(value).emailAddress);
  return { name: asString(address.name) || undefined, email: asString(address.address) ?? "" };
}

/** Converts a Graph message (requested with a text body) into a `mail.received` event. */
export function graphMessageToEvent(message: Json): NormalizedEventInput | null {
  const id = asString(message.id);
  if (!id) return null;
  const internetMessageId = asString(message.internetMessageId);
  const from = emailAddress(message.from);
  const to = emailAddress(asArray(message.toRecipients)[0]);
  const received = asString(message.receivedDateTime);
  return {
    type: "mail.received",
    occurredAt: received ? new Date(received).toISOString() : undefined,
    // Graph ids change when a message is moved: the RFC 822 id is the stable one.
    dedupeKey: `microsoft365:${internetMessageId ?? id}`,
    payload: compact({
      from: from.email,
      fromName: from.name,
      to: to.email,
      subject: asString(message.subject) ?? "",
      text: asString(asRecord(message.body).content) ?? "",
      messageId: internetMessageId ?? id,
      threadId: asString(message.conversationId),
      externalId: id,
      attachments: [],
      hasAttachments: message.hasAttachments === true,
    }),
    contact: compact({ name: from.name, email: from.email }),
  };
}

export const microsoft365Connector: Connector = {
  key: "microsoft365",
  category: "mail",
  name: "Microsoft 365",
  description: "Posta di Outlook ed Exchange Online.",
  connectMode: "oauth",
  inputSchema: OAuthCallbackInput,
  emits: ["mail.received"],

  startOAuth(input) {
    const url = new URL("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
    url.search = new URLSearchParams({
      client_id: requireEnv(input.env, "MICROSOFT_CLIENT_ID"),
      redirect_uri: input.redirectUri,
      response_type: "code",
      response_mode: "query",
      scope: SCOPES.join(" "),
      state: input.state,
    }).toString();
    return { authorizationUrl: url.toString() };
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
    const me = await requestJson(deps.fetch, SERVICE, `${GRAPH}/me`, {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
      query: { $select: "id,mail,userPrincipalName,displayName" },
    });
    const email = asString(me.mail) ?? asString(me.userPrincipalName) ?? "";
    return {
      config: compact({ email, displayName: asString(me.displayName) }),
      secrets: { ...tokens },
      externalAccountId: asString(me.id) ?? (email || undefined),
    };
  },

  async verify(context) {
    try {
      await authorizedJson(context, OAUTH, `${GRAPH}/me`, { query: { $select: "id" } });
      return HEALTHY;
    } catch (error) {
      return healthFromError(error);
    }
  },

  async poll(context, cursor) {
    const receivedAfter = asString(cursor?.receivedAfter);
    if (!receivedAfter) {
      // First poll: start from now, older mail is not replayed.
      return { events: [], cursor: { receivedAfter: context.now().toISOString() } };
    }
    const events: NormalizedEventInput[] = [];
    let latest = receivedAfter;
    let url: string | undefined = `${GRAPH}/me/mailFolders/inbox/messages`;
    let query: Record<string, string> | undefined = {
      // `ge` re-reads the last second; the dedupe key drops what was already stored.
      $filter: `receivedDateTime ge ${receivedAfter}`,
      $orderby: "receivedDateTime asc",
      $top: String(PAGE_SIZE),
      $select: MESSAGE_FIELDS,
    };
    for (let page = 0; url && page < MAX_PAGES; page++) {
      const result: Json = await authorizedJson(context, OAUTH, url, {
        query,
        headers: { prefer: 'outlook.body-content-type="text"' },
      });
      for (const item of asArray(result.value)) {
        const message = asRecord(item);
        const event = graphMessageToEvent(message);
        if (event) events.push(event);
        const received = asString(message.receivedDateTime);
        if (received && Date.parse(received) > Date.parse(latest)) latest = received;
      }
      // The next link already carries every query parameter.
      url = asString(result["@odata.nextLink"]);
      query = undefined;
    }
    return { events, cursor: { receivedAfter: latest } };
  },

  actions: {
    send: defineAction({
      key: "send",
      title: "Invia una mail",
      input: MailSendInput,
      async execute(context, input): Promise<SendResult> {
        const body = { contentType: input.html ? "HTML" : "Text", content: input.html ?? input.text };
        const toRecipients = [{ emailAddress: { address: input.to } }];

        if (input.inReplyTo) {
          // Graph cannot set In-Reply-To on sendMail: reply to the original message when we can find it.
          const found = await authorizedJson(context, OAUTH, `${GRAPH}/me/messages`, {
            query: {
              $filter: `internetMessageId eq '${input.inReplyTo.replace(/'/g, "''")}'`,
              $select: "id",
              $top: "1",
            },
          });
          const originalId = asString(asRecord(asArray(found.value)[0]).id);
          if (originalId) {
            await authorizedRequest(
              context,
              OAUTH,
              `${GRAPH}/me/messages/${encodeURIComponent(originalId)}/reply`,
              { json: { message: { toRecipients, body } } },
            );
            return {
              externalId: `microsoft365:reply:${originalId}:${crypto.randomUUID()}`,
              status: "queued",
            };
          }
        }

        await authorizedRequest(context, OAUTH, `${GRAPH}/me/sendMail`, {
          json: { message: { subject: input.subject, body, toRecipients }, saveToSentItems: true },
        });
        // sendMail answers 202 with no body: there is no provider id to return.
        return { externalId: `microsoft365:${crypto.randomUUID()}`, status: "queued" };
      },
    }),
  },

  async disconnect() {
    // Microsoft has no token revocation endpoint for this flow: dropping the stored secrets is enough.
  },
};
