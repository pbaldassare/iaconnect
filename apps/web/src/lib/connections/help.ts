/** What the customer needs at hand before connecting each system. Shown above the guided form. */
const HELP: Record<string, string[]> = {
  gmail: [
    "Ti portiamo sul sito di Google: accedi con la casella da collegare e autorizza lettura e invio.",
    "Leggiamo solo la posta che arriva da adesso in poi.",
  ],
  microsoft365: [
    "Ti portiamo sul sito di Microsoft: accedi con la casella da collegare e autorizza lettura e invio.",
  ],
  google_calendar: [
    "Ti portiamo sul sito di Google: autorizza la lettura degli orari liberi e la creazione di appuntamenti.",
    "Si usa il calendario principale, dal lunedì al venerdì, dalle 9 alle 18.",
  ],
  meta_social: [
    "Ti portiamo su Facebook: accedi con un profilo che amministra la pagina e concedi i permessi richiesti.",
    "Se amministri più pagine, dopo l'autorizzazione potrai scegliere quale collegare.",
  ],
  imap_smtp: [
    "Servono indirizzo, nome utente, password e i server di posta in arrivo (IMAP) e in uscita (SMTP): li trovi nelle istruzioni del tuo fornitore di posta.",
    "Se la casella ha la verifica in due passaggi, usa una «password per le app».",
  ],
  whatsapp_meta: [
    "Servono tre dati dal pannello Meta for Developers, prodotto WhatsApp: Phone number ID, WABA ID e un token permanente di un utente di sistema.",
  ],
  whatsapp_wawebapi: [
    "Serve la chiave del gateway waWebApi. Dopo il collegamento compare un codice QR da inquadrare con WhatsApp, da Dispositivi collegati.",
    "È una modalità sperimentale: per l'uso stabile scegli WhatsApp Business (Meta).",
  ],
  crm_rest: [
    "Servono l'indirizzo dell'API del gestionale, l'intestazione di autenticazione e l'elenco delle risorse da leggere o scrivere.",
    'Esempio di risorse: {"clienti": {"listPath": "/clienti", "idField": "id", "watch": true}}',
  ],
  webhook_inbound: [
    "Non serve nulla: creiamo un indirizzo e un segreto di firma che il tuo sito o gestionale userà per inviarci gli eventi.",
  ],
  ghl_social: [
    "Servono il token dell'integrazione privata e il Location ID del sotto-account GoHighLevel.",
    "Dopo il collegamento ti mostriamo l'indirizzo e il segreto da inserire nel workflow GoHighLevel.",
  ],
  sms_twilio: [
    "Servono Account SID, Auth Token e il mittente (numero, nome o Messaging Service).",
    "Dopo il collegamento imposta l'indirizzo che ti mostriamo sul numero Twilio, alla voce «A message comes in».",
  ],
  scraper_site: [
    "Serve l'indirizzo del sito. Nome utente e password solo se per vedere le pagine bisogna accedere.",
    "Poi, in «Siti e portali», dirai cosa leggere.",
  ],
  payment_stripe: [
    "Serve una chiave segreta (o con restrizioni) di Stripe. Il webhook lo registriamo noi.",
    "Compila il segreto dell'endpoint solo se hai già creato il webhook a mano su Stripe.",
  ],
  signature_link: ["Collegamento provvisorio: invia il documento come link e non ha valore legale di firma."],
};

export function connectHelp(connectorKey: string): string[] {
  return HELP[connectorKey] ?? [];
}
