# IA Connect — Specifica di progetto

Documento di riferimento per lo sviluppo. Va tenuto in `docs/PROGETTO.md`.
Le regole operative brevi per l'agente stanno in `CLAUDE.md` nella radice.

Stato: specifica iniziale, nessun codice esistente. Lingua dell'interfaccia: italiano.
Identificatori di codice, tabelle e commit: inglese.

---

## 1. Cos'è

IA Connect è una piattaforma multi-cliente che collega i sistemi di una PMI
(mail, gestionale, WhatsApp, social, siti, database) e li trasforma in flussi
automatici: **evento → comprensione → azione → conversazione → trattativa → report**.

Tre principi non negoziabili:

1. **L'IA progetta, il server esegue.** L'IA si usa per creare o modificare un
   flusso, per tracciare un percorso di scraping e per i soli passi dichiarati
   "IA" (capire testo libero, rispondere a una persona). Tutto il resto è codice
   deterministico sul server.
2. **Cliente autonomo, admin sempre in controllo.** L'admin attiva l'azienda;
   l'azienda collega i propri sistemi e gestisce i propri flussi da sola.
   L'admin può comunque modificare e personalizzare ogni azienda.
3. **Un solo motore, configurazioni diverse.** Settori e clienti sono dati di
   configurazione nel database, mai rami o copie del codice.

Casi d'uso guida:

- **Assicuratore (pilota):** arriva una richiesta di preventivo → invio WhatsApp
  → risposte → trattativa → sollecito → report.
- **E-commerce:** ordine via mail → registrazione → contatto WhatsApp → risposte
  sullo stato dell'ordine leggendo il database.
- **Agente immobiliare:** nuovo immobile sui portali → abbinamento ai clienti
  interessati → messaggio → visita → trattativa.

---

## 2. Stack

| Livello | Scelta |
| --- | --- |
| Sviluppo | Claude Code + Cursor |
| Database, auth, storage | Supabase (Postgres, RLS, Auth, Storage), regione UE |
| Webhook e azioni brevi | Supabase Edge Functions (Deno/TypeScript) |
| Code e pianificazione | Supabase Queues (pgmq) + pg_cron |
| Worker (flussi lunghi, scraping) | Servizio Node.js/TypeScript in Docker su VPS, con Playwright |
| Frontend | Applicazione web React + TypeScript + Tailwind (framework: DA DECIDERE, proposta Next.js) |
| IA | Claude via API con tool use; modello più economico per compiti semplici (DA DECIDERE) |
| WhatsApp | Adattatore con due implementazioni: Meta Cloud API e waWebApi (DA DECIDERE quale in produzione) |
| Social | Adattatore con due implementazioni: Meta Graph API diretta e GoHighLevel come ponte |
| Mail | Gmail API, Microsoft Graph, IMAP/SMTP |
| SMS | Fornitore esterno dietro adattatore (DA DECIDERE) |

Regola generale: ogni servizio esterno sta dietro un'interfaccia nostra
(adattatore). Il motore dei flussi non conosce mai il fornitore concreto.

---

## 3. Livelli e ruoli

Gerarchia a tre livelli, presente nel modello dati da subito:

```
platform (noi)
  └── reseller (rivenditore; il primo è "default", cioè noi)
        └── organization (azienda cliente)
              └── member (utente dell'azienda)
```

| Ruolo | Può fare |
| --- | --- |
| `platform_admin` | Tutto. Crea rivenditori e aziende, piani, quote, connettori disponibili, modelli di flusso; modifica dati, flussi, collegamenti e personalizzazioni di ogni azienda; accesso in assistenza ("vedi come il cliente") |
| `reseller_admin` (fase 3) | Come sopra, limitato alle proprie aziende e con il proprio marchio |
| `org_owner` | Gestisce utenti, collegamenti, flussi, modelli di messaggio, vede consumi e report |
| `org_member` | Usa inbox e trattative; non modifica collegamenti né flussi (permessi configurabili) |

Regole:

- Isolamento per `organization_id` con RLS su **ogni** tabella di dati cliente.
- L'accesso in assistenza dell'admin è tracciato in `audit_log` e visibile al cliente.
- Le personalizzazioni per azienda sono righe in `org_settings` e flag in
  `org_features`, mai codice dedicato.

---

## 4. Architettura

```
[Sistemi del cliente]  mail · gestionale · siti/portali · social · database
        │
[Connettori]  webhook · polling · ricette di scraping  →  eventi normalizzati
        │
[Coda eventi]  →  [Motore dei flussi]  (deterministico, lato server)
        │                 │
        │                 ├── blocchi senza IA: condizioni, attese, invii da modello, scritture
        │                 └── blocchi IA dichiarati: estrazione da testo, risposta, classificazione
        │
[Canali]  WhatsApp · mail · SMS · social · scrittura su gestionale
        │
[Contatti · Conversazioni · Trattative]  →  [Report e cruscotto]
```

Le risposte dei destinatari rientrano come nuovi eventi dal livello connettori.

Componenti:

- **web**: applicazione frontend con area admin e area cliente.
- **edge**: funzioni Supabase per webhook in ingresso, OAuth, azioni brevi.
- **worker**: processo sempre acceso che consuma le code, esegue i flussi,
  le ricette di scraping e i lavori pianificati.
- **packages/core**: tipi, schema dei flussi, catalogo dei blocchi, contratti
  degli adattatori. Condiviso da web, edge e worker.

---

## 5. Modello dati

Tutte le tabelle cliente hanno `id uuid`, `organization_id`, `created_at`,
`updated_at` e RLS attiva. Elenco delle tabelle principali:

**Struttura**

- `resellers` — nome, marchio, stato.
- `organizations` — reseller_id, nome, settore (`insurance`, `ecommerce`, `real_estate`, …), piano, stato.
- `memberships` — user_id, organization_id (o reseller_id), ruolo.
- `plans` — limiti: flussi attivi, messaggi/mese, esecuzioni scraping, crediti IA.
- `org_settings` — tono e istruzioni IA, marchio, campi extra delle trattative, lingua.
- `org_features` — funzioni attivate o nascoste per azienda.
- `usage_counters` — consumi per periodo: messaggi, crediti IA, esecuzioni.

**Collegamenti**

- `connector_types` — catalogo: chiave, categoria (mail, whatsapp, crm, social, scraper, sms, calendar), schema di configurazione, piani ammessi.
- `connections` — connector_type, stato (`active`, `expired`, `error`, `disconnected`), configurazione non segreta, ultimo controllo.
- `connection_secrets` — token e credenziali cifrati (Supabase Vault); mai leggibili dal frontend.

**Eventi e flussi**

- `events` — tipo, sorgente (connection_id), payload normalizzato, `dedupe_key` unica, stato di elaborazione.
- `flow_templates` — modelli di settore pubblicati dall'admin.
- `flows` — nome, stato (`draft`, `active`, `paused`), versione attiva.
- `flow_versions` — definizione JSON validata, autore (utente o IA), nota di modifica. Immutabili.
- `flow_runs` — flow_version_id, event_id, stato, inizio, fine, modalità (`live`, `simulation`).
- `flow_run_steps` — blocco eseguito, input, output, esito, costo IA, durata.
- `scheduled_jobs` — attese, solleciti e letture pianificate.

**Scraping**

- `scrape_recipes` — sito di destinazione, connection_id, stato.
- `scrape_recipe_versions` — passi, selettori, schema dei dati attesi, generata da (IA o manuale).
- `scrape_runs` — esito, righe estratte, errori, se ha richiesto riparazione IA.

**Relazione con le persone**

- `contacts` — nome, telefoni, mail, consensi per canale (con data e origine), campi extra.
- `conversations` — contatto, canale, stato, assegnatario (`automation` o utente).
- `messages` — direzione, canale, contenuto, modello usato, stato di consegna, id esterno, generato da IA sì/no.
- `message_templates` — modelli per canale, stato di approvazione (WhatsApp).
- `deals` — contatto, titolo, fase, valore stimato, origine (flow_run), prossima azione.
- `deal_stages` — fasi configurabili per azienda.
- `deal_events` — storico dei cambi di fase e delle azioni.

**Controllo**

- `audit_log` — chi (utente, admin, automazione), cosa, su quale record, quando. Solo inserimento.
- `ai_calls` — scopo, modello, token, costo, flow_run_step collegato.

---

## 6. Connettori

Ogni connettore implementa lo stesso contratto:

```
interface Connector {
  key: string
  category: 'mail' | 'whatsapp' | 'crm' | 'social' | 'scraper' | 'sms' | 'calendar'
  connect(input): ConnectionResult        // OAuth, chiave API, QR, credenziali
  verify(connection): HealthStatus        // controllo periodico
  listen?(connection): EventSource        // webhook o polling → eventi normalizzati
  actions: Record<string, Action>         // es. sendMessage, createRecord
  disconnect(connection): void
}
```

Regole:

- Il collegamento avviene sempre dalla pagina del cliente con procedura guidata.
- Nessuna credenziale in chiaro nel database né nei log.
- Ogni connettore dichiara lo schema degli eventi che emette e delle azioni che offre:
  il catalogo dei blocchi dei flussi si costruisce da qui.
- Stato visibile al cliente; alla scadenza, avviso e ricollegamento autonomo.

Ordine di realizzazione: mail (Gmail, Microsoft, IMAP) → WhatsApp → gestionale
assicurativo del pilota → scraper → calendario → social → SMS.

---

## 7. Flussi

### 7.1 Definizione

Un flusso è un documento JSON validato da schema (Zod in `packages/core`).
Struttura:

```
{
  "trigger": { "event": "quote.requested", "connection": "...", "filters": [...] },
  "steps": [
    { "id": "s1", "block": "contact.upsert", "params": {...} },
    { "id": "s2", "block": "whatsapp.send_template", "params": {...} },
    { "id": "s3", "block": "deal.create", "params": {...} },
    { "id": "s4", "block": "wait.for_reply", "params": { "timeout": "48h" },
      "onReply": "s5", "onTimeout": "s6" },
    { "id": "s5", "block": "ai.reply", "params": { "scope": "...", "maxTurns": 6 } },
    { "id": "s6", "block": "whatsapp.send_template", "params": {...} }
  ]
}
```

### 7.2 Catalogo dei blocchi

Ogni blocco è codice nostro, collaudato, con schema di parametri, di input e di
output. Categorie:

- **Logica:** condizione, diramazione, attesa, attesa di risposta, ciclo su elenco.
- **Dati:** contatto (crea/aggiorna), trattativa (crea/aggiorna fase), lettura e scrittura su gestionale.
- **Canali:** invio WhatsApp da modello, invio WhatsApp libero (solo in finestra aperta), mail, SMS, post social.
- **Persone:** richiesta di approvazione, passaggio a operatore, avviso al titolare.
- **IA (dichiarati, a consumo):** `ai.extract` (dati da testo), `ai.classify`, `ai.reply`, `ai.summarize`.

L'IA non può introdurre blocchi che non esistono nel catalogo né codice libero.

### 7.3 Ciclo di vita

1. **Descrizione:** il cliente scrive in linguaggio naturale cosa vuole.
2. **Proposta:** l'assistente IA genera una definizione usando solo catalogo,
   collegamenti attivi e modelli dell'azienda; chiede ciò che manca.
3. **Validazione:** schema, collegamenti esistenti, consensi, quote del piano.
4. **Simulazione:** esecuzione su eventi reali recenti in modalità `simulation`
   (nessun invio, nessuna scrittura esterna); il cliente vede l'esito passo per passo.
5. **Attivazione:** nuova `flow_version`, il flusso diventa `active`.
6. **Esecuzione:** il worker esegue, senza IA salvo blocchi IA.
7. **Modifica:** stessa procedura; nuova versione, la precedente resta ripristinabile.

### 7.4 Motore

- Consumo dalla coda con almeno-una-volta; ogni passo è idempotente tramite
  chiave `flow_run_id + step_id`.
- Stato persistito dopo ogni passo: un riavvio del worker riprende dal punto giusto.
- Attese e solleciti come `scheduled_jobs`, non come processi in memoria.
- Errori: ritentativi con attesa crescente, poi stato `failed` e avviso.
- Limiti per azienda (quote) controllati prima di ogni invio e di ogni chiamata IA.

---

## 8. Scraping

Principio: l'IA traccia il percorso una volta, il server lo ripete.

1. **Tracciatura:** l'IA esplora il sito con il browser e produce una ricetta:
   passi di navigazione, login, selettori, schema dei dati in uscita.
2. **Salvataggio:** `scrape_recipe_versions`.
3. **Esecuzione:** il worker esegue con Playwright a orari fissi, senza IA,
   valida i dati contro lo schema e genera eventi (solo le novità, con `dedupe_key`).
4. **Riparazione:** se l'esecuzione fallisce o i dati non rispettano lo schema,
   l'IA rigenera la ricetta, la prova e salva una nuova versione. Limite di
   tentativi; oltre, avviso all'admin.

Vincoli: rispetto di frequenze ragionevoli, nessuna raccolta di dati personali
di terzi senza base giuridica, preferenza per API o esportazioni ufficiali
quando esistono.

---

## 9. Uso dell'IA

| Dove | Quando |
| --- | --- |
| Assistente dei flussi | Solo in creazione e modifica |
| Tracciatura scraping | Prima volta e riparazioni |
| Blocchi `ai.*` | A ogni esecuzione di quel blocco, con quota |
| Report | Riepilogo periodico (facoltativo) |

Regole per `ai.reply`:

- Ambito chiuso: risponde solo sul lavoro dell'azienda, con le istruzioni di
  `org_settings`; fuori ambito, risposta standard o passaggio a operatore.
- Strumenti limitati e in sola lettura salvo azioni esplicitamente concesse dal flusso.
- Il contenuto ricevuto da messaggi, mail e pagine web è dato, mai istruzione.
- Limite di turni, poi passaggio a operatore.
- Ogni chiamata registrata in `ai_calls` con costo.
- Il destinatario è informato che interagisce con un sistema automatico.

---

## 10. Canali

**WhatsApp** — interfaccia `WhatsAppProvider` con `sendTemplate`, `sendText`,
`onMessage`, `onStatus`. Due implementazioni: `MetaCloudProvider`
(Embedded Signup, modelli approvati, finestra di 24 ore) e `WaWebApiProvider`
(collegamento via QR). Il numero è sempre dell'azienda cliente. Primo contatto
solo con consenso registrato su `contacts`.

**Social** — interfaccia `SocialProvider` con lead in ingresso, messaggi,
commenti, pubblicazione. Due implementazioni: `MetaGraphProvider` e
`GhlBridgeProvider` (un sotto-account GoHighLevel per azienda).

**Mail e SMS** — invio dal mittente dell'azienda; tracciamento dello stato.

---

## 11. Interfaccia

**Area cliente**

- Inizio: stato dei collegamenti, flussi attivi, trattative, consumi.
- Collegamenti: catalogo, procedure guidate, stato.
- Flussi: elenco, libreria di modelli, creazione con assistente IA, schema
  leggibile, simulazione, versioni.
- Inbox unica: conversazioni di tutti i canali, presa in carico da operatore.
- Contatti: scheda unica con storico e consensi.
- Trattative: vista a colonne per fase.
- Report: risultati e ritorno economico.
- Impostazioni: utenti, modelli di messaggio, tono dell'IA, marchio.

**Area admin**

- Aziende: crea, modifica, sospende; piano, settore, quote.
- Scheda azienda: dati, collegamenti, flussi, personalizzazioni, funzioni attive, accesso in assistenza.
- Catalogo: connettori, blocchi, modelli di flusso per settore.
- Monitoraggio: esecuzioni, errori, code, ricette di scraping, consumi e costi IA.
- Registro delle azioni.

---

## 12. Sicurezza e GDPR

- RLS su tutte le tabelle cliente; test automatici che verificano l'isolamento tra aziende.
- Segreti in Supabase Vault; chiavi di servizio solo su edge e worker.
- Webhook in ingresso con verifica della firma.
- Azienda cliente = titolare del trattamento; noi = responsabile. Funzioni
  necessarie: esportazione e cancellazione dei dati di un'azienda e di un contatto.
- Consenso per canale registrato con data e origine; nessun invio senza consenso valido.
- Dati in UE; elenco dei sub-fornitori mantenuto in `docs/`.
- `audit_log` non modificabile.

---

## 13. Struttura del repository

```
/apps
  /web            frontend (admin + cliente)
  /worker         motore dei flussi, scraping, pianificazione
/supabase
  /migrations     schema e policy RLS
  /functions      edge functions (webhook, oauth)
/packages
  /core           tipi, schema dei flussi, catalogo blocchi, contratti
  /connectors     un modulo per connettore
  /ai             prompt, strumenti, assistente dei flussi
/docs             PROGETTO.md, decisioni (ADR), specifiche per modulo
CLAUDE.md
```

---

## 14. Fasi

Ogni fase si chiude con la sua verifica. Non iniziare una fase prima.

### Fase 0 — Fondamenta

- Repository, ambienti (sviluppo, produzione), CI con test e lint.
- Migrazioni: struttura, ruoli, RLS, audit_log.
- Autenticazione e area admin minima: crea azienda, invita il titolare.
- `packages/core`: schema dei flussi, contratto dei connettori, catalogo iniziale.
- Coda eventi e worker con motore minimo (blocchi logica + dati).
- WhatsApp su numero di prova tramite adattatore.

**Verifica:** un evento inserito a mano attraversa un flusso di prova, invia un
messaggio al numero di test, crea una trattativa; due aziende non vedono i
dati l'una dell'altra (test automatico).

### Fase 1 — Pilota assicurativo

- Connettore mail (Gmail, Microsoft, IMAP) con collegamento autonomo.
- Connettore del gestionale del pilota.
- Collegamento WhatsApp autonomo dalla pagina cliente.
- Flusso "preventivo → WhatsApp → trattativa → sollecito" come modello pronto.
- Blocchi `ai.extract` e `ai.reply` con quote.
- Inbox minima con presa in carico; cruscotto minimo.

**Verifica:** il cliente pilota usa il flusso su dati reali per due settimane.

### Fase 2 — Prodotto

- Assistente IA per creare e modificare flussi; simulazione; versioni.
- Libreria di modelli per settore.
- Inbox unica completa, memoria del contatto, avvisi al titolare su WhatsApp.
- Report sul ritorno economico.
- Personalizzazioni per azienda e accesso in assistenza dall'admin.
- Secondo settore: e-commerce.

**Verifica:** un cliente nuovo crea e attiva un flusso senza il nostro aiuto.

### Fase 3 — Scala

- Scraping con ricette e riparazione; settore immobiliare.
- Calendario e appuntamenti.
- Meta e social (entrambi gli adattatori).
- Pagamenti e firma.
- Livello rivenditore con marchio proprio.

**Verifica:** due settori venduti; un rivenditore attivo.

### Dopo

Agente vocale; marketplace di connettori e flussi.

---

## 15. Decisioni aperte

| Decisione | Opzioni | Note |
| --- | --- | --- |
| WhatsApp in produzione | Meta Cloud API / waWebApi | Verificare se waWebApi usa API ufficiali; l'adattatore permette entrambe |
| Social | Meta diretto / GoHighLevel | Verificare prezzi e limiti GHL; avviare comunque la revisione Meta |
| Framework frontend | Next.js / React + Vite | — |
| Modelli IA | Solo Claude / Claude + modello economico | Misurare il costo per trattativa nel pilota |
| Fornitore SMS | — | — |
| Hosting worker | VPS con Docker | Scegliere fornitore in UE |
| Modello commerciale | Canone per pacchetto / prezzo a risultato | Influisce su `plans` e `usage_counters` |

Ogni decisione presa va registrata in `docs/decisioni/` con data e motivo.

---

## 16. Strumenti di sviluppo

- MCP: Supabase (solo progetto di sviluppo), Context7, GitHub, Playwright, Firecrawl.
- Skill: `supabase/agent-skills`, Impeccable (`npx impeccable install`), plugin ufficiali Anthropic.
- Metodo: per ogni modulo, prima la specifica in `docs/`, poi i test, poi il codice.
