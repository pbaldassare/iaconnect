/**
 * Data of the public demo: a fictional Italian insurance agency, "Agenzia Demo".
 *
 * Everything is invented (names, addresses, numbers in the form +39 333 000 00xx) and is
 * generated relative to `now`, so dates always look recent. Ids are deterministic: the same
 * row has the same id at every request, so links between pages keep working.
 *
 * To change what the demo shows, edit this file: rows are typed against the database row
 * types, and `apps/web/test/demo-fixtures.test.ts` checks that every reference points to an
 * existing row. Pure: no `server-only`, no runtime import from `@/…`.
 */
import { FLOW_TEMPLATES, type FlowDefinition, type Json, type Row } from "@ia-connect/core";
import type { DemoRpcHandlers, DemoTables } from "./client";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * Deterministic uuid-shaped id: `group` names the table, `n` the row. Both are in the first
 * eight characters, because that is what the pages show as a short id.
 */
export function demoId(group: number, n: number): string {
  const head = `${group.toString(16).padStart(2, "0")}${n.toString(16).padStart(6, "0")}`;
  return `${head}-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
}

export const DEMO_ORG_ID = demoId(1, 1);
export const DEMO_RESELLER_ID = demoId(2, 1);
export const DEMO_USER_ID = demoId(4, 1);
export const DEMO_COLLEAGUE_ID = demoId(4, 2);
const DEMO_STAFF_ID = demoId(4, 9);
export const DEMO_USER_EMAIL = "titolare@agenziademo.example";

/** Mail addresses of the demo users, shown where the real app reads them from Auth. */
export const DEMO_USER_EMAILS: Readonly<Record<string, string>> = {
  [DEMO_USER_ID]: DEMO_USER_EMAIL,
  [DEMO_COLLEAGUE_ID]: "giulia.ferrante@agenziademo.example",
};

const ORG = DEMO_ORG_ID;
const phone = (n: number) => `+3933300000${String(n).padStart(2, "0")}`;

export interface DemoData {
  tables: DemoTables;
  rpc: DemoRpcHandlers;
}

export function buildDemoData(now: Date = new Date()): DemoData {
  const t = now.getTime();
  /** ISO time `days`/`hours`/`minutes` before now. */
  const ago = (days: number, hours = 0, minutes = 0) =>
    new Date(t - days * DAY - hours * HOUR - minutes * 60_000).toISOString();
  const ahead = (days: number, hours = 0) => new Date(t + days * DAY + hours * HOUR).toISOString();
  const stamp = (at: string) => ({ created_at: at, updated_at: at });
  const period = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;

  // ── Platform rows the customer can read ──────────────────────────────────
  const plans: Row<"plans">[] = [
    {
      id: demoId(3, 1),
      key: "starter",
      name: "Starter",
      limits: {
        active_flows: 3,
        messages_per_month: 1000,
        scrape_runs_per_month: 0,
        ai_credits_per_month: 500,
      },
      price_monthly_cents: 9900,
      is_active: true,
      ...stamp(ago(200)),
    },
    {
      id: demoId(3, 2),
      key: "pro",
      name: "Pro",
      limits: {
        active_flows: 10,
        messages_per_month: 5000,
        scrape_runs_per_month: 1500,
        ai_credits_per_month: 3000,
      },
      price_monthly_cents: 24900,
      is_active: true,
      ...stamp(ago(200)),
    },
    {
      id: demoId(3, 3),
      key: "business",
      name: "Business",
      limits: {
        active_flows: 50,
        messages_per_month: 25000,
        scrape_runs_per_month: 10000,
        ai_credits_per_month: 15000,
      },
      price_monthly_cents: 59900,
      is_active: true,
      ...stamp(ago(200)),
    },
  ];
  const resellers: Row<"resellers">[] = [
    {
      id: DEMO_RESELLER_ID,
      name: "IA Connect",
      slug: "default",
      brand: {},
      status: "active",
      ...stamp(ago(200)),
    },
  ];
  const organizations: Row<"organizations">[] = [
    {
      id: ORG,
      reseller_id: DEMO_RESELLER_ID,
      name: "Agenzia Demo",
      sector: "insurance",
      plan_id: demoId(3, 2),
      status: "active",
      ...stamp(ago(96)),
    },
  ];
  const org_settings: Row<"org_settings">[] = [
    {
      id: demoId(29, 1),
      organization_id: ORG,
      language: "it",
      ai_tone: "Cordiale e professionale, frasi brevi, si dà del lei.",
      ai_instructions:
        "Siamo un'agenzia assicurativa di quartiere. Non comunicare mai prezzi che non compaiono nel preventivo. Per sinistri e disdette passa subito la conversazione a una persona.",
      out_of_scope_reply:
        "Per questa richiesta la metto in contatto con un collega dell'agenzia: la richiamiamo in giornata.",
      ai_disclosure: "Questo è un messaggio automatico dell'Agenzia Demo.",
      brand: {
        name: "Agenzia Demo",
        accent: "#1f7a4d",
        ownerPhone: phone(90),
        ownerEmail: DEMO_USER_EMAIL,
      },
      deal_custom_fields: [
        { key: "compagnia", label: "Compagnia", type: "text" },
        { key: "scadenza_polizza", label: "Scadenza polizza", type: "date" },
        { key: "veicoli", label: "Numero di veicoli", type: "number" },
        { key: "cliente_storico", label: "Cliente storico", type: "boolean" },
        { key: "scadenza", label: "Scadenza", type: "date" },
        { key: "targa", label: "Targa", type: "text" },
      ],
      ...stamp(ago(96)),
    },
  ];
  const org_features: Row<"org_features">[] = [
    {
      id: demoId(31, 1),
      organization_id: ORG,
      feature_key: "payments_signature",
      enabled: true,
      ...stamp(ago(60)),
    },
    { id: demoId(31, 2), organization_id: ORG, feature_key: "social", enabled: false, ...stamp(ago(60)) },
  ];
  const usage_counters: Row<"usage_counters">[] = [
    { id: demoId(30, 1), organization_id: ORG, period, metric: "messages", value: 4210, ...stamp(ago(0, 1)) },
    {
      id: demoId(30, 2),
      organization_id: ORG,
      period,
      metric: "ai_credits",
      value: 1870,
      ...stamp(ago(0, 1)),
    },
    {
      id: demoId(30, 3),
      organization_id: ORG,
      period,
      metric: "scrape_runs",
      value: 312,
      ...stamp(ago(0, 2)),
    },
    { id: demoId(30, 4), organization_id: ORG, period, metric: "flow_runs", value: 96, ...stamp(ago(0, 1)) },
  ];
  const memberships: Row<"memberships">[] = [
    {
      id: demoId(27, 1),
      user_id: DEMO_USER_ID,
      organization_id: ORG,
      reseller_id: null,
      role: "org_owner",
      permissions: {},
      ...stamp(ago(96)),
    },
    {
      id: demoId(27, 2),
      user_id: DEMO_COLLEAGUE_ID,
      organization_id: ORG,
      reseller_id: null,
      role: "org_member",
      permissions: {},
      ...stamp(ago(71)),
    },
  ];
  const invitations: Row<"invitations">[] = [
    {
      id: demoId(28, 1),
      organization_id: ORG,
      email: "matteo.ruggeri@agenziademo.example",
      role: "org_member",
      status: "pending",
      invited_by: DEMO_USER_ID,
      ...stamp(ago(2, 3)),
    },
  ];
  const support_sessions: Row<"support_sessions">[] = [
    {
      id: demoId(34, 1),
      organization_id: ORG,
      admin_user_id: DEMO_STAFF_ID,
      reason: "Verifica del collegamento WhatsApp richiesta dal cliente",
      started_at: ago(12, 4),
      ended_at: ago(12, 3, 30),
      ...stamp(ago(12, 4)),
    },
  ];

  const connectorType = (
    key: string,
    category: string,
    name: string,
    description: string,
    connect_mode: string,
  ): Row<"connector_types"> => ({
    key,
    category,
    name,
    description,
    connect_mode,
    config_schema: {},
    allowed_plans: null,
    is_enabled: true,
    ...stamp(ago(200)),
  });
  const connector_types: Row<"connector_types">[] = [
    connectorType(
      "gmail",
      "mail",
      "Gmail",
      "Legge le mail in arrivo e invia dal tuo indirizzo Gmail.",
      "oauth",
    ),
    connectorType("microsoft365", "mail", "Microsoft 365", "Posta di Outlook ed Exchange Online.", "oauth"),
    connectorType(
      "imap_smtp",
      "mail",
      "Altra casella (IMAP/SMTP)",
      "Qualsiasi casella con accesso IMAP e SMTP.",
      "credentials",
    ),
    connectorType(
      "whatsapp_meta",
      "whatsapp",
      "WhatsApp Business (Meta)",
      "API ufficiale di Meta con modelli approvati.",
      "api_key",
    ),
    connectorType(
      "whatsapp_wawebapi",
      "whatsapp",
      "WhatsApp via QR (waWebApi)",
      "Collega il numero inquadrando un codice QR.",
      "qr",
    ),
    connectorType(
      "crm_rest",
      "crm",
      "Gestionale (API)",
      "Legge e scrive sul gestionale tramite la sua API.",
      "api_key",
    ),
    connectorType(
      "webhook_inbound",
      "crm",
      "Webhook in ingresso",
      "Riceve eventi dal tuo sito o gestionale.",
      "webhook",
    ),
    connectorType(
      "google_calendar",
      "calendar",
      "Google Calendar",
      "Legge gli orari liberi e fissa appuntamenti.",
      "oauth",
    ),
    connectorType(
      "meta_social",
      "social",
      "Facebook e Instagram",
      "Contatti dai moduli, messaggi, commenti e post.",
      "oauth",
    ),
    connectorType(
      "ghl_social",
      "social",
      "GoHighLevel",
      "Usa un sotto-account GoHighLevel come ponte verso i social.",
      "api_key",
    ),
    connectorType("sms_twilio", "sms", "SMS (Twilio)", "Invio e ricezione di SMS.", "api_key"),
    connectorType(
      "scraper_site",
      "scraper",
      "Sito o portale",
      "Legge le novità da un sito a orari fissi.",
      "credentials",
    ),
    connectorType("payment_stripe", "payment", "Pagamenti (Stripe)", "Crea link di pagamento.", "api_key"),
    connectorType(
      "signature_link",
      "signature",
      "Firma tramite link",
      "Invia un documento da firmare tramite link.",
      "api_key",
    ),
  ];

  // ── Connections ──────────────────────────────────────────────────────────
  const CONN_GMAIL = demoId(5, 1);
  const CONN_WHATSAPP = demoId(5, 2);
  const CONN_CALENDAR = demoId(5, 3);
  const CONN_WEBHOOK = demoId(5, 4);
  const connections: Row<"connections">[] = [
    {
      id: CONN_GMAIL,
      organization_id: ORG,
      connector_type: "gmail",
      name: "Gmail · preventivi",
      status: "active",
      config: { email: "preventivi@agenziademo.example", fromName: "Agenzia Demo" },
      external_account_id: "preventivi@agenziademo.example",
      last_checked_at: ago(0, 0, 12),
      last_error: null,
      webhook_token: "demo-gmail-0001",
      ...stamp(ago(92)),
    },
    {
      id: CONN_WHATSAPP,
      organization_id: ORG,
      connector_type: "whatsapp_meta",
      name: "WhatsApp Business dell'agenzia",
      status: "active",
      config: {
        phoneNumberId: "100000000000001",
        wabaId: "200000000000001",
        displayPhoneNumber: "+39 333 000 0090",
      },
      external_account_id: "100000000000001",
      last_checked_at: ago(0, 0, 25),
      last_error: null,
      webhook_token: "demo-whatsapp-0002",
      ...stamp(ago(90)),
    },
    {
      id: CONN_CALENDAR,
      organization_id: ORG,
      connector_type: "google_calendar",
      name: "Calendario appuntamenti",
      status: "expired",
      config: { calendarId: "appuntamenti@agenziademo.example", timeZone: "Europe/Rome" },
      external_account_id: "appuntamenti@agenziademo.example",
      last_checked_at: ago(1, 6),
      last_error: "L'autorizzazione di Google è scaduta: serve un nuovo accesso per leggere il calendario.",
      webhook_token: "demo-calendar-0003",
      ...stamp(ago(64)),
    },
    {
      id: CONN_WEBHOOK,
      organization_id: ORG,
      connector_type: "webhook_inbound",
      name: "Modulo preventivi del sito",
      status: "active",
      config: { siteUrl: "https://www.agenziademo.example" },
      external_account_id: null,
      last_checked_at: ago(0, 5),
      last_error: null,
      webhook_token: "demo-webhook-0004",
      ...stamp(ago(40)),
    },
  ];

  // ── Message templates and deal stages ────────────────────────────────────
  const TPL_QUOTE = demoId(6, 1);
  const TPL_REMINDER = demoId(6, 2);
  const TPL_RENEWAL = demoId(6, 3);
  const template = (
    id: string,
    channel: string,
    name: string,
    body: string,
    approval_status: string,
    days: number,
    subject: string | null = null,
  ): Row<"message_templates"> => ({
    id,
    organization_id: ORG,
    channel,
    name,
    language: "it",
    subject,
    body,
    approval_status,
    external_name: channel === "whatsapp" ? name : null,
    ...stamp(ago(days)),
  });
  const message_templates: Row<"message_templates">[] = [
    template(
      TPL_QUOTE,
      "whatsapp",
      "preventivo_pronto",
      "Buongiorno {{1}}, abbiamo ricevuto la sua richiesta di preventivo per {{2}}. Le rispondiamo qui su WhatsApp: può scriverci per qualsiasi domanda. Questo è un messaggio automatico.",
      "approved",
      88,
    ),
    template(
      TPL_REMINDER,
      "whatsapp",
      "sollecito_preventivo",
      "Buongiorno {{1}}, le ricordiamo il preventivo per {{2}}. Se ha domande o vuole procedere, ci scriva qui. Questo è un messaggio automatico.",
      "approved",
      88,
    ),
    template(
      TPL_RENEWAL,
      "whatsapp",
      "rinnovo_polizza",
      "Buongiorno {{1}}, la sua polizza {{2}} scade il {{3}}. Vuole che le prepariamo la proposta di rinnovo? Risponda a questo messaggio.",
      "approved",
      55,
    ),
    template(
      demoId(6, 4),
      "whatsapp",
      "auguri_compleanno",
      "Buon compleanno {{1}} da tutta l'Agenzia Demo!",
      "pending",
      3,
    ),
    template(
      demoId(6, 5),
      "mail",
      "Invio documenti di polizza",
      "Gentile {{1}},\nin allegato trova i documenti della polizza {{2}}.\nRestiamo a disposizione.\n\nAgenzia Demo",
      "approved",
      47,
      "I documenti della sua polizza {{2}}",
    ),
  ];

  const STAGE = {
    new: demoId(7, 1),
    quote_sent: demoId(7, 2),
    negotiation: demoId(7, 3),
    won: demoId(7, 4),
    lost: demoId(7, 5),
  };
  const stage = (
    id: string,
    key: string,
    name: string,
    position: number,
    kind: string,
  ): Row<"deal_stages"> => ({
    id,
    organization_id: ORG,
    key,
    name,
    position,
    kind,
    ...stamp(ago(96)),
  });
  const deal_stages: Row<"deal_stages">[] = [
    stage(STAGE.new, "new", "Nuova richiesta", 0, "open"),
    stage(STAGE.quote_sent, "quote_sent", "Proposta inviata", 1, "open"),
    stage(STAGE.negotiation, "negotiation", "In trattativa", 2, "open"),
    stage(STAGE.won, "won", "Chiusa", 3, "won"),
    stage(STAGE.lost, "lost", "Persa", 4, "lost"),
  ];

  // ── Contacts ─────────────────────────────────────────────────────────────
  const granted = (source: string, days: number) => ({ granted: true, at: ago(days), source });
  const contact = (
    n: number,
    full_name: string,
    mail: string | null,
    consents: Json,
    custom_fields: Json,
    memory: string,
    days: number,
    withPhone = true,
  ): Row<"contacts"> => ({
    id: demoId(13, n),
    organization_id: ORG,
    full_name,
    phones: withPhone ? [phone(n)] : [],
    emails: mail ? [mail] : [],
    consents,
    custom_fields,
    external_ids: {},
    memory,
    ...stamp(ago(days)),
  });
  const QUOTE_SOURCE = "Richiesta di preventivo via mail";
  const contacts: Row<"contacts">[] = [
    contact(
      1,
      "Marta Bellandi",
      "marta.bellandi@posta.example",
      { whatsapp: granted(QUOTE_SOURCE, 1), mail: granted("Modulo del sito", 1) },
      { prodotto: "RC auto", targa: "ZZ000AA", citta: "Bologna" },
      "Chiede un preventivo RC auto per una utilitaria del 2019. Preferisce essere contattata dopo le 18.",
      1,
    ),
    contact(
      2,
      "Luca Ferrarini",
      "luca.ferrarini@posta.example",
      { whatsapp: granted(QUOTE_SOURCE, 3) },
      { prodotto: "Polizza casa", citta: "Modena" },
      "Ha appena comprato casa: vuole copertura incendio e furto. Ha chiesto di parlare con una persona per la franchigia.",
      3,
    ),
    contact(
      3,
      "Elena Sorrentini",
      null,
      { whatsapp: granted(QUOTE_SOURCE, 5) },
      { prodotto: "RC auto" },
      "Non ha ancora risposto al preventivo.",
      5,
    ),
    contact(
      4,
      "Davide Marchetto",
      "davide.marchetto@posta.example",
      { mail: granted("Ha scritto per primo", 6) },
      { prodotto: "Polizza infortuni", professione: "Artigiano" },
      "Artigiano, cerca una polizza infortuni. Comunica solo via mail.",
      6,
      false,
    ),
    contact(
      5,
      "Sara Colombini",
      "sara.colombini@posta.example",
      { whatsapp: granted(QUOTE_SOURCE, 0) },
      { prodotto: "RC moto" },
      "",
      0,
    ),
    contact(
      6,
      "Giorgio Pellegrino",
      "giorgio.pellegrino@posta.example",
      { mail: granted("Modulo del sito", 9), whatsapp: granted("Modulo del sito", 9) },
      { prodotto: "Polizza vita", figli: 2 },
      "Due figli piccoli, interessato a una polizza vita ventennale.",
      9,
    ),
    contact(
      7,
      "Chiara Montanari",
      "chiara.montanari@posta.example",
      {
        whatsapp: { granted: false, at: ago(14), source: "Ha scritto STOP su WhatsApp" },
        mail: granted("Modulo del sito", 30),
      },
      { prodotto: "RC auto" },
      "Ha scelto un'altra compagnia. Non vuole più messaggi su WhatsApp.",
      30,
    ),
    contact(
      8,
      "Tommaso Rinaldini",
      "tommaso.rinaldini@posta.example",
      { whatsapp: granted(QUOTE_SOURCE, 2) },
      { prodotto: "RC auto", targa: "ZZ111BB" },
      "Vuole aggiungere la copertura cristalli. Pronto a firmare entro la settimana.",
      2,
    ),
    contact(
      9,
      "Federica Greco",
      "federica.greco@posta.example",
      { mail: granted("Ha scritto per primo", 24), whatsapp: granted(QUOTE_SOURCE, 24) },
      { prodotto: "Polizza casa", cliente_dal: "2021" },
      "Cliente dal 2021. Polizza casa rinnovata.",
      24,
    ),
    contact(
      10,
      "Alessandro Vitali",
      "a.vitali@studiovitali.example",
      { whatsapp: granted("Firmato in agenzia", 45), mail: granted("Firmato in agenzia", 45) },
      { prodotto: "RC professionale", professione: "Commercialista" },
      "Commercialista. RC professionale chiusa il mese scorso.",
      45,
    ),
    contact(
      11,
      "Ilaria Fontanesi",
      "ilaria.fontanesi@posta.example",
      { whatsapp: granted("Modulo del sito", 0) },
      { prodotto: "Polizza viaggio" },
      "",
      0,
    ),
    contact(12, "Stefano Barbieri", "stefano.barbieri@posta.example", {}, {}, "", 18, false),
    contact(
      13,
      "Noemi Carrara",
      null,
      { whatsapp: granted("Rinnovo in agenzia", 60) },
      { prodotto: "RC auto", scadenza: "fine mese" },
      "Polizza RC auto in scadenza a fine mese.",
      60,
    ),
    contact(
      14,
      "Officina Due Torri",
      "amministrazione@officinaduetorri.example",
      { whatsapp: granted(QUOTE_SOURCE, 4), mail: granted(QUOTE_SOURCE, 4) },
      { prodotto: "Flotta aziendale", veicoli: 6, referente: "Sig.ra Bassi" },
      "Officina con sei veicoli aziendali. Referente: sig.ra Bassi, amministrazione.",
      4,
    ),
  ];
  const C = (n: number) => demoId(13, n);

  // ── Flows ────────────────────────────────────────────────────────────────
  const insurance = FLOW_TEMPLATES.find((item) => item.key === "insurance_quote_followup");
  if (!insurance) throw new Error("demo fixtures: the insurance flow template is missing in packages/core");
  const copy = (definition: FlowDefinition): FlowDefinition => JSON.parse(JSON.stringify(definition));
  const pilotV1 = copy(insurance.definition);
  const pilotV2 = copy(insurance.definition);
  const waitAgain = pilotV2.steps.find((step) => step.id === "wait_again");
  if (waitAgain) waitAgain.params = { ...waitAgain.params, timeout: "48h" };
  const pilotV3 = copy(pilotV2);
  const notify = pilotV3.steps.find((step) => step.id === "notify");
  if (notify) {
    notify.params = {
      ...notify.params,
      message:
        "{{contact.full_name}} aspetta di essere richiamato per il preventivo {{steps.extract.output.data.product}}.",
    };
  }
  const renewalDefinition: FlowDefinition = {
    trigger: { event: "custom.policy.expiring", connection: CONN_WEBHOOK, filters: [] },
    steps: [
      {
        id: "contact",
        block: "contact.upsert",
        params: { name: "{{event.payload.name}}", phone: "{{event.payload.phone}}" },
      },
      {
        id: "approve",
        block: "human.request_approval",
        params: {
          summary:
            "Inviare a {{contact.full_name}} la proposta di rinnovo della polizza {{event.payload.policy}}?",
          timeout: "48h",
        },
        onApproved: "send",
        onRejected: "end",
        onTimeout: "end",
      },
      {
        id: "send",
        block: "whatsapp.send_template",
        params: {
          template: "rinnovo_polizza",
          variables: {
            "1": "{{contact.full_name}}",
            "2": "{{event.payload.policy}}",
            "3": "{{event.payload.expires}}",
          },
        },
      },
      { id: "wait_reply", block: "wait.for_reply", params: { timeout: "72h" }, onReply: "notify" },
      {
        id: "notify",
        block: "human.notify_owner",
        params: { message: "{{contact.full_name}} ha risposto alla proposta di rinnovo.", via: "app" },
      },
    ],
  };
  const welcomeDefinition: FlowDefinition = {
    trigger: { event: "quote.requested", filters: [] },
    steps: [
      {
        id: "contact",
        block: "contact.upsert",
        params: {
          name: "{{event.payload.name}}",
          phone: "{{event.payload.phone}}",
          email: "{{event.payload.email}}",
          consent: { channel: "whatsapp", source: "Modulo del sito" },
        },
      },
      {
        id: "deal",
        block: "deal.create",
        params: { title: "{{event.payload.product}} · {{contact.full_name}}", stage: "new" },
      },
      {
        id: "notify",
        block: "human.notify_owner",
        params: { message: "Nuova richiesta dal sito: {{contact.full_name}}, {{event.payload.product}}." },
      },
    ],
  };

  const FLOW_PILOT = demoId(8, 1);
  const FLOW_RENEWAL = demoId(8, 2);
  const FLOW_WELCOME = demoId(8, 3);
  const V_PILOT_1 = demoId(9, 1);
  const V_PILOT_2 = demoId(9, 2);
  const V_PILOT_3 = demoId(9, 3);
  const V_RENEWAL = demoId(9, 4);
  const V_WELCOME = demoId(9, 5);
  const flows: Row<"flows">[] = [
    {
      id: FLOW_PILOT,
      organization_id: ORG,
      name: insurance.name,
      description: insurance.description,
      status: "active",
      active_version_id: V_PILOT_3,
      trigger_event: "mail.received",
      template_key: insurance.key,
      created_at: ago(86),
      updated_at: ago(8),
    },
    {
      id: FLOW_RENEWAL,
      organization_id: ORG,
      name: "Rinnovo delle polizze in scadenza",
      description:
        "Quando il gestionale segnala una polizza in scadenza chiede conferma a una persona, poi propone il rinnovo su WhatsApp.",
      status: "paused",
      active_version_id: V_RENEWAL,
      trigger_event: "custom.policy.expiring",
      template_key: null,
      created_at: ago(54),
      updated_at: ago(1, 2),
    },
    {
      id: FLOW_WELCOME,
      organization_id: ORG,
      name: "Richieste dal modulo del sito",
      description: "Registra chi compila il modulo del sito, apre la trattativa e avvisa il titolare.",
      status: "draft",
      active_version_id: null,
      trigger_event: "quote.requested",
      template_key: null,
      created_at: ago(2, 5),
      updated_at: ago(2, 5),
    },
  ];
  const version = (
    id: string,
    flow_id: string,
    n: number,
    definition: FlowDefinition,
    author_type: string,
    author_id: string | null,
    note: string,
    days: number,
  ): Row<"flow_versions"> => ({
    id,
    organization_id: ORG,
    flow_id,
    version: n,
    definition: definition as unknown as Json,
    author_type,
    author_id,
    note,
    ...stamp(ago(days)),
  });
  const flow_versions: Row<"flow_versions">[] = [
    version(V_PILOT_1, FLOW_PILOT, 1, pilotV1, "system", null, "Installato dal modello del settore", 86),
    version(
      V_PILOT_2,
      FLOW_PILOT,
      2,
      pilotV2,
      "ai",
      DEMO_USER_ID,
      "Dopo il sollecito aspetta 48 ore invece di 72 prima di avvisare il titolare",
      30,
    ),
    version(V_PILOT_3, FLOW_PILOT, 3, pilotV3, "user", DEMO_USER_ID, "Testo dell'avviso al titolare", 8),
    version(V_RENEWAL, FLOW_RENEWAL, 1, renewalDefinition, "ai", DEMO_USER_ID, "Creato con l'assistente", 54),
    version(V_WELCOME, FLOW_WELCOME, 1, welcomeDefinition, "ai", DEMO_USER_ID, "Creato con l'assistente", 2),
  ];
  const flow_templates: Row<"flow_templates">[] = FLOW_TEMPLATES.map((item, index) => ({
    id: demoId(32, index + 1),
    key: item.key,
    sector: item.sector,
    name: item.name,
    description: item.description,
    definition: item.definition as unknown as Json,
    requirements: item.requirements as unknown as Json,
    is_published: true,
    ...stamp(ago(150)),
  }));

  // ── Events, runs and their steps ─────────────────────────────────────────
  const mailEvent = (
    n: number,
    who: { name: string; mail: string; phone: string; product: string },
    at: string,
    status = "processed",
  ): Row<"events"> => ({
    id: demoId(12, n),
    organization_id: ORG,
    type: "mail.received",
    connection_id: CONN_GMAIL,
    payload: {
      from: who.mail,
      fromName: who.name,
      to: "preventivi@agenziademo.example",
      subject: `Richiesta preventivo ${who.product}`,
      text: `Buongiorno, vorrei un preventivo per ${who.product}. Mi chiamo ${who.name}, il mio numero è ${who.phone}. Grazie.`,
      messageId: `demo-mail-${n}`,
    },
    contact_hint: { email: who.mail },
    dedupe_key: `gmail:demo-mail-${n}`,
    status,
    attempts: 1,
    locked_until: null,
    available_at: at,
    error: null,
    occurred_at: at,
    processed_at: status === "processed" ? at : null,
    created_by: null,
    ...stamp(at),
  });
  const renewalEvent = (n: number, name: string, tel: string, at: string): Row<"events"> => ({
    id: demoId(12, n),
    organization_id: ORG,
    type: "custom.policy.expiring",
    connection_id: CONN_WEBHOOK,
    payload: { name, phone: tel, policy: "RC auto", expires: "fine mese" },
    contact_hint: { phone: tel },
    dedupe_key: `webhook:demo-policy-${n}`,
    status: "processed",
    attempts: 1,
    locked_until: null,
    available_at: at,
    error: null,
    occurred_at: at,
    processed_at: at,
    created_by: null,
    ...stamp(at),
  });
  const people = {
    marta: {
      name: "Marta Bellandi",
      mail: "marta.bellandi@posta.example",
      phone: "333 000 0001",
      product: "RC auto",
    },
    luca: {
      name: "Luca Ferrarini",
      mail: "luca.ferrarini@posta.example",
      phone: "333 000 0002",
      product: "polizza casa",
    },
    elena: {
      name: "Elena Sorrentini",
      mail: "elena.sorrentini@posta.example",
      phone: "333 000 0003",
      product: "RC auto",
    },
    sara: {
      name: "Sara Colombini",
      mail: "sara.colombini@posta.example",
      phone: "333 000 0005",
      product: "RC moto",
    },
    tommaso: {
      name: "Tommaso Rinaldini",
      mail: "tommaso.rinaldini@posta.example",
      phone: "333 000 0008",
      product: "RC auto",
    },
    officina: {
      name: "Officina Due Torri",
      mail: "amministrazione@officinaduetorri.example",
      phone: "333 000 0014",
      product: "flotta aziendale",
    },
  };
  const events: Row<"events">[] = [
    mailEvent(1, people.marta, ago(1, 2)),
    mailEvent(2, people.luca, ago(3, 1)),
    mailEvent(3, people.elena, ago(5, 3)),
    mailEvent(4, people.sara, ago(0, 3)),
    mailEvent(5, people.tommaso, ago(2, 6)),
    mailEvent(6, people.officina, ago(4, 2)),
    renewalEvent(7, "Noemi Carrara", phone(13), ago(1, 5)),
    renewalEvent(8, "Federica Greco", phone(9), ago(6)),
    renewalEvent(9, "Chiara Montanari", phone(7), ago(15)),
    {
      ...mailEvent(10, people.marta, ago(0, 6), "ignored"),
      payload: {
        from: "newsletter@notizie.example",
        fromName: "Notizie del settore",
        to: "preventivi@agenziademo.example",
        subject: "Le novità della settimana",
        text: "Le novità della settimana per gli intermediari.",
        messageId: "demo-mail-10",
      },
      contact_hint: null,
    },
  ];
  const E = (n: number) => demoId(12, n);

  const RUN = (n: number) => demoId(10, n);
  const CONV = (n: number) => demoId(14, n);
  const DEAL = (n: number) => demoId(16, n);
  const run = (
    n: number,
    values: Partial<Row<"flow_runs">> &
      Pick<Row<"flow_runs">, "flow_id" | "flow_version_id" | "status" | "started_at">,
  ): Row<"flow_runs"> => ({
    id: RUN(n),
    organization_id: ORG,
    event_id: null,
    mode: "live",
    current_step_id: null,
    context: {},
    contact_id: null,
    conversation_id: null,
    deal_id: null,
    waiting_for: null,
    wait_until: null,
    attempts: 0,
    locked_until: null,
    error: null,
    finished_at: null,
    created_at: values.started_at,
    updated_at: values.finished_at ?? values.started_at,
    ...values,
  });
  const pilot = { flow_id: FLOW_PILOT, flow_version_id: V_PILOT_3 };
  const renewal = { flow_id: FLOW_RENEWAL, flow_version_id: V_RENEWAL };
  const SARA_ERROR =
    "WhatsApp ha rifiutato il messaggio: il numero +39 333 000 0005 non risulta attivo su WhatsApp.";
  const flow_runs: Row<"flow_runs">[] = [
    run(1, {
      ...pilot,
      event_id: E(1),
      status: "waiting",
      started_at: ago(1, 2),
      current_step_id: "answer",
      waiting_for: "reply",
      wait_until: ahead(0, 20),
      contact_id: C(1),
      conversation_id: CONV(1),
      deal_id: DEAL(1),
    }),
    run(2, {
      ...pilot,
      event_id: E(2),
      status: "completed",
      started_at: ago(3, 1),
      finished_at: ago(2, 20),
      contact_id: C(2),
      conversation_id: CONV(2),
      deal_id: DEAL(2),
    }),
    run(3, {
      ...pilot,
      event_id: E(3),
      status: "waiting",
      started_at: ago(5, 3),
      current_step_id: "wait_again",
      waiting_for: "reply",
      wait_until: ahead(0, 9),
      contact_id: C(3),
      conversation_id: CONV(3),
      deal_id: DEAL(3),
    }),
    run(4, {
      ...pilot,
      event_id: E(4),
      status: "failed",
      started_at: ago(0, 3),
      finished_at: ago(0, 3),
      current_step_id: "send_quote",
      error: SARA_ERROR,
      contact_id: C(5),
      conversation_id: CONV(5),
    }),
    run(5, {
      ...pilot,
      event_id: E(5),
      status: "completed",
      started_at: ago(2, 6),
      finished_at: ago(2, 4),
      contact_id: C(8),
      conversation_id: CONV(8),
      deal_id: DEAL(8),
    }),
    run(6, {
      ...pilot,
      event_id: E(6),
      status: "waiting",
      started_at: ago(4, 2),
      current_step_id: "wait_reply",
      waiting_for: "reply",
      wait_until: ahead(0, 3),
      contact_id: C(14),
      conversation_id: CONV(10),
      deal_id: DEAL(12),
    }),
    run(7, {
      ...renewal,
      event_id: E(7),
      status: "waiting",
      started_at: ago(1, 5),
      current_step_id: "approve",
      waiting_for: "approval",
      wait_until: ahead(0, 19),
      contact_id: C(13),
    }),
    run(8, {
      ...renewal,
      event_id: E(8),
      status: "completed",
      started_at: ago(6),
      finished_at: ago(5, 2),
      contact_id: C(9),
      conversation_id: CONV(9),
    }),
    run(9, {
      ...renewal,
      event_id: E(9),
      status: "completed",
      started_at: ago(15),
      finished_at: ago(14, 20),
      contact_id: C(7),
    }),
    run(10, {
      ...pilot,
      mode: "simulation",
      status: "completed",
      started_at: ago(8, 1),
      finished_at: ago(8, 1),
    }),
  ];

  let stepCounter = 0;
  const flow_run_steps: Row<"flow_run_steps">[] = [];
  const addSteps = (
    runNumber: number,
    startedAt: string,
    steps: {
      id: string;
      block: string;
      input: Json;
      output: Json;
      outlet?: string | null;
      status?: string;
      error?: string | null;
      ai?: number;
      ms?: number;
    }[],
  ) => {
    const base = new Date(startedAt).getTime();
    steps.forEach((step, index) => {
      stepCounter += 1;
      const at = new Date(base + index * 4000).toISOString();
      flow_run_steps.push({
        id: demoId(11, stepCounter),
        organization_id: ORG,
        flow_run_id: RUN(runNumber),
        step_id: step.id,
        idempotency_key: `${RUN(runNumber)}:${step.id}`,
        block: step.block,
        input: step.input,
        output: step.output,
        outlet: step.outlet === undefined ? "next" : step.outlet,
        status: step.status ?? "succeeded",
        error: step.error ?? null,
        ai_cost_micros: step.ai ?? 0,
        duration_ms: step.ms ?? 180,
        ...stamp(at),
      });
    });
  };
  const extractFields = [
    { name: "name", type: "string", required: true },
    { name: "phone", type: "string", required: true },
    { name: "email", type: "string", required: false },
    { name: "product", type: "string", required: true },
  ];
  /** The first four steps of the pilot flow, as the engine writes them. */
  const pilotOpening = (
    who: { name: string; mail: string; phone: string; product: string },
    /** Conversation number: the quote is its first message (`n * 100 + 1`). */
    n: number,
    contactNumber: number,
    dealNumber: number | null,
    quoteText: string,
  ) => {
    const tel = phone(contactNumber);
    const product = who.product;
    return [
      {
        id: "extract",
        block: "ai.extract",
        input: {
          text: `Buongiorno, vorrei un preventivo per ${who.product}. Mi chiamo ${who.name}, il mio numero è ${who.phone}. Grazie.`,
          fields: extractFields,
        },
        output: { data: { name: who.name, phone: who.phone, email: who.mail, product }, missing: [] },
        ai: 4200,
        ms: 1350,
      },
      {
        id: "contact",
        block: "contact.upsert",
        input: {
          name: who.name,
          phone: tel,
          email: who.mail,
          fields: { prodotto: product },
          consent: { channel: "whatsapp", source: QUOTE_SOURCE },
        },
        output: { created: true, contactId: C(contactNumber) },
      },
      {
        id: "send_quote",
        block: "whatsapp.send_template",
        input: { template: "preventivo_pronto", variables: { "1": who.name, "2": product } },
        output: { text: quoteText, messageId: demoId(15, n * 100 + 1), externalId: `wamid.demo-${n}-1` },
        ms: 640,
      },
      ...(dealNumber === null
        ? []
        : [
            {
              id: "deal",
              block: "deal.create",
              input: {
                title: `Preventivo ${product} · ${who.name}`,
                stage: "quote_sent",
                nextAction: "Attendere la risposta del cliente",
              },
              output: { dealId: DEAL(dealNumber) },
            },
          ]),
    ];
  };
  const quoteText = (name: string, product: string) =>
    `Buongiorno ${name}, abbiamo ricevuto la sua richiesta di preventivo per ${product}. Le rispondiamo qui su WhatsApp: può scriverci per qualsiasi domanda. Questo è un messaggio automatico.`;
  const reminderText = (name: string, product: string) =>
    `Buongiorno ${name}, le ricordiamo il preventivo per ${product}. Se ha domande o vuole procedere, ci scriva qui. Questo è un messaggio automatico.`;
  const answerInput = {
    scope:
      "Domande sul preventivo assicurativo richiesto: coperture, franchigie, documenti necessari, tempi e modalità per procedere. Non comunicare prezzi che non sono stati forniti.",
    maxTurns: 6,
    idleTimeout: "24h",
  };

  // Run 1 — Marta: the AI is answering, waiting for her next message.
  addSteps(1, ago(1, 2), [
    ...pilotOpening(people.marta, 1, 1, 1, quoteText("Marta Bellandi", "RC auto")),
    {
      id: "wait_reply",
      block: "wait.for_reply",
      input: { timeout: "48h" },
      output: { text: "Buongiorno, la polizza copre anche il furto?", messageId: demoId(15, 102) },
      outlet: "onReply",
    },
    {
      id: "answer",
      block: "ai.reply",
      input: answerInput,
      output: {
        lastReply:
          "Sì, la garanzia cristalli si può aggiungere: copre la sostituzione e la riparazione dei vetri. Vuole che la inserisca nel preventivo?",
        outcome: "continue",
        reason: "Il contatto può avere altre domande sul preventivo.",
        turns: 2,
      },
      outlet: null,
      status: "waiting",
      ai: 9800,
      ms: 2100,
    },
  ]);
  // Run 2 — Luca: asked for a person, the owner was notified.
  addSteps(2, ago(3, 1), [
    ...pilotOpening(people.luca, 2, 2, 2, quoteText("Luca Ferrarini", "polizza casa")),
    {
      id: "wait_reply",
      block: "wait.for_reply",
      input: { timeout: "48h" },
      output: { text: "Buonasera, qual è la franchigia per il furto?", messageId: demoId(15, 202) },
      outlet: "onReply",
    },
    {
      id: "answer",
      block: "ai.reply",
      input: answerInput,
      output: {
        lastReply:
          "La metto in contatto con un collega dell'agenzia che le spiega la franchigia nel dettaglio: la richiamiamo in giornata.",
        outcome: "handoff",
        reason: "Il contatto ha chiesto di parlare con una persona.",
        turns: 2,
      },
      outlet: "onHandoff",
      ai: 10400,
      ms: 1900,
    },
    {
      id: "notify",
      block: "human.notify_owner",
      input: {
        via: "app",
        message: "Luca Ferrarini aspetta di essere richiamato per il preventivo polizza casa.",
      },
      output: { via: "app", sent: true, notificationId: demoId(20, 2) },
    },
  ]);
  // Run 3 — Elena: no answer, reminder sent, still waiting.
  addSteps(3, ago(5, 3), [
    ...pilotOpening(people.elena, 3, 3, 3, quoteText("Elena Sorrentini", "RC auto")),
    { id: "wait_reply", block: "wait.for_reply", input: { timeout: "48h" }, output: {}, outlet: "onTimeout" },
    {
      id: "reminder",
      block: "whatsapp.send_template",
      input: { template: "sollecito_preventivo", variables: { "1": "Elena Sorrentini", "2": "RC auto" } },
      output: {
        text: reminderText("Elena Sorrentini", "RC auto"),
        messageId: demoId(15, 302),
        externalId: "wamid.demo-3-2",
      },
      ms: 590,
    },
    {
      id: "wait_again",
      block: "wait.for_reply",
      input: { timeout: "48h" },
      output: {},
      outlet: null,
      status: "waiting",
    },
  ]);
  // Run 4 — Sara: WhatsApp refused the number.
  addSteps(4, ago(0, 3), [
    ...pilotOpening(people.sara, 5, 5, null, "").slice(0, 2),
    {
      id: "send_quote",
      block: "whatsapp.send_template",
      input: { template: "preventivo_pronto", variables: { "1": "Sara Colombini", "2": "RC moto" } },
      output: {},
      outlet: null,
      status: "failed",
      error: SARA_ERROR,
      ms: 410,
    },
  ]);
  // Run 5 — Tommaso: answered, moved to negotiation.
  addSteps(5, ago(2, 6), [
    ...pilotOpening(people.tommaso, 8, 8, 8, quoteText("Tommaso Rinaldini", "RC auto")),
    {
      id: "wait_reply",
      block: "wait.for_reply",
      input: { timeout: "48h" },
      output: { text: "Buongiorno, posso aggiungere la copertura cristalli?", messageId: demoId(15, 802) },
      outlet: "onReply",
    },
    {
      id: "answer",
      block: "ai.reply",
      input: answerInput,
      output: {
        lastReply:
          "Perfetto, aggiungo la garanzia cristalli al preventivo. Un collega le invia la proposta aggiornata.",
        outcome: "done",
        reason: "Il contatto ha confermato di voler procedere.",
        turns: 1,
      },
      ai: 8700,
      ms: 1750,
    },
    {
      id: "negotiation",
      block: "deal.update_stage",
      input: { stage: "negotiation", nextAction: "Chiudere la polizza" },
      output: { stage: "negotiation", dealId: DEAL(8) },
    },
  ]);
  // Run 6 — Officina Due Torri: quote sent, waiting for the first answer.
  addSteps(6, ago(4, 2), [
    ...pilotOpening(people.officina, 10, 14, 12, quoteText("Officina Due Torri", "flotta aziendale")),
    {
      id: "wait_reply",
      block: "wait.for_reply",
      input: { timeout: "48h" },
      output: {},
      outlet: null,
      status: "waiting",
    },
  ]);
  // Runs 7–9 — renewals: one waits for a person, two were decided.
  const renewalSummary = (name: string) => `Inviare a ${name} la proposta di rinnovo della polizza RC auto?`;
  addSteps(7, ago(1, 5), [
    {
      id: "contact",
      block: "contact.upsert",
      input: { name: "Noemi Carrara", phone: phone(13) },
      output: { created: false, contactId: C(13) },
    },
    {
      id: "approve",
      block: "human.request_approval",
      input: { summary: renewalSummary("Noemi Carrara"), timeout: "48h" },
      output: { approvalId: demoId(21, 1) },
      outlet: null,
      status: "waiting",
    },
  ]);
  addSteps(8, ago(6), [
    {
      id: "contact",
      block: "contact.upsert",
      input: { name: "Federica Greco", phone: phone(9) },
      output: { created: false, contactId: C(9) },
    },
    {
      id: "approve",
      block: "human.request_approval",
      input: { summary: renewalSummary("Federica Greco"), timeout: "48h" },
      output: { approvalId: demoId(21, 2), decision: "approved" },
      outlet: "onApproved",
    },
    {
      id: "send",
      block: "whatsapp.send_template",
      input: {
        template: "rinnovo_polizza",
        variables: { "1": "Federica Greco", "2": "RC auto", "3": "fine mese" },
      },
      output: {
        text: "Buongiorno Federica Greco, la sua polizza RC auto scade il fine mese. Vuole che le prepariamo la proposta di rinnovo? Risponda a questo messaggio.",
        messageId: demoId(15, 901),
        externalId: "wamid.demo-9-1",
      },
    },
    {
      id: "wait_reply",
      block: "wait.for_reply",
      input: { timeout: "72h" },
      output: { text: "Sì grazie, procedete pure.", messageId: demoId(15, 902) },
      outlet: "onReply",
    },
    {
      id: "notify",
      block: "human.notify_owner",
      input: { via: "app", message: "Federica Greco ha risposto alla proposta di rinnovo." },
      output: { via: "app", sent: true, notificationId: demoId(20, 6) },
    },
  ]);
  addSteps(9, ago(15), [
    {
      id: "contact",
      block: "contact.upsert",
      input: { name: "Chiara Montanari", phone: phone(7) },
      output: { created: false, contactId: C(7) },
    },
    {
      id: "approve",
      block: "human.request_approval",
      input: { summary: renewalSummary("Chiara Montanari"), timeout: "48h" },
      output: { approvalId: demoId(21, 3), decision: "rejected" },
      outlet: "onRejected",
    },
  ]);
  // Run 10 — a simulation of the pilot flow (nothing was sent).
  addSteps(10, ago(8, 1), [
    {
      id: "extract",
      block: "ai.extract",
      input: { text: "Vorrei un preventivo RC auto. Maria Prova, 333 000 0099.", fields: extractFields },
      output: { data: { name: "Maria Prova", phone: "3330000099", product: "RC auto" }, missing: ["email"] },
      status: "simulated",
      ai: 4200,
    },
    {
      id: "contact",
      block: "contact.upsert",
      input: {
        name: "Maria Prova",
        phone: phone(99),
        fields: { prodotto: "RC auto" },
        consent: { channel: "whatsapp", source: QUOTE_SOURCE },
      },
      output: {
        contact: {
          id: null,
          name: "Maria Prova",
          phone: phone(99),
          fields: { prodotto: "RC auto" },
          full_name: "Maria Prova",
          custom_fields: { prodotto: "RC auto" },
          consents: { whatsapp: { at: ago(8, 1), source: QUOTE_SOURCE, granted: true } },
        },
        created: true,
        contactId: null,
        simulated: true,
      },
      status: "simulated",
    },
    {
      id: "send_quote",
      block: "whatsapp.send_template",
      input: { template: "preventivo_pronto", variables: { "1": "Maria Prova", "2": "RC auto" } },
      output: {
        to: phone(99),
        text: quoteText("Maria Prova", "RC auto"),
        channel: "whatsapp",
        template: "preventivo_pronto",
        warnings: [],
        messageId: null,
        simulated: true,
      },
      status: "simulated",
    },
    {
      id: "deal",
      block: "deal.create",
      input: {
        title: "Preventivo RC auto · Maria Prova",
        stage: "quote_sent",
        nextAction: "Attendere la risposta del cliente",
      },
      output: {
        deal: {
          id: null,
          stage: "quote_sent",
          title: "Preventivo RC auto · Maria Prova",
          value: null,
          next_action: "Attendere la risposta del cliente",
          custom_fields: {},
        },
        dealId: null,
        simulated: true,
      },
      status: "simulated",
    },
    {
      id: "wait_reply",
      block: "wait.for_reply",
      input: { timeout: "48h" },
      output: { text: "Risposta di prova del contatto.", messageId: null, simulated: true },
      outlet: "onReply",
      status: "simulated",
    },
    {
      id: "answer",
      block: "ai.reply",
      input: answerInput,
      output: {
        lastReply: "Buongiorno, certo: le spiego volentieri le coperture comprese nel preventivo.",
        outcome: "done",
        turns: 1,
        simulated: true,
      },
      status: "simulated",
      ai: 9100,
    },
    {
      id: "negotiation",
      block: "deal.update_stage",
      input: { stage: "negotiation", nextAction: "Chiudere la polizza" },
      output: { stage: "negotiation", dealId: null, simulated: true },
      status: "simulated",
    },
  ]);

  // ── Conversations and messages ───────────────────────────────────────────
  const conversation = (
    n: number,
    contactNumber: number,
    channel: "whatsapp" | "mail",
    values: Partial<Row<"conversations">> & { last_message_at: string },
  ): Row<"conversations"> => ({
    id: CONV(n),
    organization_id: ORG,
    contact_id: C(contactNumber),
    channel,
    connection_id: channel === "whatsapp" ? CONN_WHATSAPP : CONN_GMAIL,
    status: "open",
    assignee_type: "automation",
    assignee_user_id: null,
    external_thread_id: channel === "mail" ? `demo-thread-${n}` : null,
    window_expires_at: null,
    unread_count: 0,
    created_at: values.last_message_at,
    updated_at: values.last_message_at,
    ...values,
  });
  const conversations: Row<"conversations">[] = [
    conversation(1, 1, "whatsapp", {
      last_message_at: ago(0, 4),
      window_expires_at: ahead(0, 20),
      created_at: ago(1, 2),
    }),
    conversation(2, 2, "whatsapp", {
      last_message_at: ago(0, 0, 35),
      window_expires_at: ahead(0, 23),
      assignee_type: "user",
      assignee_user_id: DEMO_USER_ID,
      unread_count: 2,
      created_at: ago(3, 1),
    }),
    conversation(3, 3, "whatsapp", { last_message_at: ago(2, 3), created_at: ago(5, 3) }),
    conversation(4, 4, "mail", {
      last_message_at: ago(0, 2),
      assignee_type: "user",
      assignee_user_id: DEMO_COLLEAGUE_ID,
      unread_count: 1,
      created_at: ago(6),
    }),
    conversation(5, 5, "whatsapp", { last_message_at: ago(0, 3), created_at: ago(0, 3) }),
    conversation(6, 6, "mail", { last_message_at: ago(8, 2), created_at: ago(9) }),
    conversation(7, 7, "whatsapp", {
      last_message_at: ago(14),
      status: "closed",
      assignee_type: "user",
      assignee_user_id: DEMO_USER_ID,
      window_expires_at: ago(13),
      created_at: ago(30),
    }),
    conversation(8, 8, "whatsapp", {
      last_message_at: ago(0, 1, 10),
      window_expires_at: ahead(0, 22),
      unread_count: 1,
      created_at: ago(2, 6),
    }),
    conversation(9, 9, "whatsapp", {
      last_message_at: ago(5, 2),
      status: "closed",
      window_expires_at: ago(4, 2),
      created_at: ago(6),
    }),
    conversation(10, 14, "whatsapp", { last_message_at: ago(4, 2), created_at: ago(4, 2) }),
  ];

  const messages: Row<"messages">[] = [];
  const message = (
    id: number,
    conversationNumber: number,
    direction: "in" | "out",
    content: string,
    at: string,
    values: Partial<Row<"messages">> = {},
  ) => {
    const channel = conversations.find((item) => item.id === CONV(conversationNumber))?.channel ?? "whatsapp";
    messages.push({
      id: demoId(15, id),
      organization_id: ORG,
      conversation_id: CONV(conversationNumber),
      direction,
      channel,
      content,
      meta: {},
      template_id: null,
      ai_generated: false,
      ai_model: null,
      delivery_status: direction === "in" ? "received" : "read",
      external_id: `demo-msg-${id}`,
      flow_run_id: null,
      sent_by_user_id: null,
      error: null,
      ...stamp(at),
      ...values,
    });
  };
  const AI_MODEL = "claude-haiku-4-5";
  const ai = (runNumber: number): Partial<Row<"messages">> => ({
    ai_generated: true,
    ai_model: AI_MODEL,
    flow_run_id: RUN(runNumber),
  });
  const tpl = (templateId: string, runNumber: number, variables: string[]): Partial<Row<"messages">> => ({
    template_id: templateId,
    flow_run_id: RUN(runNumber),
    meta: { variables },
  });

  // 1 — Marta, WhatsApp, handled by the automation.
  message(
    101,
    1,
    "out",
    quoteText("Marta Bellandi", "RC auto"),
    ago(1, 2),
    tpl(TPL_QUOTE, 1, ["Marta Bellandi", "RC auto"]),
  );
  message(102, 1, "in", "Buongiorno, la polizza copre anche il furto?", ago(0, 5));
  message(
    103,
    1,
    "out",
    "Buongiorno Marta, il preventivo che ha richiesto riguarda la RC auto obbligatoria. La garanzia furto e incendio è facoltativa e si può aggiungere: vuole che gliela inserisca?",
    ago(0, 4, 58),
    ai(1),
  );
  message(104, 1, "in", "Sì grazie. E i cristalli?", ago(0, 4, 5));
  message(
    105,
    1,
    "out",
    "Sì, la garanzia cristalli si può aggiungere: copre la sostituzione e la riparazione dei vetri. Vuole che la inserisca nel preventivo?",
    ago(0, 4),
    { ...ai(1), delivery_status: "delivered" },
  );
  // 2 — Luca, WhatsApp, taken over by a person, two unread.
  message(
    201,
    2,
    "out",
    quoteText("Luca Ferrarini", "polizza casa"),
    ago(3, 1),
    tpl(TPL_QUOTE, 2, ["Luca Ferrarini", "polizza casa"]),
  );
  message(202, 2, "in", "Buonasera, qual è la franchigia per il furto?", ago(2, 21));
  message(
    203,
    2,
    "out",
    "Buonasera Luca, la franchigia dipende dalla formula scelta. Nel preventivo non è ancora indicata: preferisce che gliela spieghi un collega?",
    ago(2, 20, 58),
    ai(2),
  );
  message(204, 2, "in", "Sì, vorrei parlare con una persona.", ago(2, 20, 30));
  message(
    205,
    2,
    "out",
    "La metto in contatto con un collega dell'agenzia che le spiega la franchigia nel dettaglio: la richiamiamo in giornata.",
    ago(2, 20, 29),
    ai(2),
  );
  message(
    206,
    2,
    "out",
    "Buongiorno Luca, sono il titolare dell'agenzia. Con la formula base la franchigia sul furto è di 250 euro; con la formula completa si azzera. Le mando le due proposte a confronto?",
    ago(1, 22),
    { sent_by_user_id: DEMO_USER_ID },
  );
  message(207, 2, "in", "Sì, grazie. Mi interessa la formula completa.", ago(0, 0, 50));
  message(208, 2, "in", "Possiamo sentirci domani mattina?", ago(0, 0, 35));
  // 3 — Elena, WhatsApp, no answer, window closed.
  message(301, 3, "out", quoteText("Elena Sorrentini", "RC auto"), ago(5, 3), {
    ...tpl(TPL_QUOTE, 3, ["Elena Sorrentini", "RC auto"]),
    delivery_status: "delivered",
  });
  message(302, 3, "out", reminderText("Elena Sorrentini", "RC auto"), ago(2, 3), {
    ...tpl(TPL_REMINDER, 3, ["Elena Sorrentini", "RC auto"]),
    delivery_status: "delivered",
  });
  // 4 — Davide, mail, followed by the colleague, one unread.
  message(
    401,
    4,
    "in",
    "Buongiorno,\nsono un artigiano e cerco una polizza infortuni. Potete mandarmi una proposta?\n\nDavide Marchetto",
    ago(6),
    { meta: { subject: "Polizza infortuni per artigiano" } },
  );
  message(
    402,
    4,
    "out",
    "Buongiorno Davide,\ngrazie per averci scritto. Per prepararle la proposta ci serve sapere che attività svolge e se lavora anche in cantiere.\n\nGiulia Ferrante\nAgenzia Demo",
    ago(5, 20),
    {
      meta: { subject: "Re: Polizza infortuni per artigiano" },
      sent_by_user_id: DEMO_COLLEAGUE_ID,
      delivery_status: "sent",
    },
  );
  message(
    403,
    4,
    "in",
    "Sono idraulico, lavoro quasi sempre in cantiere. Vi allego la visura.\n\nDavide",
    ago(0, 2),
    { meta: { subject: "Re: Polizza infortuni per artigiano" } },
  );
  // 5 — Sara, WhatsApp, delivery failed.
  message(501, 5, "out", quoteText("Sara Colombini", "RC moto"), ago(0, 3), {
    ...tpl(TPL_QUOTE, 4, ["Sara Colombini", "RC moto"]),
    delivery_status: "failed",
    error: "Il numero non risulta attivo su WhatsApp.",
    external_id: null,
  });
  // 6 — Giorgio, mail, automation.
  message(
    601,
    6,
    "in",
    "Buongiorno, vorrei informazioni su una polizza vita. Ho due figli piccoli.\n\nGiorgio Pellegrino",
    ago(9),
    { meta: { subject: "Informazioni polizza vita" } },
  );
  message(
    602,
    6,
    "out",
    "Gentile Giorgio,\nin allegato trova i documenti della polizza vita ventennale.\nRestiamo a disposizione.\n\nAgenzia Demo",
    ago(8, 2),
    {
      meta: { subject: "I documenti della sua polizza vita ventennale" },
      sent_by_user_id: DEMO_USER_ID,
      delivery_status: "sent",
    },
  );
  // 7 — Chiara, WhatsApp, closed after she withdrew the consent.
  message(701, 7, "out", quoteText("Chiara Montanari", "RC auto"), ago(30), {
    template_id: TPL_QUOTE,
    meta: { variables: ["Chiara Montanari", "RC auto"] },
  });
  message(702, 7, "in", "Grazie ma ho già scelto un'altra compagnia.", ago(14, 1));
  message(703, 7, "in", "STOP", ago(14));
  // 8 — Tommaso, WhatsApp, automation, one unread.
  message(
    801,
    8,
    "out",
    quoteText("Tommaso Rinaldini", "RC auto"),
    ago(2, 6),
    tpl(TPL_QUOTE, 5, ["Tommaso Rinaldini", "RC auto"]),
  );
  message(802, 8, "in", "Buongiorno, posso aggiungere la copertura cristalli?", ago(2, 4, 5));
  message(
    803,
    8,
    "out",
    "Perfetto, aggiungo la garanzia cristalli al preventivo. Un collega le invia la proposta aggiornata.",
    ago(2, 4),
    ai(5),
  );
  message(804, 8, "in", "Ottimo. Quando posso passare a firmare?", ago(0, 1, 10));
  // 9 — Federica, WhatsApp, renewal, closed.
  message(
    901,
    9,
    "out",
    "Buongiorno Federica Greco, la sua polizza RC auto scade il fine mese. Vuole che le prepariamo la proposta di rinnovo? Risponda a questo messaggio.",
    ago(5, 20),
    tpl(TPL_RENEWAL, 8, ["Federica Greco", "RC auto", "fine mese"]),
  );
  message(902, 9, "in", "Sì grazie, procedete pure.", ago(5, 2));

  // 10 — Officina Due Torri, WhatsApp, quote sent, no answer yet.
  message(1001, 10, "out", quoteText("Officina Due Torri", "flotta aziendale"), ago(4, 2), {
    ...tpl(TPL_QUOTE, 6, ["Officina Due Torri", "flotta aziendale"]),
    delivery_status: "delivered",
  });

  // ── Deals ────────────────────────────────────────────────────────────────
  const deal = (
    n: number,
    contactNumber: number,
    title: string,
    stageId: string,
    value: number | null,
    values: Partial<Row<"deals">> & { created_at: string },
  ): Row<"deals"> => ({
    id: DEAL(n),
    organization_id: ORG,
    contact_id: C(contactNumber),
    title,
    stage_id: stageId,
    estimated_value_cents: value,
    currency: "EUR",
    origin_flow_run_id: null,
    next_action: null,
    next_action_at: null,
    assignee_user_id: null,
    custom_fields: {},
    closed_at: null,
    updated_at: values.created_at,
    ...values,
  });
  const noon = (days: number) => `${ahead(days).slice(0, 10)}T12:00:00.000Z`;
  const deals: Row<"deals">[] = [
    deal(1, 1, "Preventivo RC auto · Marta Bellandi", STAGE.quote_sent, 68000, {
      created_at: ago(1, 2),
      origin_flow_run_id: RUN(1),
      next_action: "Attendere la risposta del cliente",
      next_action_at: noon(1),
      custom_fields: { compagnia: "Compagnia Alfa" },
    }),
    deal(2, 2, "Preventivo polizza casa · Luca Ferrarini", STAGE.negotiation, 42000, {
      created_at: ago(3, 1),
      updated_at: ago(1, 22),
      origin_flow_run_id: RUN(2),
      next_action: "Richiamare per la franchigia",
      next_action_at: noon(1),
      assignee_user_id: DEMO_USER_ID,
      custom_fields: { compagnia: "Compagnia Beta", cliente_storico: false },
    }),
    deal(3, 3, "Preventivo RC auto · Elena Sorrentini", STAGE.quote_sent, 59000, {
      created_at: ago(5, 3),
      origin_flow_run_id: RUN(3),
      next_action: "Attendere la risposta del cliente",
      next_action_at: noon(-1),
    }),
    deal(4, 4, "Polizza infortuni · Davide Marchetto", STAGE.negotiation, 31000, {
      created_at: ago(6),
      updated_at: ago(0, 2),
      next_action: "Preparare la proposta con la visura",
      next_action_at: noon(2),
      assignee_user_id: DEMO_COLLEAGUE_ID,
      custom_fields: { scadenza: ahead(3).slice(0, 10) },
    }),
    deal(5, 5, "Preventivo RC moto · Sara Colombini", STAGE.new, 28000, {
      created_at: ago(0, 3),
      next_action: "Chiamare: il numero non è su WhatsApp",
      next_action_at: noon(0),
      // Her current cover expires soon: it shows up in the "Scadenze" view of the list.
      custom_fields: { targa: "EK482RT", scadenza: ahead(12).slice(0, 10) },
    }),
    deal(6, 6, "Polizza vita ventennale · Giorgio Pellegrino", STAGE.new, 120000, {
      created_at: ago(9),
      next_action: "Fissare un appuntamento in agenzia",
      next_action_at: noon(3),
      assignee_user_id: DEMO_USER_ID,
    }),
    deal(7, 7, "RC auto · Chiara Montanari", STAGE.lost, 52000, {
      created_at: ago(30),
      updated_at: ago(14),
      closed_at: ago(14),
    }),
    deal(8, 8, "Preventivo RC auto · Tommaso Rinaldini", STAGE.negotiation, 74000, {
      created_at: ago(2, 6),
      updated_at: ago(2, 4),
      origin_flow_run_id: RUN(5),
      next_action: "Chiudere la polizza",
      next_action_at: noon(0),
      custom_fields: { compagnia: "Compagnia Alfa", scadenza_polizza: ahead(360).slice(0, 10) },
    }),
    deal(9, 9, "Rinnovo polizza casa · Federica Greco", STAGE.won, 39000, {
      created_at: ago(24),
      updated_at: ago(4),
      closed_at: ago(4),
      assignee_user_id: DEMO_COLLEAGUE_ID,
      custom_fields: { compagnia: "Compagnia Beta", cliente_storico: true },
    }),
    deal(10, 10, "RC professionale · Alessandro Vitali", STAGE.won, 185000, {
      created_at: ago(45),
      updated_at: ago(11),
      closed_at: ago(11),
      assignee_user_id: DEMO_USER_ID,
      custom_fields: { compagnia: "Compagnia Gamma" },
    }),
    deal(11, 11, "Polizza viaggio · Ilaria Fontanesi", STAGE.new, null, {
      created_at: ago(0, 7),
      next_action: "Chiedere date e destinazione",
    }),
    deal(12, 14, "Flotta aziendale · Officina Due Torri", STAGE.quote_sent, 540000, {
      created_at: ago(4, 2),
      origin_flow_run_id: RUN(6),
      next_action: "Attendere la risposta del cliente",
      next_action_at: noon(1),
      assignee_user_id: DEMO_USER_ID,
      custom_fields: { veicoli: 6 },
    }),
  ];
  let dealEventCounter = 0;
  const dealEvent = (
    dealNumber: number,
    type: string,
    at: string,
    values: Partial<Row<"deal_events">> = {},
  ): Row<"deal_events"> => {
    dealEventCounter += 1;
    return {
      id: demoId(17, dealEventCounter),
      organization_id: ORG,
      deal_id: DEAL(dealNumber),
      type,
      from_stage_id: null,
      to_stage_id: null,
      actor_type: "automation",
      actor_id: null,
      data: {},
      ...stamp(at),
      ...values,
    };
  };
  const byUser = (id: string) => ({ actor_type: "user", actor_id: id });
  const deal_events: Row<"deal_events">[] = [
    dealEvent(1, "created", ago(1, 2), { to_stage_id: STAGE.quote_sent }),
    dealEvent(2, "created", ago(3, 1), { to_stage_id: STAGE.quote_sent }),
    dealEvent(2, "stage_changed", ago(1, 22), {
      from_stage_id: STAGE.quote_sent,
      to_stage_id: STAGE.negotiation,
      ...byUser(DEMO_USER_ID),
    }),
    dealEvent(2, "updated", ago(1, 21), {
      ...byUser(DEMO_USER_ID),
      data: { changed: ["next_action", "next_action_at"] },
    }),
    dealEvent(3, "created", ago(5, 3), { to_stage_id: STAGE.quote_sent }),
    dealEvent(4, "created", ago(6), { to_stage_id: STAGE.new, ...byUser(DEMO_COLLEAGUE_ID) }),
    dealEvent(4, "stage_changed", ago(5, 20), {
      from_stage_id: STAGE.new,
      to_stage_id: STAGE.negotiation,
      ...byUser(DEMO_COLLEAGUE_ID),
    }),
    dealEvent(5, "created", ago(0, 3), { to_stage_id: STAGE.new, ...byUser(DEMO_USER_ID) }),
    dealEvent(6, "created", ago(9), { to_stage_id: STAGE.new, ...byUser(DEMO_USER_ID) }),
    dealEvent(7, "created", ago(30), { to_stage_id: STAGE.quote_sent }),
    dealEvent(7, "stage_changed", ago(14), {
      from_stage_id: STAGE.quote_sent,
      to_stage_id: STAGE.lost,
      ...byUser(DEMO_USER_ID),
    }),
    dealEvent(8, "created", ago(2, 6), { to_stage_id: STAGE.quote_sent }),
    dealEvent(8, "stage_changed", ago(2, 4), {
      from_stage_id: STAGE.quote_sent,
      to_stage_id: STAGE.negotiation,
    }),
    dealEvent(9, "created", ago(24), { to_stage_id: STAGE.new, ...byUser(DEMO_COLLEAGUE_ID) }),
    dealEvent(9, "stage_changed", ago(4), {
      from_stage_id: STAGE.new,
      to_stage_id: STAGE.won,
      ...byUser(DEMO_COLLEAGUE_ID),
    }),
    dealEvent(10, "created", ago(45), { to_stage_id: STAGE.new, ...byUser(DEMO_USER_ID) }),
    dealEvent(10, "stage_changed", ago(20), {
      from_stage_id: STAGE.new,
      to_stage_id: STAGE.negotiation,
      ...byUser(DEMO_USER_ID),
    }),
    dealEvent(10, "stage_changed", ago(11), {
      from_stage_id: STAGE.negotiation,
      to_stage_id: STAGE.won,
      ...byUser(DEMO_USER_ID),
    }),
    dealEvent(11, "created", ago(0, 7), { to_stage_id: STAGE.new, ...byUser(DEMO_USER_ID) }),
    dealEvent(12, "created", ago(4, 2), { to_stage_id: STAGE.quote_sent }),
  ];

  const appointmentStart = `${ahead(2).slice(0, 10)}T09:30:00.000Z`;
  const appointments: Row<"appointments">[] = [
    {
      id: demoId(18, 1),
      organization_id: ORG,
      contact_id: C(8),
      deal_id: DEAL(8),
      connection_id: CONN_CALENDAR,
      title: "Firma polizza RC auto · Tommaso Rinaldini",
      starts_at: appointmentStart,
      ends_at: `${appointmentStart.slice(0, 10)}T10:00:00.000Z`,
      location: "In agenzia",
      status: "booked",
      external_event_id: "demo-calendar-event-1",
      ...stamp(ago(2, 3)),
    },
  ];
  const payment_requests: Row<"payment_requests">[] = [
    {
      id: demoId(19, 1),
      organization_id: ORG,
      contact_id: C(10),
      deal_id: DEAL(10),
      connection_id: null,
      amount_cents: 185000,
      currency: "EUR",
      description: "Premio annuale RC professionale",
      status: "paid",
      external_id: "demo-payment-1",
      url: null,
      created_at: ago(12),
      updated_at: ago(11),
    },
  ];

  // ── Notifications, approvals, audit log ──────────────────────────────────
  const notification = (
    n: number,
    kind: string,
    title: string,
    body: string,
    link: string | null,
    at: string,
    read: string | null,
  ): Row<"notifications"> => ({
    id: demoId(20, n),
    organization_id: ORG,
    kind,
    title,
    body,
    link,
    read_at: read,
    ...stamp(at),
  });
  const notifications: Row<"notifications">[] = [
    notification(
      1,
      "error",
      "Un messaggio non è partito",
      `Preventivo per Sara Colombini: ${SARA_ERROR}`,
      `/app/flussi/${FLOW_PILOT}/esecuzioni/${RUN(4)}`,
      ago(0, 3),
      null,
    ),
    notification(
      2,
      "handoff",
      "Luca Ferrarini chiede di parlare con una persona",
      "Luca Ferrarini aspetta di essere richiamato per il preventivo polizza casa.",
      `/app/inbox/${CONV(2)}`,
      ago(2, 20),
      ago(1, 22),
    ),
    notification(
      3,
      "approval",
      "C'è una richiesta da approvare",
      renewalSummary("Noemi Carrara"),
      "/app/approvazioni",
      ago(1, 5),
      null,
    ),
    notification(
      4,
      "connection",
      "Calendario appuntamenti: accesso scaduto",
      "L'autorizzazione di Google è scaduta. I flussi che usano il calendario sono fermi finché non lo ricolleghi.",
      `/app/collegamenti/${CONN_CALENDAR}`,
      ago(1, 6),
      null,
    ),
    notification(
      5,
      "info",
      "Lettura «Bandi e avvisi» riparata",
      "Il sito ha cambiato struttura: il percorso di lettura è stato aggiornato da solo e la lettura è ripartita.",
      `/app/collegamenti/siti/${demoId(24, 1)}`,
      ago(3, 8),
      ago(3, 2),
    ),
    notification(
      6,
      "flow",
      "Federica Greco ha risposto alla proposta di rinnovo",
      "Federica Greco ha risposto alla proposta di rinnovo.",
      `/app/inbox/${CONV(9)}`,
      ago(5, 2),
      ago(5),
    ),
    notification(
      7,
      "report",
      "Il report del mese scorso è pronto",
      "Trattative vinte, messaggi inviati e tempo risparmiato del mese scorso.",
      "/app/report?periodo=mese-scorso",
      ago(3, 12),
      ago(3, 1),
    ),
  ];
  const approvals: Row<"approvals">[] = [
    {
      id: demoId(21, 1),
      organization_id: ORG,
      flow_run_id: RUN(7),
      step_id: "approve",
      summary: renewalSummary("Noemi Carrara"),
      status: "pending",
      decided_by: null,
      decided_at: null,
      ...stamp(ago(1, 5)),
    },
    {
      id: demoId(21, 2),
      organization_id: ORG,
      flow_run_id: RUN(8),
      step_id: "approve",
      summary: renewalSummary("Federica Greco"),
      status: "approved",
      decided_by: DEMO_USER_ID,
      decided_at: ago(5, 20),
      created_at: ago(6),
      updated_at: ago(5, 20),
    },
    {
      id: demoId(21, 3),
      organization_id: ORG,
      flow_run_id: RUN(9),
      step_id: "approve",
      summary: renewalSummary("Chiara Montanari"),
      status: "rejected",
      decided_by: DEMO_COLLEAGUE_ID,
      decided_at: ago(14, 20),
      created_at: ago(15),
      updated_at: ago(14, 20),
    },
  ];
  let auditCounter = 0;
  const audit = (
    action: string,
    entity_type: string | null,
    entity_id: string | null,
    at: string,
    values: Partial<Row<"audit_log">> = {},
  ): Row<"audit_log"> => {
    auditCounter += 1;
    return {
      id: demoId(22, auditCounter),
      organization_id: ORG,
      actor_type: "user",
      actor_id: DEMO_USER_ID,
      action,
      entity_type,
      entity_id,
      data: {},
      is_support_access: false,
      created_at: at,
      ...values,
    };
  };
  const automation = { actor_type: "automation", actor_id: null };
  const support = { actor_type: "admin", actor_id: DEMO_STAFF_ID, is_support_access: true };
  const audit_log: Row<"audit_log">[] = [
    audit("deals.insert", "deals", DEAL(5), ago(0, 3)),
    audit("deals.insert", "deals", DEAL(11), ago(0, 7)),
    audit("flows.update", "flows", FLOW_RENEWAL, ago(1, 2), { data: { changed: ["status"] } }),
    audit("deals.update", "deals", DEAL(2), ago(1, 22), { data: { changed: ["stage_id"] } }),
    audit("invitations.insert", "invitations", demoId(28, 1), ago(2, 3)),
    audit("organization.invite_sent", "invitations", demoId(28, 1), ago(2, 3)),
    audit("flow_versions.insert", "flow_versions", V_WELCOME, ago(2, 5)),
    audit("deals.insert", "deals", DEAL(8), ago(2, 6), automation),
    audit("message_templates.insert", "message_templates", demoId(6, 4), ago(3)),
    audit("contacts.update", "contacts", C(9), ago(4), {
      actor_id: DEMO_COLLEAGUE_ID,
      data: { changed: ["custom_fields"] },
    }),
    audit("job.simulate_flow", "scheduled_jobs", demoId(33, 2), ago(8, 1)),
    audit("flow_versions.insert", "flow_versions", V_PILOT_3, ago(8)),
    audit("support_sessions.insert", "support_sessions", demoId(34, 1), ago(12, 4), support),
    audit("connections.update", "connections", CONN_WHATSAPP, ago(12, 3, 45), {
      ...support,
      data: { changed: ["last_checked_at"] },
    }),
    audit("support_sessions.update", "support_sessions", demoId(34, 1), ago(12, 3, 30), support),
    audit("contacts.update", "contacts", C(7), ago(14), { ...automation, data: { changed: ["consents"] } }),
    audit("contact.export", "contacts", C(7), ago(13)),
  ];

  // ── AI calls (for the report) ────────────────────────────────────────────
  const ai_calls: Row<"ai_calls">[] = [];
  const purposes = ["ai.extract", "ai.reply", "ai.reply", "ai.extract", "ai.reply", "flow_assistant"];
  for (let index = 0; index < 36; index++) {
    const purpose = purposes[index % purposes.length]!;
    const assistant = purpose === "flow_assistant";
    const input = assistant ? 5200 + index * 40 : 900 + ((index * 137) % 700);
    const output = assistant ? 1400 : 180 + ((index * 53) % 260);
    ai_calls.push({
      id: demoId(23, index + 1),
      organization_id: ORG,
      purpose,
      model: assistant ? "claude-sonnet-4-5" : AI_MODEL,
      input_tokens: input,
      output_tokens: output,
      cost_micros: assistant ? 36_000 + index * 150 : 3_800 + ((index * 911) % 6_400),
      credits: assistant ? 12 : purpose === "ai.reply" ? 3 : 1,
      flow_run_id: null,
      flow_run_step_id: null,
      ...stamp(ago(Math.floor(index * 0.8), (index * 5) % 9, 10)),
    });
  }
  ai_calls.push(
    {
      id: demoId(23, 101),
      organization_id: ORG,
      purpose: "scrape_trace",
      model: "claude-sonnet-4-5",
      input_tokens: 18400,
      output_tokens: 2100,
      cost_micros: 86_000,
      credits: 25,
      flow_run_id: null,
      flow_run_step_id: null,
      ...stamp(ago(21)),
    },
    {
      id: demoId(23, 102),
      organization_id: ORG,
      purpose: "scrape_repair",
      model: "claude-sonnet-4-5",
      input_tokens: 12100,
      output_tokens: 1500,
      cost_micros: 58_000,
      credits: 15,
      flow_run_id: null,
      flow_run_step_id: null,
      ...stamp(ago(3, 8)),
    },
  );

  // ── Reading from a site ──────────────────────────────────────────────────
  const RECIPE = demoId(24, 1);
  const RECIPE_V1 = demoId(25, 1);
  const RECIPE_V2 = demoId(25, 2);
  const recipeJson = (listSelector: string): Json => ({
    steps: [
      { action: "goto", url: "https://bandi.portale-demo.example/avvisi" },
      { action: "wait_for", selector: listSelector },
      {
        action: "extract",
        listSelector,
        fields: {
          titolo: { selector: "h3", attr: "text", transform: "trim" },
          scadenza: { selector: ".scadenza", attr: "text", transform: "trim" },
          url: { selector: "a", attr: "href", transform: "absolute_url" },
        },
        paginate: { nextSelector: "a.successiva", maxPages: 3 },
      },
    ],
    output: {
      eventType: "scrape.item.found",
      keyField: "url",
      fields: [
        { name: "titolo", type: "string", required: true },
        { name: "scadenza", type: "string", required: false },
        { name: "url", type: "url", required: true },
      ],
    },
  });
  const scrape_recipes: Row<"scrape_recipes">[] = [
    {
      id: RECIPE,
      organization_id: ORG,
      name: "Bandi e avvisi per le imprese",
      target_url: "https://bandi.portale-demo.example/avvisi",
      goal: "Leggere i nuovi bandi che richiedono una polizza fideiussoria: titolo, scadenza e indirizzo della pagina.",
      connection_id: null,
      status: "active",
      active_version_id: RECIPE_V2,
      interval_minutes: 120,
      repair_attempts: 0,
      last_run_at: ago(0, 1, 20),
      created_at: ago(21),
      updated_at: ago(3, 8),
    },
  ];
  const scrape_recipe_versions: Row<"scrape_recipe_versions">[] = [
    {
      id: RECIPE_V1,
      organization_id: ORG,
      recipe_id: RECIPE,
      version: 1,
      recipe: recipeJson("ul.avvisi > li"),
      generated_by: "ai",
      note: "Prima tracciatura",
      ...stamp(ago(21)),
    },
    {
      id: RECIPE_V2,
      organization_id: ORG,
      recipe_id: RECIPE,
      version: 2,
      recipe: recipeJson("section.elenco-avvisi article"),
      generated_by: "ai",
      note: "Riparata dopo il cambio di struttura del sito",
      ...stamp(ago(3, 8)),
    },
  ];
  const scrapeRun = (
    n: number,
    at: string,
    values: Partial<Row<"scrape_runs">> = {},
  ): Row<"scrape_runs"> => ({
    id: demoId(26, n),
    organization_id: ORG,
    recipe_id: RECIPE,
    recipe_version_id: RECIPE_V2,
    status: "succeeded",
    rows_extracted: 24,
    new_rows: 0,
    error: null,
    needed_repair: false,
    started_at: at,
    finished_at: at,
    ...stamp(at),
    ...values,
  });
  const scrape_runs: Row<"scrape_runs">[] = [
    scrapeRun(1, ago(0, 1, 20), { new_rows: 2, rows_extracted: 26 }),
    scrapeRun(2, ago(0, 3, 20)),
    scrapeRun(3, ago(0, 5, 20), { new_rows: 1, rows_extracted: 24 }),
    scrapeRun(4, ago(1, 1, 20)),
    scrapeRun(5, ago(3, 8), { needed_repair: true, new_rows: 3, rows_extracted: 23 }),
    scrapeRun(6, ago(3, 10), {
      status: "failed",
      recipe_version_id: RECIPE_V1,
      rows_extracted: 0,
      error: "L'elenco degli avvisi non è stato trovato: il sito ha cambiato struttura.",
    }),
    scrapeRun(7, ago(4, 1), { recipe_version_id: RECIPE_V1, rows_extracted: 21 }),
  ];
  const job = (
    n: number,
    kind: string,
    payload: Json,
    at: string,
    dedupe: string,
  ): Row<"scheduled_jobs"> => ({
    id: demoId(33, n),
    organization_id: ORG,
    kind,
    payload,
    run_at: at,
    status: "done",
    attempts: 1,
    locked_until: null,
    last_error: null,
    flow_run_id: null,
    dedupe_key: dedupe,
    created_by: DEMO_USER_ID,
    ...stamp(at),
  });
  const scheduled_jobs: Row<"scheduled_jobs">[] = [
    job(1, "scrape_trace", { recipe_id: RECIPE }, ago(21), `user:scrape_trace:${RECIPE}`),
    job(2, "simulate_flow", { flow_version_id: V_PILOT_3 }, ago(8, 1), `user:simulate_flow:${V_PILOT_3}`),
  ];

  const tables: DemoTables = {
    plans,
    resellers,
    organizations,
    org_settings,
    org_features,
    usage_counters,
    memberships,
    invitations,
    support_sessions,
    connector_types,
    connections,
    message_templates,
    deal_stages,
    contacts,
    flows,
    flow_versions,
    flow_templates,
    events,
    flow_runs,
    flow_run_steps,
    conversations,
    messages,
    deals,
    deal_events,
    appointments,
    payment_requests,
    signature_requests: [],
    notifications,
    approvals,
    audit_log,
    ai_calls,
    scrape_recipes,
    scrape_recipe_versions,
    scrape_runs,
    scheduled_jobs,
    access_requests: [],
    connection_secrets: [],
  };

  const limits = plans[1]!.limits as Record<string, number>;
  const LIMIT_OF: Record<string, string> = {
    messages: "messages_per_month",
    ai_credits: "ai_credits_per_month",
    scrape_runs: "scrape_runs_per_month",
  };
  const rpc: DemoRpcHandlers = {
    quota_left: (args) => {
      const key = LIMIT_OF[String(args.p_metric)];
      const limit = key ? limits[key] : undefined;
      if (limit === undefined || limit < 0) return null;
      const used = usage_counters.find((row) => row.metric === args.p_metric)?.value ?? 0;
      return Math.max(limit - used, 0);
    },
    accept_invitations: () => 0,
    is_platform_admin: () => false,
    has_org_access: (args) => args.p_org === ORG,
    can_manage_org: (args) => args.p_org === ORG,
    export_contact: (args) => {
      const row = contacts.find((item) => item.id === args.p_contact);
      if (!row) return null;
      const threads = conversations.filter((item) => item.contact_id === row.id);
      return {
        contact: row,
        conversations: threads,
        messages: messages.filter((item) => threads.some((thread) => thread.id === item.conversation_id)),
        deals: deals.filter((item) => item.contact_id === row.id),
        appointments: appointments.filter((item) => item.contact_id === row.id),
      } as unknown as Json;
    },
    export_organization: () =>
      ({ organization: organizations[0], contacts, deals, flows, message_templates }) as unknown as Json,
  };

  return { tables, rpc };
}
