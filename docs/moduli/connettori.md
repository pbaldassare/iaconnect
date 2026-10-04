# Connettori

Stato: prima versione, 2026-10-04. Codice in `packages/connectors`, webhook in
`supabase/functions/webhook`. Contratto in `packages/core/src/connectors/contract.ts`.

> **Nessun connettore è stato provato contro il servizio reale.** I test usano un
> `fetch` finto e firme calcolate in locale: dimostrano che il codice fa ciò che
> pensiamo chieda il fornitore, non che il fornitore lo accetti. Vedi
> [Non verificato dal vivo](#non-verificato-dal-vivo).

## Come è fatto

- Un file per connettore in `packages/connectors/src/`; il codice comune è in `src/lib/`.
- `src/index.ts` esporta tutti i connettori, `getConnector(key)` e `listConnectors()`.
  È l'ingresso per il worker (Node).
- `src/webhooks.ts` esporta `handleInboundWebhook` e `webhookConnectors`. Usa solo API
  web standard (fetch, Web Crypto) e gira anche su Deno. Il connettore IMAP/SMTP, che
  usa librerie Node, è raggiungibile solo da `index.ts`; un test lo verifica.
- Le chiavi dei connettori coincidono con quelle inserite in `connector_types` dalla
  migrazione `20261004000300_functions.sql`; un test confronta chiave, categoria, nome
  e modalità di collegamento.
- Errori: `ConnectorError` con `retryable: true` per 429, 5xx, 408 e guasti di rete;
  `false` per gli altri 4xx e per i dati non validi. Un 401 (o un token rifiutato)
  ha `code: "auth_expired"` e in `verify` diventa lo stato `expired`.
- I messaggi d'errore non contengono mai la risposta del fornitore, token o testi dei
  messaggi: solo il nome del servizio e il codice HTTP.

## Webhook

Funzione edge `webhook`, senza verifica JWT (`supabase/config.toml`): ogni richiesta
è autenticata dalla propria firma.

Indirizzo di base: `https://<progetto>.supabase.co/functions/v1/webhook`

| Percorso | Uso |
| --- | --- |
| `/c/<webhook_token>` | Webhook di un singolo collegamento. Il token è `connections.webhook_token`. Il connettore verifica la firma con i segreti del collegamento. |
| `/p/<connector_key>` | Webhook unico per fornitore (`whatsapp_meta`, `meta_social`). Il connettore verifica la firma con i segreti di piattaforma, poi ogni collegamento attivo a cui il messaggio è indirizzato lo elabora. |

Risposte: `200` quando gli eventi sono salvati (o non c'era nulla da salvare); `401`
firma non valida; `404` token o connettore sconosciuto, collegamento scollegato;
`413` corpo oltre 1 MB; `405` metodo diverso da GET/POST; `500` errore interno (il
fornitore riconsegna, le chiavi di deduplica scartano i doppioni). Le risposte di
rifiuto non hanno corpo.

Sulla rotta `/p/` vengono serviti solo i collegamenti con stato `active`; sulla rotta
`/c/` tutti tranne quelli `disconnected`.

## Variabili d'ambiente

| Variabile | Dove serve | Uso |
| --- | --- | --- |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | edge | Accesso al database (già presenti nelle funzioni Supabase). |
| `WEBHOOK_PUBLIC_URL` | edge | Indirizzo di base pubblico dei webhook (quello sopra). **Obbligatoria per Twilio**, che firma l'indirizzo chiamato. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | worker, backend | OAuth di Gmail e Google Calendar. |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET` | worker, backend | OAuth di Microsoft 365. |
| `META_APP_ID`, `META_APP_SECRET` | worker, backend, edge | OAuth di Facebook/Instagram; firma dei webhook Meta. |
| `META_WEBHOOK_VERIFY_TOKEN` | edge | Stringa scelta da noi, da inserire uguale nella configurazione webhook dell'app Meta. |
| `META_GRAPH_VERSION` | facoltativa | Versione della Graph API (predefinita `v21.0`). |
| `WAWEBAPI_BASE_URL` | worker, backend | Indirizzo del gateway waWebApi. |

## Connettori

Per ognuno: cosa deve fornire il cliente, cosa emette, cosa offre.

### `gmail` — Gmail (mail, OAuth)

- **Il cliente fornisce:** l'autorizzazione Google (lettura e invio).
- **Emette:** `mail.received`, tramite polling. Il primo controllo parte da "adesso":
  la posta precedente non viene riletta. Cursore: `historyId` (con ripiego sulla data
  se Google lo considera troppo vecchio). Massimo 50 messaggi per controllo.
- **Offre:** `send` (messaggio RFC 822 in base64url; `inReplyTo` e `threadId` per le risposte).
- Nel payload `messageId` è l'intestazione `Message-ID` (da ripassare in `inReplyTo`),
  `externalId` è l'identificativo Gmail.
- Il token di accesso si rinnova da solo; i nuovi segreti vengono salvati con `saveSecrets`.

### `microsoft365` — Microsoft 365 (mail, OAuth)

- **Il cliente fornisce:** l'autorizzazione Microsoft (`Mail.Read`, `Mail.Send`, `offline_access`).
- **Emette:** `mail.received`, tramite polling su `receivedDateTime` della posta in arrivo.
  Il corpo è richiesto in formato testo: `html` non viene valorizzato.
- **Offre:** `send` tramite `/me/sendMail`. Con `inReplyTo` cerca il messaggio originale
  e usa `/reply`; se non lo trova invia un messaggio nuovo.
- Graph non restituisce un identificativo dell'invio: `externalId` è generato da noi e
  lo stato è `queued`.

### `imap_smtp` — Altra casella (mail, credenziali)

- **Il cliente fornisce:** indirizzo, nome utente, password (o password per le app),
  server e porta IMAP e SMTP.
- **Emette:** `mail.received`, tramite polling (cursore: ultimo UID e UIDVALIDITY).
- **Offre:** `send` tramite SMTP.
- Il collegamento prova entrambi gli accessi prima di salvare. Solo Node (worker).

### `whatsapp_meta` — WhatsApp Business (whatsapp, chiave)

- **Il cliente fornisce:** Phone number ID, WABA ID, token di accesso permanente
  (utente di sistema con `whatsapp_business_messaging` e `whatsapp_business_management`).
- **Emette:** `whatsapp.message.received`, `whatsapp.status.updated`.
- **Offre:** `sendTemplate` (nome, lingua, variabili del corpo in ordine), `sendText`
  (solo entro 24 ore dall'ultimo messaggio del cliente: lo impone Meta, non il codice).
- **Webhook:** `…/webhook/p/whatsapp_meta`, da configurare una volta nell'app Meta
  (prodotto WhatsApp, campo `messages`) con `META_WEBHOOK_VERIFY_TOKEN`.
- Al collegamento iscrive la nostra app al WABA (`/{waba}/subscribed_apps`).
- I file multimediali non vengono scaricati: il payload porta `mediaId` e `messageType`,
  non `mediaUrl`.

### `whatsapp_wawebapi` — WhatsApp via QR (whatsapp, QR) — sperimentale

- **Il cliente fornisce:** la chiave API del gateway; poi inquadra il QR.
- **Emette:** `whatsapp.message.received`, `whatsapp.status.updated`.
- **Offre:** `sendText`, `sendTemplate` (invia `renderedText`: non esistono modelli lato
  fornitore), più `registerWebhook` (non standard).
- **Webhook:** `…/webhook/c/<webhook_token>` con intestazione `x-webhook-secret`.
  Dopo aver creato il collegamento la piattaforma deve chiamare l'azione
  `registerWebhook` con questo indirizzo.
- **L'API del prodotto reale non è stata verificata.** La mappatura HTTP è una nostra
  ipotesi, tutta nell'oggetto `WAWEBAPI` di `whatsapp-wawebapi.ts`. Va confrontata con
  la documentazione di waWebApi prima di qualunque uso.

### `crm_rest` — Gestionale (crm, chiave)

- **Il cliente fornisce:** indirizzo di base dell'API, nome e valore dell'intestazione
  di autenticazione (il valore è un segreto), elenco delle risorse:
  `{ nome: { listPath, createPath?, updatePath?, updateMethod?, idField, recordsPath?, watch? } }`.
- **Emette:** `crm.record.created` per le risorse con `watch: true` (polling: il primo
  controllo memorizza i record esistenti, i successivi segnalano quelli nuovi).
- **Offre:** `read` (`query` diventa parametri dell'indirizzo), `write` (POST per creare,
  PUT o PATCH su `updatePath` con `{id}` per aggiornare).
- Rifiuta indirizzi privati o locali. Il controllo è sul nome dell'host, non sul DNS né
  sui reindirizzamenti: la rete del worker deve comunque bloccare gli indirizzi interni.

### `webhook_inbound` — Webhook in ingresso (crm, webhook)

- **Il cliente fornisce:** nulla. Il collegamento genera un segreto di firma.
- **Webhook:** `…/webhook/c/<webhook_token>`, `POST` con JSON
  `{ "type", "dedupeKey"?, "occurredAt"?, "payload", "contact"? }` e intestazione
  `x-ia-signature: sha256=<HMAC-SHA256 esadecimale del corpo grezzo>`.
- **Emette:** il tipo dichiarato nel corpo, se è nel catalogo o è `custom.*`. Senza
  `dedupeKey` la chiave è l'hash del corpo. Un corpo non valido riceve `400`.
- **Offre:** `read` e `write` rispondono con errore "non supportato" (non ritentabile).
- Il segreto esiste solo nel risultato di `connect`: chi chiama `connect` deve mostrarlo
  al cliente una volta, poi resta solo nel Vault.

### `google_calendar` — Google Calendar (calendar, OAuth)

- **Il cliente fornisce:** l'autorizzazione Google; facoltativi calendario, fuso orario,
  orario e giorni lavorativi (predefiniti: `primary`, Europe/Rome, 9–18, lunedì–venerdì,
  proposte ogni 30 minuti).
- **Emette:** nulla.
- **Offre:** `findSlots` (freeBusy + orario lavorativo, mai nel passato), `createEvent`.
- `createEvent` non invia inviti per mail all'eventuale partecipante.

### `meta_social` — Facebook e Instagram (social, OAuth)

- **Il cliente fornisce:** l'autorizzazione Facebook e la pagina da collegare.
- **Emette:** `social.lead.received` (moduli: le risposte vengono lette con il token
  della pagina), `social.message.received` (Messenger e Instagram),
  `social.comment.received`.
- **Offre:** `sendMessage`, `publishPost` (solo pagina Facebook), `replyComment`.
- **Webhook:** `…/webhook/p/meta_social`, da configurare nell'app Meta per gli oggetti
  Page (`leadgen`, `messages`, `feed`) e Instagram (`messages`, `comments`).
- Se l'account gestisce più pagine e non è indicato `pageId`, viene collegata la prima;
  l'elenco è in `config.availablePages`.
- Le consegne Instagram sono indirizzate all'account Instagram, non alla pagina: l'id è
  salvato in `config.accountAliases` e la funzione edge cerca anche lì.
- Gli identificativi dei commenti Instagram sono emessi con prefisso `ig:`, così
  `replyComment` sa quale indirizzo chiamare.

### `ghl_social` — GoHighLevel (social, chiave) — non verificato

- **Il cliente fornisce:** token dell'integrazione privata, Location ID, gli ID degli
  account social su cui pubblicare, facoltativo l'ID utente.
- **Emette:** `social.message.received`, `social.lead.received`, `social.comment.received`.
- **Offre:** `sendMessage`, `publishPost`, `replyComment`.
- **Webhook:** `…/webhook/c/<webhook_token>` con intestazione `x-ia-webhook-secret`,
  da impostare nell'azione "Webhook" di un workflow GoHighLevel. Il segreto è generato
  al collegamento e va mostrato una volta al cliente.
- **Mai provato su un account reale.** Percorsi, versione e campi sono nell'oggetto `GHL`
  di `ghl-social.ts`. In particolare la risposta ai commenti e la forma del webhook
  sono ipotesi.

### `sms_twilio` — SMS (sms, chiave)

- **Il cliente fornisce:** Account SID, Auth Token, mittente (numero, nome alfanumerico
  o Messaging Service SID), facoltativo l'indirizzo per lo stato di consegna.
- **Emette:** `sms.received`, `sms.status.updated`.
- **Offre:** `send`.
- **Webhook:** `…/webhook/c/<webhook_token>`, da impostare sul numero Twilio ("A message
  comes in", POST) e come `statusCallbackUrl` del collegamento.
- La firma copre l'indirizzo: serve `WEBHOOK_PUBLIC_URL` identico a quello configurato
  su Twilio.

### `scraper_site` — Sito o portale (scraper, credenziali)

- **Il cliente fornisce:** indirizzo del sito; facoltativi nome utente e password
  (conservati come segreti).
- **Emette:** nulla da solo; le ricette di scraping del worker emettono
  `scrape.item.found` e `listing.published` a nome del collegamento.
- **Offre:** nessuna azione. `verify` controlla solo che il sito risponda.

### `payment_stripe` — Pagamenti (payment, chiave)

- **Il cliente fornisce:** chiave segreta o con restrizioni; facoltativo il segreto
  dell'endpoint (`whsec_…`) se crea il webhook a mano.
- **Emette:** `payment.completed` su `checkout.session.completed` pagata.
  `paymentRequestId` è il `reference` passato a `createLink`; `amount` è in unità
  (euro), `amountCents` in centesimi.
- **Offre:** `createLink` (Payment Link con `price_data`, `reference` nei metadati,
  chiave di idempotenza per i tentativi ripetuti), più `registerWebhook` (non standard)
  che crea l'endpoint su Stripe e ne salva il segreto.
- **Webhook:** `…/webhook/c/<webhook_token>`. Firma `Stripe-Signature` con tolleranza
  di 5 minuti.
- Finché il webhook non è registrato `verify` segnala errore.

### `signature_link` — Firma tramite link (signature, chiave) — segnaposto

- **È un segnaposto.** Il fornitore di firma elettronica non è stato scelto
  (`docs/decisioni/2026-10-04-10-pagamenti-e-firma.md`). Non ha valore legale di firma.
- **Offre:** `createRequest` restituisce l'indirizzo del documento come link e un
  identificativo generato.
- **Emette:** `signature.completed` quando riceve su `…/webhook/c/<webhook_token>` un
  `POST` `{ "externalId", "status": "signed", "documentUrl"? }` firmato con
  `x-ia-signature` (stesso schema di `webhook_inbound`).

## Limiti del contratto aggirati in locale

Da valutare in `packages/core` (non modificato):

1. `WebhookRequest` non ha l'indirizzo chiamato, che Twilio firma. La funzione lo passa
   nell'intestazione interna `x-ia-request-url` (sovrascritta sempre, non falsificabile
   dal chiamante).
2. `connect` non conosce l'indirizzo del webhook del collegamento (il token nasce nel
   database dopo). Stripe e waWebApi espongono per questo un'azione `registerWebhook`
   da chiamare dopo la creazione; Twilio legge `config.statusCallbackUrl`.
3. I segreti generati al collegamento (`webhook_inbound`, `signature_link`,
   `ghl_social`) non hanno un canale per essere mostrati al cliente: va fatto da chi
   chiama `connect`, una sola volta.
4. Un collegamento ha un solo `external_account_id`; Instagram ne richiede un secondo
   (`config.accountAliases`).
5. `SocialReplyCommentInput` non indica la piattaforma: è codificata nell'identificativo
   del commento.
6. La scelta della pagina Facebook richiederebbe due passaggi dopo l'OAuth; il contratto
   ne prevede uno.

## Non verificato dal vivo

Tutto. In dettaglio:

- **Funzione edge `webhook`:** mai eseguita (Deno non è installato sulla macchina di
  sviluppo). Da provare: risoluzione degli import fuori da `supabase/functions`,
  mappa degli import in `deno.json`, forma del percorso della richiesta, query su
  `config.accountAliases`, inserimento con `ignoreDuplicates`.
- **Gmail, Google Calendar, Microsoft 365:** scambio del codice, rinnovo del token,
  ambiti richiesti, forma delle risposte, filtro `$filter` di Graph, risposta tramite
  `/reply`.
- **IMAP/SMTP:** provato solo con client finti; nessuna connessione a un server vero.
- **WhatsApp Meta:** firma, handshake e forma dei payload seguono la documentazione;
  iscrizione al WABA e invii mai eseguiti. La versione `v21.0` della Graph API va
  controllata.
- **Facebook/Instagram:** scambio del token con POST, permessi (richiedono la revisione
  dell'app), lettura dei lead, forma dei webhook Instagram, invio messaggi Instagram.
- **Twilio:** l'algoritmo della firma è quello documentato; non confrontato con una
  richiesta reale.
- **Stripe:** `price_data` sui Payment Link e la propagazione dei metadati alla sessione
  di pagamento vanno confermati in modalità di prova.
- **waWebApi e GoHighLevel:** mappature ipotetiche, vedi sopra.
- **Firma:** segnaposto.

## Test

`npx vitest run packages/connectors` — nessuna chiamata di rete. Coprono: registro e
compatibilità Deno dei sorgenti; firme Meta, Twilio, Stripe e generica (accettate e
rifiutate, con HMAC di riferimento calcolati da `node:crypto`); normalizzazione di
messaggi e stati WhatsApp, lead Meta, SMS Twilio, pagamento Stripe; forma delle
richieste di invio; messaggio RFC 822 di Gmail e rinnovo del token; mappatura degli
errori; `handleInboundWebhook` su entrambe le rotte.
