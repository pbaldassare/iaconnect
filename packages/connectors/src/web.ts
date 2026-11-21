/**
 * Connector registry for the web app (Cloudflare Workers / OpenNext).
 *
 * Web-standard connectors are loaded here. The IMAP/SMTP connector is real, but
 * its sockets live in `imap-smtp.ts` (imapflow, mailparser, nodemailer) and are
 * imported only when one of its methods runs. A static import would put
 * `require("imapflow")` in the Collegamenti server bundle and crash the page
 * before it renders.
 */
import { type Connector, type ConnectorContext, MailSendInput } from "@ia-connect/core";
import { IMAP_SMTP_DESCRIPTION, IMAP_SMTP_NAME, ImapSmtpInput } from "./imap-smtp-schema.ts";
import { defineAction } from "./lib/actions.ts";
import { webConnectors } from "./registry.ts";

async function imapSmtpConnector(): Promise<Connector> {
  const { imapSmtpConnector } = await import("./imap-smtp.ts");
  return imapSmtpConnector;
}

const imapSmtpWebConnector: Connector = {
  key: "imap_smtp",
  category: "mail",
  name: IMAP_SMTP_NAME,
  description: IMAP_SMTP_DESCRIPTION,
  connectMode: "credentials",
  inputSchema: ImapSmtpInput,
  emits: ["mail.received"],
  async connect(input, deps) {
    return (await imapSmtpConnector()).connect(input, deps);
  },
  async verify(context) {
    return (await imapSmtpConnector()).verify(context);
  },
  async poll(context, cursor) {
    const poll = (await imapSmtpConnector()).poll;
    if (!poll) return { events: [], cursor: cursor ?? {} };
    return poll(context, cursor);
  },
  actions: {
    send: defineAction({
      key: "send",
      title: "Invia una mail",
      input: MailSendInput,
      async execute(context: ConnectorContext, input) {
        const send = (await imapSmtpConnector()).actions.send;
        if (!send) throw new Error("imap_smtp has no send action");
        return send.execute(context, input);
      },
    }),
  },
  async disconnect(context) {
    return (await imapSmtpConnector()).disconnect(context);
  },
};

const connectors: readonly Connector[] = [...webConnectors, imapSmtpWebConnector];
const byKey = new Map(connectors.map((connector) => [connector.key, connector]));

export function getConnector(key: string): Connector | undefined {
  return byKey.get(key);
}

export function listConnectors(): Connector[] {
  return [...connectors];
}
