import type { Connector } from "@ia-connect/core";
import { crmRestConnector } from "./crm-rest.ts";
import { ghlSocialConnector } from "./ghl-social.ts";
import { gmailConnector } from "./gmail.ts";
import { googleCalendarConnector } from "./google-calendar.ts";
import { metaSocialConnector } from "./meta-social.ts";
import { microsoft365Connector } from "./microsoft365.ts";
import { paymentStripeConnector } from "./payment-stripe.ts";
import { scraperSiteConnector } from "./scraper-site.ts";
import { signatureLinkConnector } from "./signature-link.ts";
import { smsTwilioConnector } from "./sms-twilio.ts";
import { webhookInboundConnector } from "./webhook-inbound.ts";
import { whatsappMetaConnector } from "./whatsapp-meta.ts";
import { whatsappWaWebApiConnector } from "./whatsapp-wawebapi.ts";

/**
 * Connectors that only use Web-standard APIs (fetch, Web Crypto): safe to load in the
 * edge runtime. The Node-only IMAP/SMTP connector is added by `index.ts`.
 */
export const webConnectors: readonly Connector[] = [
  gmailConnector,
  microsoft365Connector,
  whatsappMetaConnector,
  whatsappWaWebApiConnector,
  crmRestConnector,
  webhookInboundConnector,
  googleCalendarConnector,
  metaSocialConnector,
  ghlSocialConnector,
  smsTwilioConnector,
  scraperSiteConnector,
  paymentStripeConnector,
  signatureLinkConnector,
];
