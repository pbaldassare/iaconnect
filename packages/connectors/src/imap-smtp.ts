/**
 * Node-only connector (imapflow, mailparser, nodemailer): reachable from `index.ts`
 * only, never from `webhooks.ts` (edge runtime).
 */
import {
  type Connector,
  type ConnectorContext,
  ConnectorError,
  type HealthStatus,
  type HostResolver,
  MailSendInput,
  type NormalizedEventInput,
  type SendResult,
  isIpAddress,
} from "@ia-connect/core";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";
import { z } from "zod";
import { defineAction } from "./lib/actions.ts";
import { nodeHostResolver } from "./lib/dns-node.ts";
import { AUTH_EXPIRED, HEALTHY, healthFromError, parseInput, requireString } from "./lib/http.ts";
import { assertPublicTarget } from "./lib/url.ts";
import { asString, compact } from "./lib/values.ts";

const SERVICE = "Casella IMAP/SMTP";
const MAX_MESSAGES_PER_POLL = 50;

export const ImapSmtpInput = z.object({
  email: z.string().email().describe("Indirizzo mail della casella"),
  fromName: z.string().optional().describe("Nome mostrato come mittente"),
  username: z.string().min(1).describe("Nome utente (di solito l'indirizzo mail)"),
  password: z.string().min(1).describe("Password o password per le app"),
  imapHost: z.string().min(1).describe("Server IMAP (posta in arrivo)"),
  imapPort: z.number().int().positive().default(993).describe("Porta IMAP"),
  imapSecure: z.boolean().default(true).describe("Connessione IMAP cifrata (TLS)"),
  smtpHost: z.string().min(1).describe("Server SMTP (posta in uscita)"),
  smtpPort: z.number().int().positive().default(465).describe("Porta SMTP"),
  smtpSecure: z.boolean().default(true).describe("Connessione SMTP cifrata (TLS)"),
});

interface ServerOptions {
  host: string;
  port: number;
  secure: boolean;
  auth: { user: string; pass: string };
  /**
   * Set when `host` is the address the name was checked to resolve to: the name the
   * certificate must match (ImapFlow reads `servername`, nodemailer `tls.servername`).
   */
  servername?: string;
  tls?: { servername: string };
}

export interface ImapClientLike {
  connect(): Promise<void>;
  logout(): Promise<void>;
  mailbox: false | { uidValidity: bigint; uidNext: number };
  getMailboxLock(path: string): Promise<{ release(): void }>;
  fetch(
    range: string,
    query: { uid: true; source: true },
    options: { uid: true },
  ): AsyncIterable<{ uid: number; source?: Uint8Array }>;
}

export interface SmtpTransportLike {
  verify(): Promise<unknown>;
  sendMail(mail: Record<string, unknown>): Promise<{ messageId?: string }>;
  close(): void;
}

export interface ParsedMailLike {
  from?: { value: { address?: string; name?: string }[] };
  to?: unknown;
  subject?: string;
  text?: string;
  html?: string | false;
  messageId?: string;
  references?: string | string[];
  date?: Date;
  attachments?: { filename?: string; contentType?: string; size?: number }[];
}

/** Injectable so tests never open a socket. */
export interface ImapSmtpDeps {
  createImapClient(options: ServerOptions): ImapClientLike;
  createSmtpTransport(options: ServerOptions): SmtpTransportLike;
  parseMessage(source: Uint8Array): Promise<ParsedMailLike>;
  /** DNS lookup for the host check, when the caller's context does not bring one. */
  resolveHost?: HostResolver;
}

const defaultDeps: ImapSmtpDeps = {
  createImapClient: (options) => new ImapFlow({ ...options, logger: false }) as unknown as ImapClientLike,
  createSmtpTransport: (options) => nodemailer.createTransport(options) as unknown as SmtpTransportLike,
  parseMessage: async (source) => (await simpleParser(Buffer.from(source))) as unknown as ParsedMailLike,
  resolveHost: nodeHostResolver,
};

/** Never forwards the library error: it can contain the server greeting or the username. */
function mailError(error: unknown, what: string): ConnectorError {
  if (error instanceof ConnectorError) return error;
  const record = (error ?? {}) as { authenticationFailed?: boolean; code?: string; responseCode?: number };
  const authFailed =
    record.authenticationFailed === true || record.code === "EAUTH" || record.responseCode === 535;
  if (authFailed) {
    return new ConnectorError(`${SERVICE}: credenziali rifiutate (${what})`, {
      retryable: false,
      code: AUTH_EXPIRED,
      status: 401,
    });
  }
  const permanent = typeof record.responseCode === "number" && record.responseCode >= 500;
  return new ConnectorError(`${SERVICE}: ${what} non riuscito`, {
    retryable: !permanent,
    code: permanent ? "smtp_rejected" : "network",
  });
}

function imapOptions(config: Record<string, unknown>, secrets: Record<string, unknown>): ServerOptions {
  return {
    host: requireString(config, "imapHost", SERVICE),
    port: Number(config.imapPort) || 993,
    secure: config.imapSecure !== false,
    auth: {
      user: requireString(config, "username", SERVICE),
      pass: requireString(secrets, "password", SERVICE),
    },
  };
}

function smtpOptions(config: Record<string, unknown>, secrets: Record<string, unknown>): ServerOptions {
  return {
    host: requireString(config, "smtpHost", SERVICE),
    port: Number(config.smtpPort) || 465,
    secure: config.smtpSecure !== false,
    auth: {
      user: requireString(config, "username", SERVICE),
      pass: requireString(secrets, "password", SERVICE),
    },
  };
}

function firstAddress(value: unknown): string {
  const first = Array.isArray(value) ? value[0] : value;
  const list = (first as { value?: { address?: string }[] } | undefined)?.value;
  return list?.[0]?.address ?? "";
}

export function parsedMailToEvent(
  connectionId: string,
  uidKey: string,
  mail: ParsedMailLike,
): NormalizedEventInput {
  const from = mail.from?.value[0];
  const references = Array.isArray(mail.references) ? mail.references[0] : mail.references;
  return {
    type: "mail.received",
    occurredAt:
      mail.date instanceof Date && !Number.isNaN(mail.date.getTime()) ? mail.date.toISOString() : undefined,
    dedupeKey: `imap:${connectionId}:${mail.messageId ?? uidKey}`.slice(0, 512),
    payload: compact({
      from: from?.address ?? "",
      fromName: from?.name || undefined,
      to: firstAddress(mail.to),
      subject: mail.subject ?? "",
      text: mail.text ?? "",
      html: typeof mail.html === "string" ? mail.html : undefined,
      messageId: mail.messageId ?? uidKey,
      // IMAP has no thread id: the root of the References chain is the closest thing.
      threadId: references ?? undefined,
      attachments: (mail.attachments ?? []).map((item) =>
        compact({ filename: item.filename, mimeType: item.contentType, size: item.size }),
      ),
    }),
    contact: compact({ name: from?.name || undefined, email: from?.address }),
  };
}

export function createImapSmtpConnector(deps: ImapSmtpDeps = defaultDeps): Connector {
  /**
   * The mail servers are typed by the customer: a host on our own network (localhost, a
   * private address, the cloud metadata service) is refused before any socket is opened.
   * With a resolver the connection then goes to the address that was checked, with the name
   * kept for the TLS certificate: the name cannot resolve to something else in between.
   */
  async function safe(options: ServerOptions, from: { resolveHost?: HostResolver }): Promise<ServerOptions> {
    const addresses = await assertPublicTarget(options.host, SERVICE, from.resolveHost ?? deps.resolveHost);
    if (addresses.length === 0 || isIpAddress(options.host)) return options;
    return {
      ...options,
      host: addresses[0]!,
      servername: options.host,
      tls: { servername: options.host },
    };
  }

  async function checkImap(options: ServerOptions): Promise<void> {
    const client = deps.createImapClient(options);
    try {
      await client.connect();
      await client.logout();
    } catch (error) {
      throw mailError(error, "accesso IMAP");
    }
  }

  async function checkSmtp(options: ServerOptions): Promise<void> {
    const transport = deps.createSmtpTransport(options);
    try {
      await transport.verify();
    } catch (error) {
      throw mailError(error, "accesso SMTP");
    } finally {
      transport.close();
    }
  }

  async function verify(context: ConnectorContext): Promise<HealthStatus> {
    try {
      await checkImap(await safe(imapOptions(context.connection.config, context.secrets), context));
      await checkSmtp(await safe(smtpOptions(context.connection.config, context.secrets), context));
      return HEALTHY;
    } catch (error) {
      return healthFromError(error);
    }
  }

  return {
    key: "imap_smtp",
    category: "mail",
    name: "Altra casella (IMAP/SMTP)",
    description: "Qualsiasi casella con accesso IMAP e SMTP.",
    connectMode: "credentials",
    inputSchema: ImapSmtpInput,
    emits: ["mail.received"],

    async connect(input, connectDeps) {
      const { password, ...config } = parseInput(ImapSmtpInput, input);
      const secrets = { password };
      await checkImap(await safe(imapOptions(config, secrets), connectDeps));
      await checkSmtp(await safe(smtpOptions(config, secrets), connectDeps));
      return { config, secrets, externalAccountId: config.email };
    },

    verify,

    async poll(context, cursor) {
      const client = deps.createImapClient(
        await safe(imapOptions(context.connection.config, context.secrets), context),
      );
      const events: NormalizedEventInput[] = [];
      try {
        await client.connect();
        const lock = await client.getMailboxLock("INBOX");
        try {
          if (!client.mailbox) throw new Error("mailbox not open");
          const uidValidity = client.mailbox.uidValidity.toString();
          const newest = client.mailbox.uidNext - 1;
          const lastUid = Number(cursor?.lastUid);
          if (!cursor || asString(cursor.uidValidity) !== uidValidity || !Number.isFinite(lastUid)) {
            // First poll (or the server renumbered the mailbox): start from now.
            return { events, cursor: { uidValidity, lastUid: newest } };
          }
          if (newest <= lastUid) return { events, cursor: { uidValidity, lastUid } };

          const upTo = Math.min(newest, lastUid + MAX_MESSAGES_PER_POLL);
          let highest = lastUid;
          const range = `${lastUid + 1}:${upTo}`;
          for await (const message of client.fetch(range, { uid: true, source: true }, { uid: true })) {
            if (message.uid <= lastUid || !message.source) continue;
            highest = Math.max(highest, message.uid);
            const mail = await deps.parseMessage(message.source);
            events.push(parsedMailToEvent(context.connection.id, `${uidValidity}:${message.uid}`, mail));
          }
          // Advance past gaps (deleted messages) inside the window too.
          return { events, cursor: { uidValidity, lastUid: Math.max(highest, upTo) } };
        } finally {
          lock.release();
        }
      } catch (error) {
        throw mailError(error, "lettura della posta");
      } finally {
        await client.logout().catch(() => undefined);
      }
    },

    actions: {
      send: defineAction({
        key: "send",
        title: "Invia una mail",
        input: MailSendInput,
        async execute(context, input): Promise<SendResult> {
          const { config } = context.connection;
          const email = requireString(config, "email", SERVICE);
          const fromName = asString(config.fromName);
          const transport = deps.createSmtpTransport(
            await safe(smtpOptions(config, context.secrets), context),
          );
          try {
            const info = await transport.sendMail(
              compact({
                from: fromName ? { name: fromName, address: email } : email,
                to: input.to,
                subject: input.subject,
                text: input.text,
                html: input.html,
                inReplyTo: input.inReplyTo,
                references: input.inReplyTo,
              }),
            );
            return { externalId: info.messageId ?? `imap_smtp:${crypto.randomUUID()}`, status: "sent" };
          } catch (error) {
            throw mailError(error, "invio");
          } finally {
            transport.close();
          }
        },
      }),
    },

    async disconnect() {
      // Nothing to revoke on the mail server: dropping the stored password is enough.
    },
  };
}

export const imapSmtpConnector: Connector = createImapSmtpConnector();
