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
    /** Deal stages the flow uses that a fresh pipeline may lack: created at installation, after the last open stage. */
    stages?: { key: string; name: string; kind: "open" }[];
    /** Deal custom fields the flow writes: added to `org_settings.deal_custom_fields` at installation. */
    dealFields?: { key: string; label: string; type: "text" | "number" | "date" | "boolean" }[];
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
    key: "insurance_policy_renewal",
    sector: "insurance",
    name: "Polizza in scadenza → WhatsApp → trattativa di rinnovo",
    description:
      "Quando il gestionale segnala una polizza dell'agenzia in scadenza, avvisa il cliente su WhatsApp, apre la trattativa di rinnovo con targa e scadenza, risponde alle domande e sollecita dopo tre giorni di silenzio.",
    requirements: {
      connections: ["crm", "whatsapp"],
      messageTemplates: [
        {
          channel: "whatsapp",
          name: "rinnovo_polizza",
          body: "Buongiorno {{1}}, la polizza della targa {{2}} scade il {{3}}. Possiamo preparare il rinnovo: ci scriva qui per confermare o per qualsiasi domanda. Questo è un messaggio automatico.",
        },
        {
          channel: "whatsapp",
          name: "sollecito_rinnovo",
          body: "Buongiorno {{1}}, le ricordiamo che la polizza della targa {{2}} scade il {{3}}. Se vuole rinnovarla o ha domande, ci scriva qui. Questo è un messaggio automatico.",
        },
      ],
      stages: [{ key: "renewal_due", name: "In scadenza", kind: "open" }],
      dealFields: [
        { key: "targa", label: "Targa", type: "text" },
        { key: "scadenza", label: "Scadenza", type: "date" },
        { key: "compagnia", label: "Compagnia", type: "text" },
        { key: "premio", label: "Premio", type: "number" },
        { key: "tipo", label: "Tipo", type: "text" },
        { key: "numero_polizza", label: "Numero polizza", type: "text" },
      ],
    },
    definition: {
      trigger: { event: "policy.expiring", filters: [] },
      steps: [
        {
          id: "contact",
          block: "contact.upsert",
          params: {
            name: "{{event.payload.data.client_name}}",
            phone: "{{event.payload.data.phone}}",
            email: "{{event.payload.data.email}}",
            fields: { codice_fiscale: "{{event.payload.data.client_cf}}" },
            consent: { channel: "whatsapp", source: "Cliente con polizza in agenzia" },
          },
        },
        {
          id: "send_notice",
          block: "whatsapp.send_template",
          params: {
            template: "rinnovo_polizza",
            variables: {
              "1": "{{contact.full_name}}",
              "2": "{{event.payload.data.plate}}",
              "3": "{{event.payload.data.expire_date}}",
            },
          },
        },
        {
          id: "deal",
          block: "deal.create",
          params: {
            title: "Rinnovo {{event.payload.data.product_name}} · {{event.payload.data.plate}}",
            stage: "renewal_due",
            value: "{{event.payload.data.policy_price}}",
            nextAction: "Rinnovare prima del {{event.payload.data.expire_date}}",
            fields: {
              targa: "{{event.payload.data.plate}}",
              scadenza: "{{event.payload.data.expire_date}}",
              compagnia: "{{event.payload.data.company_slug}}",
              premio: "{{event.payload.data.policy_price}}",
              tipo: "polizza",
              numero_polizza: "{{event.payload.data.policy_num}}",
            },
          },
        },
        {
          id: "wait_reply",
          block: "wait.for_reply",
          params: { timeout: "72h" },
          onReply: "answer",
          onTimeout: "reminder",
        },
        {
          id: "answer",
          block: "ai.reply",
          params: {
            scope:
              "Rinnovo della polizza in scadenza: documenti necessari, tempi e modalità per rinnovare, cosa succede alla scadenza. Non comunicare prezzi o premi diversi da quelli già indicati al cliente.",
            maxTurns: 6,
            idleTimeout: "24h",
          },
          next: "negotiation",
          onHandoff: "notify",
        },
        {
          id: "negotiation",
          block: "deal.update_stage",
          params: { stage: "negotiation", nextAction: "Chiudere il rinnovo" },
          next: "end",
        },
        {
          id: "reminder",
          block: "whatsapp.send_template",
          params: {
            template: "sollecito_rinnovo",
            variables: {
              "1": "{{contact.full_name}}",
              "2": "{{event.payload.data.plate}}",
              "3": "{{event.payload.data.expire_date}}",
            },
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
              "{{contact.full_name}} attende un contatto per il rinnovo della polizza {{event.payload.data.plate}}, in scadenza il {{event.payload.data.expire_date}}.",
          },
        },
      ],
    },
  },
  {
    key: "insurance_quote_expiring",
    sector: "insurance",
    name: "Copertura altrui in scadenza → WhatsApp → trattativa",
    description:
      "Quando il gestionale segnala che la copertura di una targa preventivata, oggi assicurata altrove, sta per scadere, ricorda al cliente che il preventivo è ancora valido, apre la trattativa e risponde alle domande.",
    requirements: {
      connections: ["crm", "whatsapp"],
      messageTemplates: [
        {
          channel: "whatsapp",
          name: "scadenza_copertura",
          body: "Buongiorno {{1}}, la copertura della targa {{2}} con {{3}} scade il {{4}}. Il preventivo che le abbiamo preparato è ancora valido: se vuole attivarlo o ha domande, ci scriva qui. Questo è un messaggio automatico.",
        },
        {
          channel: "whatsapp",
          name: "sollecito_copertura",
          body: "Buongiorno {{1}}, le ricordiamo che la copertura della targa {{2}} scade il {{3}}. Il nostro preventivo è ancora valido: ci scriva qui per procedere. Questo è un messaggio automatico.",
        },
      ],
      stages: [{ key: "renewal_due", name: "In scadenza", kind: "open" }],
      dealFields: [
        { key: "targa", label: "Targa", type: "text" },
        { key: "scadenza", label: "Scadenza", type: "date" },
        { key: "compagnia_attuale", label: "Compagnia attuale", type: "text" },
        { key: "tipo", label: "Tipo", type: "text" },
      ],
    },
    definition: {
      trigger: { event: "quote.expiring", filters: [] },
      steps: [
        {
          id: "contact",
          block: "contact.upsert",
          params: {
            name: "{{event.payload.data.client_name}}",
            phone: "{{event.payload.data.phone}}",
            email: "{{event.payload.data.email}}",
            fields: { codice_fiscale: "{{event.payload.data.client_cf}}" },
            consent: { channel: "whatsapp", source: "Cliente con preventivo in agenzia" },
          },
        },
        {
          id: "send_notice",
          block: "whatsapp.send_template",
          params: {
            template: "scadenza_copertura",
            variables: {
              "1": "{{contact.full_name}}",
              "2": "{{event.payload.data.plate}}",
              "3": "{{event.payload.data.current_company}}",
              "4": "{{event.payload.data.expire_date}}",
            },
          },
        },
        {
          id: "deal",
          block: "deal.create",
          params: {
            title: "Preventivo {{event.payload.data.product_name}} · {{event.payload.data.plate}}",
            stage: "renewal_due",
            nextAction: "Proporre l'attivazione prima del {{event.payload.data.expire_date}}",
            fields: {
              targa: "{{event.payload.data.plate}}",
              scadenza: "{{event.payload.data.expire_date}}",
              compagnia_attuale: "{{event.payload.data.current_company}}",
              tipo: "preventivo",
            },
          },
        },
        {
          id: "wait_reply",
          block: "wait.for_reply",
          params: { timeout: "72h" },
          onReply: "answer",
          onTimeout: "reminder",
        },
        {
          id: "answer",
          block: "ai.reply",
          params: {
            scope:
              "Attivazione del preventivo già fatto per la targa la cui copertura sta scadendo: documenti necessari, tempi e modalità per passare alla nuova polizza, cosa succede alla scadenza della copertura attuale. Non comunicare prezzi diversi da quelli del preventivo già consegnato.",
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
            template: "sollecito_copertura",
            variables: {
              "1": "{{contact.full_name}}",
              "2": "{{event.payload.data.plate}}",
              "3": "{{event.payload.data.expire_date}}",
            },
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
              "{{contact.full_name}} attende un contatto per il preventivo della targa {{event.payload.data.plate}}: la copertura attuale scade il {{event.payload.data.expire_date}}.",
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
                description:
                  "Ordini del contatto: cerca per numero d'ordine per leggere stato e spedizione. Vengono restituiti solo gli ordini di chi sta scrivendo.",
                // Only the orders whose phone is the one writing: asking about someone
                // else's order number returns nothing.
                matchContact: { field: "phone", by: "phone" },
                fields: ["orderNumber", "status", "total", "currency", "items", "trackingUrl", "shippedAt"],
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
