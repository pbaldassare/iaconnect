import type { Connector } from "@ia-connect/core";
import { imapSmtpConnector } from "./imap-smtp.ts";
import { webConnectors } from "./registry.ts";

export { crmRestConnector, CrmRestInput } from "./crm-rest.ts";
export { ghlSocialConnector, GHL, GhlSocialInput } from "./ghl-social.ts";
export { gmailConnector } from "./gmail.ts";
export { googleCalendarConnector, computeFreeSlots, GoogleCalendarInput } from "./google-calendar.ts";
export {
  createImapSmtpConnector,
  imapSmtpConnector,
  ImapSmtpInput,
  type ImapSmtpDeps,
} from "./imap-smtp.ts";
export { metaSocialConnector, MetaSocialInput } from "./meta-social.ts";
export { microsoft365Connector } from "./microsoft365.ts";
export { paymentStripeConnector, PaymentStripeInput } from "./payment-stripe.ts";
export { scraperSiteConnector, ScraperSiteInput } from "./scraper-site.ts";
export { signatureLinkConnector, SignatureLinkInput, SignatureWebhookBody } from "./signature-link.ts";
export { smsTwilioConnector, SmsTwilioInput } from "./sms-twilio.ts";
export { webhookInboundConnector, InboundWebhookBody, WebhookInboundInput } from "./webhook-inbound.ts";
export { whatsappMetaConnector, WhatsAppMetaInput } from "./whatsapp-meta.ts";
export { whatsappWaWebApiConnector, WAWEBAPI, WaWebApiInput } from "./whatsapp-wawebapi.ts";
export { OAuthCallbackInput, RegisterWebhookInput } from "./lib/schemas.ts";
export { nodeHostResolver } from "./lib/dns-node.ts";
export { assertPublicHttpUrl, assertPublicTarget, guardedFetch } from "./lib/url.ts";
export { IA_SIGNATURE_HEADER, REQUEST_URL_HEADER } from "./lib/webhook.ts";
export {
  handleInboundWebhook,
  webhookConnectors,
  MAX_WEBHOOK_BODY_BYTES,
  type WebhookDeps,
} from "./webhooks.ts";

const connectors: readonly Connector[] = [...webConnectors, imapSmtpConnector];
const byKey = new Map(connectors.map((connector) => [connector.key, connector]));

export function getConnector(key: string): Connector | undefined {
  return byKey.get(key);
}

export function listConnectors(): Connector[] {
  return [...connectors];
}
