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
   - Messaggio in arrivo (WhatsApp, mail, SMS, social): trova o crea contatto e
     conversazione, salva il messaggio (senza doppioni sull'id esterno), apre la
     finestra WhatsApp di 24 ore, registra il consenso del canale con origine
     "Messaggio ricevuto dal contatto" se manca. Poi: conversazione in carico a
     una persona → nessuna automazione; un flusso in attesa di risposta su quella
     conversazione → riprende; altrimenti cerca i flussi attivi.
   - Stato di consegna → aggiorna `messages.delivery_status` (mai all'indietro).
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
   - Il primo messaggio automatico di una conversazione porta la frase di
     `org_settings.ai_disclosure`, se il testo non dice già che è automatico. I
     modelli WhatsApp approvati partono così come sono.
4. **Scraping.** Riesegue la ricetta con Playwright, valida le righe, crea un
   evento solo per le righe nuove (`scrape:<ricetta>:<chiave>`). Se fallisce o non
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
| `simulate_flow` | `flow_version_id`, `limit?` | Simula la versione sugli ultimi eventi compatibili (3, massimo 10). |
| `scrape_run` | `recipe_id` | Esegue una ricetta. |
| `scrape_trace` | `recipe_id` | Prima tracciatura con l'IA. La ricetta resta `draft` finché il cliente non la attiva. |
| `poll_connection` | `connection_id` | Chiama `connector.poll`, salva il cursore in `connections.config.cursor`, inserisce gli eventi, si ripianifica. |
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
| `AI_SMART_MODEL`, `AI_FAST_MODEL` | Facoltative: modelli diversi da quelli predefiniti. |
| `WORKER_CONCURRENCY` | Eventi e lavori in parallelo (predefinito 4). |
| `OUTBOUND_OVERRIDE_RECIPIENT` | Ambienti non di produzione: ogni invio va a questo destinatario (telefono e/o mail separati da virgola). I canali senza destinatario di prova sono bloccati. |
| `WHATSAPP_TEST_RECIPIENT` | Come sopra, solo per WhatsApp e senza bloccare gli altri canali. |

Le altre variabili d'ambiente sono passate ai connettori (`ConnectorContext.env`).

```
npm run start -w @ia-connect/worker        # in locale
docker build -f apps/worker/Dockerfile -t ia-connect-worker .   # dalla radice
docker run --env-file .env ia-connect-worker
```

Con `SIGTERM` il worker finisce ciò che ha in corso e si ferma; ciò che resta a
metà riparte alla scadenza del blocco. I log sono righe JSON e non contengono
segreti né testi dei messaggi.

Test: `npx vitest run apps/worker` (database in memoria, connettori e IA
finti, nessun invio reale).

## Limiti noti

- Più flussi in attesa sulla stessa conversazione: la risposta riprende solo il
  più recente.
- Con più collegamenti attivi della stessa categoria il passo deve indicare
  quale usare (salvo quello della conversazione in corso).
- Il controllo sugli indirizzi dello scraping (niente rete interna) vale per
  l'indirizzo richiesto, non per eventuali reindirizzamenti.
