# Worker

`apps/worker` è il processo sempre acceso della piattaforma. Consuma la coda degli
eventi, esegue i flussi in modo deterministico, porta avanti i lavori pianificati
e le ricette di scraping. Non contiene logica di settore né di cliente: tutto ciò
che cambia da un'azienda all'altra sta nel database.

## Cosa fa

1. **Coda.** Prende le righe di `events` e `scheduled_jobs` con
   `FOR UPDATE SKIP LOCKED` e un blocco a tempo (`locked_until`). Se il worker
   muore, alla scadenza del blocco la riga viene ripresa: consegna
   almeno-una-volta. Errore → nuovo tentativo con attesa crescente
   (30 s, 1 min, 2 min…); dopo 5 tentativi la riga diventa `failed` e l'azienda
   riceve un avviso.
2. **Eventi.**
   - Azienda sospesa → evento `ignored`.
   - **Origine dei tipi riservati.** Messaggi in arrivo, stati di consegna,
     `payment.completed` e `signature.completed` valgono come tali solo se
     `events.connection_id` è un collegamento della stessa azienda della categoria giusta
     (`RESERVED_EVENT_SOURCES` in `packages/core`: WhatsApp, mail, SMS, social, pagamenti,
     firma; `policy.expiring` e `quote.expiring` dal gestionale, categoria `crm`). Altrimenti
     l'evento diventa `ignored` con il motivo in `error`: nessun contatto, nessun consenso,
     nessuna finestra aperta, nessun pagamento segnato, nessun flusso. Le scadenze del
     gestionale non hanno altro significato speciale: non sono messaggi in arrivo, avviano
     solo i flussi (`docs/decisioni/2026-10-06-15-scadenze-nel-gestionale.md`).
     Gli altri canali non possono comunque crearli: il «Webhook in ingresso» e i gestori
     (RLS) emettono solo i tipi aperti, `logic.for_each` solo `custom.*`.
   - Messaggio in arrivo (WhatsApp, mail, SMS, social): trova o crea contatto e
     conversazione, salva il messaggio (senza doppioni sull'id esterno), apre la
     finestra WhatsApp di 24 ore, registra il consenso del canale con origine
     "Messaggio ricevuto dal contatto" se manca. Poi: conversazione in carico a
     una persona → nessuna automazione; un flusso in attesa di risposta su quella
     conversazione → riprende; altrimenti cerca i flussi attivi.
   - Stato di consegna → aggiorna `messages.delivery_status` (mai all'indietro).
   - `payment.completed` e `signature.completed` → la richiesta di pagamento o di
     firma indicata dall'evento (con il nostro id o con quello del fornitore) passa
     a `paid` / `signed`; i flussi avviati dall'evento ricevono il suo contatto.
   - Flussi attivi con lo stesso evento, collegamento e filtri → crea
     `flow_runs` (una sola per evento e versione) ed esegue.
3. **Motore.** Un passo alla volta; dopo ogni passo salva posizione e contesto
   nella stessa transazione dell'esito del passo.
   - Ogni esecuzione di un passo è una riga di `flow_run_steps` con chiave
     `<id passo>` (oppure `<id passo>#n` dalla seconda volta: turni di `ai.reply`,
     cicli). Una riga già conclusa non viene mai rieseguita.
   - I blocchi che escono dalla piattaforma (invii, scritture sul gestionale,
     pagamenti…) lasciano una riga `running` prima di partire. Se dopo un
     riavvio la riga è ancora `running` l'esito è ignoto: il flusso si ferma con
     un errore chiaro e un avviso. Mai un doppio invio.
   - Le attese sono righe di `scheduled_jobs`, non timer in memoria.
   - Errore temporaneo del connettore (`ConnectorError` con `retryable`) →
     nuovo tentativo del passo con attesa crescente, al massimo 4 esecuzioni;
     poi `failed` e avviso. Errore definitivo → `failed` subito.
   - Prima di ogni invio: consenso del contatto per quel canale, quota messaggi,
     finestra di 24 ore per il testo libero WhatsApp. Prima di ogni chiamata IA:
     crediti residui; dopo, riga in `ai_calls` e crediti scalati.
   - Una risposta segue l'ultimo messaggio ricevuto nella conversazione: una mail
     porta il suo `Message-ID` (`inReplyTo`, oltre a `threadId`), un messaggio social
     esce sulla stessa piattaforma (Facebook o Instagram).
   - Tra più collegamenti della stessa categoria contano solo quelli il cui
     connettore sa davvero eseguire l'azione: un "Webhook in ingresso" non viene
     mai scelto per leggere o scrivere sul gestionale.
   - Il primo messaggio automatico di una conversazione porta la frase di
     `org_settings.ai_disclosure`, se il testo non dice già che è automatico. I
     modelli WhatsApp approvati partono così come sono.
4. **Scraping.** Riesegue la ricetta con Playwright, valida le righe, crea un
   evento solo per le righe nuove (`scrape:<ricetta>:<chiave>`). Le credenziali
   del sito restano nei segreti del collegamento, letti **solo** se il collegamento
   della ricetta appartiene alla stessa azienda ed è di tipo «Sito o portale»
   (`recipeSecrets`): una ricetta non può farsi consegnare i segreti di un altro
   collegamento. I valori `{{secrets.*}}` vengono scritti solo mentre il browser è su una
   pagina dello stesso sito della lettura (stesso dominio registrabile di `target_url`,
   mai da https a http) e mai dentro un indirizzo (`goto`); vale sia per la riesecuzione
   (`runRecipe`) sia per il tracciatore. La ricetta contiene
   `{{secrets.username}}` / `{{secrets.password}}`, il worker passa i valori al
   tracciatore (`secrets`), che li scrive nel browser e li nasconde al modello; gli
   errori salvati non li riportano mai. Una ricetta appena tracciata viene
   rieseguita da un browser appena aperto prima di essere salvata (quello del
   tracciatore ha già fatto l'accesso). Una tracciatura fallita dopo aver speso
   token è comunque scritta in `ai_calls`. Se fallisce o non
   trova righe valide, l'IA ritraccia il sito, la nuova ricetta viene provata
   subito e salvata come nuova versione. Dopo 3 riparazioni fallite la ricetta
   diventa `broken` e parte un avviso.

## Tipi di lavoro (`scheduled_jobs.kind`)

| Tipo | Contenuto | Cosa fa |
| --- | --- | --- |
| `resume_run` | `run_id`, `key`, `signal` | Riprende un flusso dopo `wait.delay` o dopo la pausa di un nuovo tentativo. Senza `key` recupera un flusso rimasto a metà. |
| `wait_timeout` | `run_id`, `key` | Scadenza di `wait.for_reply`, di un'approvazione o del silenzio in `ai.reply`: esce da `onTimeout`. |
| `send_message` | `message_id` | Invia il messaggio scritto da un operatore (`delivery_status = 'queued'`) con le stesse regole dei flussi. Un rifiuto resta scritto sul messaggio. |
| `approval_decided` | `approval_id` | Legge la decisione dal database e riprende da `onApproved` o `onRejected`. |
| `simulate_flow` | `flow_version_id`, `limit?`, `sample?` | Simula la versione sugli ultimi eventi compatibili (3, massimo 10). Con `sample: { payload }` simula una sola volta su quel contenuto inventato, senza creare eventi: è l'«evento di prova» dei flussi il cui trigger è riservato ai connettori. |
| `scrape_run` | `recipe_id` | Esegue una ricetta. |
| `scrape_trace` | `recipe_id` | Prima tracciatura con l'IA. La ricetta resta `draft` finché il cliente non la attiva. Se non esce un percorso che funziona il lavoro finisce `failed` con il motivo in `last_error` (senza altri tentativi: costerebbero crediti IA) e parte un avviso: è da lì che la pagina della lettura lo capisce. |
| `poll_connection` | `connection_id` | Chiama `connector.poll`, salva il cursore in `connections.config.cursor`, inserisce gli eventi, si ripianifica. L'intervallo chiesto dal collegamento (`config.pollIntervalMinutes`) è limitato tra 1 minuto e 24 ore. |
| `verify_connection` | `connection_id` | Chiama `connector.verify`, aggiorna stato e ultimo controllo; avvisa quando lo stato diventa `expired` o `error`. |
| `report` | — | Riepilogo settimanale con semplici conteggi, senza IA. |

Un passaggio ricorrente (ogni minuto) tiene in vita: una lettura per ogni
collegamento attivo che la prevede, un controllo al giorno per collegamento, una
esecuzione per ogni ricetta attiva (ogni `interval_minutes`), il riepilogo
settimanale, il recupero dei flussi rimasti `running` senza blocco.

**Lavori chiesti dagli utenti.** Una riga con `created_by` valorizzato arriva
dall'applicazione tramite RLS: il suo contenuto non è fidato. Il worker accetta
solo `send_message`, `approval_decided`, `simulate_flow`, `scrape_run`,
`scrape_trace`, `verify_connection`; cerca ogni record con
`organization_id` del lavoro, mai con il solo id del contenuto; rifiuta gli id
che non sono uuid. Un lavoro rifiutato diventa `failed` senza altri tentativi.
Il contenuto di questi lavori è controllato con `USER_JOB_PAYLOADS` di
`packages/core/src/jobs.ts`, lo stesso schema con cui il web lo costruisce.
La `dedupe_key` di un lavoro chiesto da un utente inizia sempre con `user:` (lo impone
RLS): le chiavi senza prefisso (`poll:`, `verify:`, `scrape:`, `report:`, `recover:`,
`retry:`…) sono del worker, che quando ne pianifica una si riprende comunque la riga che
la occupa. Un'azienda può avere al massimo 50 lavori e 100 eventi propri in attesa.

**Riferimenti dentro l'azienda.** Ogni riferimento tra tabelle del cliente è una chiave
esterna composta con `organization_id`, e ogni query del worker che segue un riferimento
(cronologia di `ai.reply`, approvazioni, ultimo messaggio ricevuto, versioni…) filtra anche
per `organization_id`.

**Definizioni.** La definizione di una versione viene ricontrollata con
`FlowDefinitionSchema` ogni volta che un'esecuzione parte o riprende (una versione può
essere inserita direttamente nel database): se non è valida l'esecuzione finisce `failed`
con un motivo e un avviso, senza tentativi a vuoto. Un flusso attivo con una versione non
valida non viene scelto per nessun evento.

**`ai.reply` e il gestionale.** Gli strumenti di lettura sono offerti al modello solo per
le risorse legate al contatto (`matchContact`) o dichiarate `public`. Per una risorsa
legata il worker forza nella ricerca il telefono (o la mail) del contatto dell'esecuzione,
scarta i record il cui campo non corrisponde (numeri normalizzati, mail in minuscolo) e
restituisce solo i campi in `fields`; al massimo 20 record. Chi scrive non può quindi
leggere i dati di un altro cliente nominando il suo numero d'ordine. Limite: il legame per
mail vale quanto vale il mittente di una mail (falsificabile se il dominio non ha SPF/DKIM).

**Avvisi.** Gli indirizzi in `notifications.link` si scrivono solo con `APP_LINKS`
(`packages/core/src/links.ts`): sono pagine vere del web, sotto `/app` (collegamento,
conversazione, approvazioni, esecuzione fallita, lettura da sito, report). Un test li
confronta con le cartelle di `apps/web/src/app`.

## Simulazione

`flow_runs.mode = 'simulation'`: nessuna chiamata esterna e nessuna scrittura
sui dati del cliente (contatti, trattative, messaggi, conversazioni,
appuntamenti, pagamenti, firme, approvazioni, avvisi).

- Ogni passo è salvato con stato `simulated` e un esito che mostra cosa
  sarebbe successo: testo del messaggio e destinatario, contatto e trattativa
  che verrebbero creati, dati che verrebbero scritti sul gestionale.
- Gli invii simulati riportano in `warnings` i motivi per cui l'invio reale
  verrebbe rifiutato (consenso mancante, finestra WhatsApp chiusa).
- Contatto e trattativa "virtuali" vivono nel contesto dell'esecuzione, così i
  passi successivi possono usare `{{contact.full_name}}` e `{{deal.title}}`.
- Le attese non attendono: `wait.delay` prosegue, `wait.for_reply` esce da
  `onReply` con una risposta di prova, `human.request_approval` esce da
  `onApproved`.
- `ai.extract`, `ai.classify`, `ai.summarize` chiamano davvero l'IA (con quota e
  costo). `ai.reply` genera una sola risposta e non la invia; gli strumenti di
  lettura del gestionale restituiscono un elenco vuoto.
- `crm.read` e `calendar.find_slots` non leggono i sistemi esterni: il primo
  restituisce un elenco vuoto, il secondo due orari di esempio.
- Una nuova simulazione sostituisce la precedente sullo stesso evento. Senza
  eventi compatibili la simulazione gira una volta su un evento vuoto.
- Le simulazioni non contano tra le esecuzioni né tra i messaggi del mese; i
  crediti IA sì.

## Avvio

Variabili d'ambiente:

| Variabile | Uso |
| --- | --- |
| `DATABASE_URL` | Postgres del progetto Supabase, con un ruolo che può eseguire le funzioni dei segreti (ruolo di servizio). Obbligatoria. |
| `DATABASE_SSL` | `false` per un database locale senza TLS. `DATABASE_SSL_VERIFY=true` per verificare il certificato. |
| `ANTHROPIC_API_KEY` | Senza chiave i blocchi IA falliscono con un messaggio chiaro e lo scraping non si ripara. |
| `AI_MODEL_SMART`, `AI_MODEL_FAST` | Facoltative: modelli diversi da quelli predefiniti (gli stessi nomi di `packages/ai`). I vecchi `AI_SMART_MODEL` e `AI_FAST_MODEL` sono ancora letti. |
| `DATABASE_POOL_SIZE` | Connessioni al database (predefinito 10). |
| `WORKER_CONCURRENCY` | Eventi e lavori in parallelo (predefinito 4). |
| `WORKER_MAX_ATTEMPTS` | Consegne di un evento o lavoro prima di segnarlo fallito (predefinito 5). |
| `OUTBOUND_OVERRIDE_RECIPIENT` | Ambienti non di produzione: ogni invio va a questo destinatario (telefono e/o mail separati da virgola). I canali senza destinatario di prova sono bloccati. |
| `WHATSAPP_TEST_RECIPIENT` | Come sopra, solo per WhatsApp e senza bloccare gli altri canali. |

Ai connettori (`ConnectorContext.env`) arrivano solo le variabili che iniziano con
`GOOGLE_`, `MICROSOFT_`, `META_`, `WAWEBAPI_`, `WEBHOOK_`: mai l'indirizzo del database,
la chiave IA o le chiavi Supabase. Un connettore che ne richiede altre va aggiunto a
`connectorEnv` in `src/deps.ts`.

```
npm run start -w @ia-connect/worker        # in locale
docker build -f apps/worker/Dockerfile -t ia-connect-worker .   # dalla radice
docker run --env-file .env ia-connect-worker
```

Con `SIGTERM` il worker finisce ciò che ha in corso e si ferma; ciò che resta a
metà riparte alla scadenza del blocco. I log sono righe JSON e non contengono
segreti né testi dei messaggi.

Test: `npx vitest run apps/worker` (database in memoria, nessun invio reale).
I file `test/integration-*.test.ts` usano i connettori veri di
`packages/connectors`, il servizio Claude vero di `packages/ai` e il deposito dei
segreti del worker su un Vault finto; è finta solo la rete (un `fetch` che
registra le richieste e un client Anthropic con risposte preparate). Gli altri
test usano connettori e IA finti.

## Limiti noti

- Più flussi in attesa sulla stessa conversazione: la risposta riprende solo il
  più recente.
- Con più collegamenti attivi della stessa categoria il passo deve indicare
  quale usare (salvo quello della conversazione in corso).
- Più risorse `readResources` con `matchContact` cercano con il primo recapito del
  contatto: un gestionale che salva il telefono in un altro formato non restituisce nulla
  (il filtro dopo la lettura confronta comunque i numeri normalizzati).

## Rete in uscita (SSRF)

Gli indirizzi scritti dai clienti (sito da leggere, API del gestionale, server di posta) e
quelli che una pagina fa aprire al browser non devono raggiungere la nostra rete.

- **Classificatore unico** in `packages/core/src/net.ts` (`isPublicAddress`,
  `isPublicHostname`, `assertPublicHost`): non pubblici gli indirizzi privati, loopback,
  link-local (metadati cloud), CGNAT `100.64.0.0/10`, unique-local, IPv4 dentro IPv6
  (`::ffff:`, NAT64, 6to4), non specificati, multicast e riservati; e i nomi `localhost`,
  `*.localhost`, `*.local`, `*.internal`, `host.docker.internal`, i nomi dei metadati,
  i nomi di una sola etichetta.
- **Browser dello scraping** (`src/scrape/playwright.ts`, `egress.ts`): tutto il traffico di
  Chromium passa da un proxy locale del worker. Per ogni connessione (navigazioni,
  **reindirizzamenti**, immagini, frame, `fetch`, WebSocket) il proxy risolve il nome,
  rifiuta se anche un solo indirizzo non è pubblico e si collega **all'indirizzo
  controllato**: il nome non può risolversi diversamente tra il controllo e la connessione.
  `context.route('**/*')` fa lo stesso controllo in anticipo e ammette solo http/https, ma
  da solo non basta: Playwright non lo chiama per i passaggi di un reindirizzamento.
  Service worker bloccati, WebRTC senza UDP diretto, nessun bypass del proxy per loopback
  e link-local (`<-loopback>`).
- **Connettori** con indirizzi del cliente (`crm_rest`, `scraper_site`): `guardedFetch`
  controlla nome e DNS (`ConnectorContext.resolveHost`, fornito da `main.ts`), segue i
  reindirizzamenti a mano (massimo 5, solo GET/HEAD) ricontrollando ogni passaggio e senza
  portare l'intestazione di autenticazione su un'altra origine. `imap_smtp` controlla i
  server di posta e si collega all'indirizzo controllato, con il nome per il certificato.

Rischio residuo e raccomandazione: per i connettori HTTP `fetch` risolve di nuovo il nome
dopo il controllo (DNS rebinding tra controllo e connessione); il proxy del browser e
`imap_smtp` non hanno questa finestra. **Il container del worker va comunque eseguito con
l'uscita verso gli intervalli privati bloccata a livello di rete** (regole del firewall o
della rete Docker: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`,
`100.64.0.0/10`, `fc00::/7`, `fe80::/10`), così un errore del controllo applicativo non
basta a raggiungere servizi interni.
