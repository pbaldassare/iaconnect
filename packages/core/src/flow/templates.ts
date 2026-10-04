import type { Sector } from "../domain.ts";
import type { FlowDefinition } from "./schema.ts";

/**
 * Sector flow templates published by the platform. They are data: installing
 * one copies the definition into the organization's own flow. The SQL seed in
 * `supabase/migrations` is generated from this file (`npm run gen:seed`).
 */
export interface FlowTemplate {
  key: string;
  sector: Sector;
  name: string;
  description: string;
  definition: FlowDefinition;
  requirements: {
    /** Message templates created (as drafts) when the flow is installed. */
    messageTemplates: { channel: "whatsapp"; name: string; body: string }[];
    /** Connector categories that must be connected before activation. */
    connections: string[];
    /** Custom contact fields the flow reads. */
    contactFields?: string[];
  };
}

export const FLOW_TEMPLATES: FlowTemplate[] = [
  {
    key: "insurance_quote_followup",
    sector: "insurance",
    name: "Preventivo → WhatsApp → trattativa → sollecito",
    description:
      "Quando arriva una richiesta di preventivo via mail, avvisa il cliente su WhatsApp, apre la trattativa, risponde alle domande e sollecita dopo due giorni di silenzio.",
    requirements: {
      connections: ["mail", "whatsapp"],
      messageTemplates: [
        {
          channel: "whatsapp",
          name: "preventivo_pronto",
          body: "Buongiorno {{1}}, abbiamo ricevuto la sua richiesta di preventivo per {{2}}. Le rispondiamo qui su WhatsApp: può scriverci per qualsiasi domanda. Questo è un messaggio automatico.",
        },
        {
          channel: "whatsapp",
          name: "sollecito_preventivo",
          body: "Buongiorno {{1}}, le ricordiamo il preventivo per {{2}}. Se ha domande o vuole procedere, ci scriva qui. Questo è un messaggio automatico.",
        },
      ],
    },
    definition: {
      trigger: {
        event: "mail.received",
        filters: [{ field: "payload.subject", operator: "contains", value: "preventivo" }],
      },
      steps: [
        {
          id: "extract",
          block: "ai.extract",
          params: {
            text: "{{event.payload.text}}",
            fields: [
              {
                name: "name",
                type: "string",
                description: "Nome e cognome di chi chiede il preventivo",
                required: true,
              },
              { name: "phone", type: "string", description: "Numero di cellulare", required: true },
              { name: "email", type: "string", description: "Indirizzo mail", required: false },
              {
                name: "product",
                type: "string",
                description: "Tipo di polizza richiesta, es. RC auto",
                required: true,
              },
            ],
          },
        },
        {
          id: "contact",
          block: "contact.upsert",
          params: {
            name: "{{steps.extract.output.data.name}}",
            phone: "{{steps.extract.output.data.phone}}",
            email: "{{steps.extract.output.data.email}}",
            fields: { prodotto: "{{steps.extract.output.data.product}}" },
            consent: { channel: "whatsapp", source: "Richiesta di preventivo via mail" },
          },
        },
        {
          id: "send_quote",
          block: "whatsapp.send_template",
          params: {
            template: "preventivo_pronto",
            variables: { "1": "{{contact.full_name}}", "2": "{{steps.extract.output.data.product}}" },
          },
        },
        {
          id: "deal",
          block: "deal.create",
          params: {
            title: "Preventivo {{steps.extract.output.data.product}} · {{contact.full_name}}",
            stage: "quote_sent",
            nextAction: "Attendere la risposta del cliente",
          },
        },
        {
          id: "wait_reply",
          block: "wait.for_reply",
          params: { timeout: "48h" },
          onReply: "answer",
          onTimeout: "reminder",
        },
        {
          id: "answer",
          block: "ai.reply",
          params: {
            scope:
              "Domande sul preventivo assicurativo richiesto: coperture, franchigie, documenti necessari, tempi e modalità per procedere. Non comunicare prezzi che non sono stati forniti.",
            maxTurns: 6,
            idleTimeout: "24h",
          },
          next: "negotiation",
          onHandoff: "notify",
        },
        {
          id: "negotiation",
          block: "deal.update_stage",
          params: { stage: "negotiation", nextAction: "Chiudere la polizza" },
          next: "end",
        },
        {
          id: "reminder",
          block: "whatsapp.send_template",
          params: {
            template: "sollecito_preventivo",
            variables: { "1": "{{contact.full_name}}", "2": "{{steps.extract.output.data.product}}" },
          },
        },
        {
          id: "wait_again",
          block: "wait.for_reply",
          params: { timeout: "72h" },
          onReply: "answer",
          onTimeout: "notify",
        },
        {
          id: "notify",
          block: "human.notify_owner",
          params: {
            message:
              "{{contact.full_name}} attende un contatto per il preventivo {{steps.extract.output.data.product}}.",
          },
        },
      ],
    },
  },
  {
    key: "ecommerce_order_followup",
    sector: "ecommerce",
    name: "Ordine → conferma WhatsApp → risposte sullo stato",
    description:
      "Registra l'ordine arrivato via mail, lo conferma al cliente su WhatsApp e risponde alle domande sullo stato leggendo i dati del negozio.",
    requirements: {
      connections: ["mail", "whatsapp", "crm"],
      messageTemplates: [
        {
          channel: "whatsapp",
          name: "conferma_ordine",
          body: "Ciao {{1}}, abbiamo ricevuto il tuo ordine n. {{2}}. Puoi scriverci qui per sapere a che punto è. Questo è un messaggio automatico.",
        },
      ],
    },
    definition: {
      trigger: {
        event: "mail.received",
        filters: [{ field: "payload.subject", operator: "contains", value: "ordine" }],
      },
      steps: [
        {
          id: "extract",
          block: "ai.extract",
          params: {
            text: "{{event.payload.text}}",
            fields: [
              { name: "name", type: "string", description: "Nome del cliente", required: true },
              { name: "phone", type: "string", description: "Numero di cellulare", required: true },
              { name: "email", type: "string", description: "Indirizzo mail", required: false },
              { name: "orderNumber", type: "string", description: "Numero d'ordine", required: true },
              { name: "total", type: "number", description: "Totale dell'ordine in euro", required: false },
            ],
          },
        },
        {
          id: "contact",
          block: "contact.upsert",
          params: {
            name: "{{steps.extract.output.data.name}}",
            phone: "{{steps.extract.output.data.phone}}",
            email: "{{steps.extract.output.data.email}}",
            consent: { channel: "whatsapp", source: "Ordine sul negozio online" },
          },
        },
        {
          id: "deal",
          block: "deal.create",
          params: {
            title: "Ordine {{steps.extract.output.data.orderNumber}}",
            stage: "new",
            value: "{{steps.extract.output.data.total}}",
            fields: { orderNumber: "{{steps.extract.output.data.orderNumber}}" },
          },
        },
        {
          id: "confirm",
          block: "whatsapp.send_template",
          params: {
            template: "conferma_ordine",
            variables: { "1": "{{contact.full_name}}", "2": "{{steps.extract.output.data.orderNumber}}" },
          },
        },
        { id: "wait_reply", block: "wait.for_reply", params: { timeout: "14d" }, onReply: "answer" },
        {
          id: "answer",
          block: "ai.reply",
          params: {
            scope: "Domande sullo stato dell'ordine, sulla spedizione e sui tempi di consegna.",
            maxTurns: 8,
            idleTimeout: "48h",
            readResources: [
              {
                resource: "orders",
                description: "Ordini del negozio: cerca per numero d'ordine per leggere stato e spedizione",
              },
            ],
          },
          next: "end",
          onHandoff: "notify",
        },
        {
          id: "notify",
          block: "human.notify_owner",
          params: {
            message:
              "{{contact.full_name}} chiede assistenza per l'ordine {{steps.extract.output.data.orderNumber}}.",
          },
        },
      ],
    },
  },
  {
    key: "real_estate_listing_match",
    sector: "real_estate",
    name: "Nuovo immobile → clienti interessati",
    description:
      "Quando un immobile compare sui portali, trova i clienti con zona e budget compatibili e avvia una proposta per ciascuno.",
    requirements: { connections: ["scraper"], messageTemplates: [], contactFields: ["zona", "budget_max"] },
    definition: {
      trigger: { event: "listing.published", filters: [] },
      steps: [
        {
          id: "match",
          block: "contact.find_matching",
          params: {
            rules: [
              { field: "zona", operator: "eq", value: "{{event.payload.area}}" },
              { field: "budget_max", operator: "gte", value: "{{event.payload.price}}" },
            ],
            limit: 50,
          },
        },
        {
          id: "fan_out",
          block: "logic.for_each",
          params: {
            items: "{{steps.match.output.contacts}}",
            emitEvent: "custom.listing.matched",
            payload: { listing: "{{event.payload}}" },
          },
        },
      ],
    },
  },
  {
    key: "real_estate_listing_proposal",
    sector: "real_estate",
    name: "Proposta immobile → visita → trattativa",
    description:
      "Propone l'immobile al cliente interessato su WhatsApp, risponde alle domande e avvisa l'agente quando il cliente vuole fissare la visita.",
    requirements: {
      connections: ["whatsapp"],
      messageTemplates: [
        {
          channel: "whatsapp",
          name: "nuovo_immobile",
          body: "Buongiorno {{1}}, è appena uscito un immobile che può interessarle: {{2}}, {{3}} €. Vuole fissare una visita? Questo è un messaggio automatico.",
        },
      ],
    },
    definition: {
      trigger: { event: "custom.listing.matched", filters: [] },
      steps: [
        {
          id: "contact",
          block: "contact.upsert",
          params: { phone: "{{event.payload.item.phone}}", email: "{{event.payload.item.email}}" },
        },
        {
          id: "propose",
          block: "whatsapp.send_template",
          params: {
            template: "nuovo_immobile",
            variables: {
              "1": "{{contact.full_name}}",
              "2": "{{event.payload.listing.title}}",
              "3": "{{event.payload.listing.price}}",
            },
          },
        },
        {
          id: "deal",
          block: "deal.create",
          params: {
            title: "{{event.payload.listing.title}} · {{contact.full_name}}",
            stage: "quote_sent",
            value: "{{event.payload.listing.price}}",
            nextAction: "Fissare la visita",
            fields: { url: "{{event.payload.listing.url}}" },
          },
        },
        { id: "wait_reply", block: "wait.for_reply", params: { timeout: "72h" }, onReply: "answer" },
        {
          id: "answer",
          block: "ai.reply",
          params: {
            scope:
              "Domande sull'immobile proposto (zona, prezzo, metratura, caratteristiche riportate nell'annuncio) e richiesta di visita. Per fissare la visita raccogli giorno e fascia oraria preferiti.",
            maxTurns: 6,
            idleTimeout: "48h",
          },
          next: "visit",
          onHandoff: "notify",
        },
        {
          id: "visit",
          block: "deal.update_stage",
          params: { stage: "negotiation", nextAction: "Confermare la visita" },
          next: "notify",
        },
        {
          id: "notify",
          block: "human.notify_owner",
          params: {
            message:
              "{{contact.full_name}} è interessato a {{event.payload.listing.title}}: confermare la visita.",
          },
        },
      ],
    },
  },
];

export function getFlowTemplate(key: string): FlowTemplate | undefined {
  return FLOW_TEMPLATES.find((template) => template.key === key);
}
