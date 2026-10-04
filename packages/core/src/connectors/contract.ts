import { z } from "zod";
import type { ConnectionStatus, ConnectorCategory } from "../domain.ts";
import type { NormalizedEventInput } from "../events.ts";
import type { HostResolver } from "../net.ts";

/**
 * Contract every connector implements. The flow engine only knows this
 * interface and the standard action keys below, never a concrete provider.
 */
export interface ConnectionRecord {
  id: string;
  organizationId: string;
  connectorKey: string;
  status: ConnectionStatus;
  /** Non-secret configuration, readable by the frontend. */
  config: Record<string, unknown>;
}

export interface ConnectorLogger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

export interface ConnectorContext {
  connection: ConnectionRecord;
  /** Decrypted secrets. Never log them. */
  secrets: Record<string, unknown>;
  fetch: typeof fetch;
  now(): Date;
  logger: ConnectorLogger;
  /** Persist rotated secrets (e.g. a refreshed OAuth token). */
  saveSecrets(secrets: Record<string, unknown>): Promise<void>;
  /** Platform-level settings (OAuth client ids, app secrets) from the environment. */
  env: Record<string, string | undefined>;
  /**
   * DNS lookup used to check customer-supplied hosts before connecting (SSRF guard).
   * Provided by the worker and by the web server; absent in the edge function, where
   * only the host name itself can be checked.
   */
  resolveHost?: HostResolver;
}

export interface HealthStatus {
  status: ConnectionStatus;
  message?: string;
}

/** How the guided procedure collects access. */
export type ConnectMode = "oauth" | "api_key" | "credentials" | "qr" | "webhook";

export interface ConnectResult {
  config: Record<string, unknown>;
  secrets: Record<string, unknown>;
  externalAccountId?: string;
  /** For `qr` mode: data to display while pairing is pending. */
  pending?: { qr?: string; message?: string };
}

export interface OAuthStart {
  authorizationUrl: string;
}

export interface WebhookRequest {
  method: string;
  headers: Record<string, string>;
  query: Record<string, string>;
  /** Raw body, needed for signature verification. */
  rawBody: string;
}

export interface WebhookResult {
  /** False when the signature check fails: the caller answers 401 and stores nothing. */
  verified: boolean;
  events: NormalizedEventInput[];
  /** Body to echo back (e.g. Meta's hub.challenge). */
  response?: { status: number; body: string; contentType?: string };
}

export interface PollResult {
  events: NormalizedEventInput[];
  /** Opaque cursor saved in `connections.config.cursor` for the next poll. */
  cursor?: Record<string, unknown>;
}

export interface ActionDefinition<I = unknown, O = unknown> {
  key: string;
  title: string;
  input: z.ZodType<I>;
  /**
   * True when the connector exposes a standard action of its category only to say it cannot
   * perform it (e.g. `read` on an inbound-only webhook). The engine never picks such a connection.
   */
  unsupported?: boolean;
  execute(context: ConnectorContext, input: I): Promise<O>;
}

export interface Connector {
  key: string;
  category: ConnectorCategory;
  name: string;
  description: string;
  connectMode: ConnectMode;
  /** Schema of the form the customer fills in (credentials, api key, options). */
  inputSchema: z.ZodType;
  /** Event types this connector can emit. */
  emits: readonly string[];
  /** OAuth only: where to send the customer. */
  startOAuth?(input: {
    redirectUri: string;
    state: string;
    env: Record<string, string | undefined>;
  }): OAuthStart;
  /** Completes the guided procedure. For OAuth, `input` holds `{ code, redirectUri }`. */
  connect(
    input: Record<string, unknown>,
    deps: { fetch: typeof fetch; env: Record<string, string | undefined>; resolveHost?: HostResolver },
  ): Promise<ConnectResult>;
  /** Periodic health check; decides `connections.status`. */
  verify(context: ConnectorContext): Promise<HealthStatus>;
  /** Polling source. */
  poll?(context: ConnectorContext, cursor: Record<string, unknown> | undefined): Promise<PollResult>;
  /**
   * Webhook source for one connection. Must verify the signature, unless the request
   * already passed `receiveProviderWebhook`.
   */
  handleWebhook?(context: ConnectorContext, request: WebhookRequest): Promise<WebhookResult>;
  /**
   * Provider-level webhooks: one URL for every customer (e.g. Meta). Verifies the request
   * with platform secrets from `env`, answers handshakes, and lists the external account ids
   * the payload is addressed to; `handleWebhook` then runs once per matching connection.
   */
  receiveProviderWebhook?(
    request: WebhookRequest,
    env: Record<string, string | undefined>,
  ): Promise<{ verified: boolean; accountIds: string[]; response?: WebhookResult["response"] }>;
  actions: Record<string, ActionDefinition<any, any>>;
  disconnect(context: ConnectorContext): Promise<void>;
}

/** Thrown by actions so the engine can tell retryable failures from permanent ones. */
export class ConnectorError extends Error {
  constructor(
    message: string,
    public readonly options: { retryable: boolean; code?: string; status?: number } = { retryable: false },
  ) {
    super(message);
    this.name = "ConnectorError";
  }
  get retryable(): boolean {
    return this.options.retryable;
  }
}

// ── Standard actions per category ──────────────────────────────────────
// A connector of a category implements the actions below with exactly
// these inputs and outputs, so blocks stay provider-agnostic.

export const SendResultSchema = z.object({
  externalId: z.string(),
  status: z.enum(["sent", "queued"]).default("sent"),
});
export type SendResult = z.infer<typeof SendResultSchema>;

export const WhatsAppSendTemplateInput = z.object({
  to: z.string(),
  /** Provider-side template name. */
  template: z.string(),
  language: z.string().default("it"),
  /** Ordered body variables: {{1}}, {{2}}… */
  variables: z.array(z.string()).default([]),
  /** Rendered text, for providers without server-side templates (waWebApi). */
  renderedText: z.string().optional(),
});
export const WhatsAppSendTextInput = z.object({ to: z.string(), text: z.string() });

export const MailSendInput = z.object({
  to: z.string(),
  subject: z.string(),
  text: z.string(),
  html: z.string().optional(),
  inReplyTo: z.string().optional(),
  threadId: z.string().optional(),
});

export const SmsSendInput = z.object({ to: z.string(), text: z.string() });

export const CrmReadInput = z.object({
  resource: z.string(),
  query: z.record(z.string(), z.unknown()).default({}),
});
export const CrmReadOutput = z.object({ records: z.array(z.record(z.string(), z.unknown())) });
export const CrmWriteInput = z.object({
  resource: z.string(),
  id: z.string().optional(),
  data: z.record(z.string(), z.unknown()),
});
export const CrmWriteOutput = z.object({ id: z.string() });

export const SocialSendMessageInput = z.object({
  to: z.string(),
  text: z.string(),
  platform: z.string().optional(),
});
export const SocialPublishPostInput = z.object({ text: z.string(), mediaUrl: z.string().optional() });
export const SocialReplyCommentInput = z.object({ commentId: z.string(), text: z.string() });

export const CalendarFindSlotsInput = z.object({
  from: z.string(),
  to: z.string(),
  durationMinutes: z.number(),
  max: z.number().default(3),
});
export const CalendarFindSlotsOutput = z.object({
  slots: z.array(z.object({ start: z.string(), end: z.string() })),
});
export const CalendarCreateEventInput = z.object({
  title: z.string(),
  start: z.string(),
  end: z.string(),
  location: z.string().optional(),
  attendeeEmail: z.string().optional(),
  description: z.string().optional(),
});
export const CalendarCreateEventOutput = z.object({
  externalEventId: z.string(),
  url: z.string().optional(),
});

export const PaymentCreateLinkInput = z.object({
  amountCents: z.number().int().positive(),
  currency: z.string().default("EUR"),
  description: z.string(),
  reference: z.string(),
});
export const PaymentCreateLinkOutput = z.object({ externalId: z.string(), url: z.string() });

export const SignatureCreateInput = z.object({
  documentUrl: z.string(),
  title: z.string(),
  signerName: z.string(),
  signerEmail: z.string(),
  reference: z.string(),
});
export const SignatureCreateOutput = z.object({ externalId: z.string(), url: z.string() });

/** Action keys each category must expose. Checked by the connector registry tests. */
export const STANDARD_ACTIONS: Record<ConnectorCategory, readonly string[]> = {
  whatsapp: ["sendTemplate", "sendText"],
  mail: ["send"],
  sms: ["send"],
  crm: ["read", "write"],
  social: ["sendMessage", "publishPost", "replyComment"],
  calendar: ["findSlots", "createEvent"],
  payment: ["createLink"],
  signature: ["createRequest"],
  scraper: [],
};
