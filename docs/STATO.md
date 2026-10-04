# Stato dei lavori

Aggiornato: 2026-10-04.

Il codice di tutte le fasi della specifica (0–3) è scritto e collaudato con test automatici.
Nessuna parte è ancora stata provata con servizi reali: mancano le chiavi, le app dei fornitori
e un cliente pilota. Le verifiche di fine fase che richiedono clienti veri restano da fare.

## Cosa c'è

| Parte | Contenuto | Verifica |
| --- | --- | --- |
| Database | 37 tabelle nello schema `ia_connect`, RLS su tutte, chiavi esterne legate all'azienda, registro immutabile, quote, segreti in Vault | Applicato al progetto Supabase reale, **tranne la migrazione `20261004002000_access_requests.sql`** (richieste di accesso), ancora da applicare; test di isolamento in memoria |
| `packages/core` | Schema dei flussi, 28 blocchi, validatore, modelli per tre settori, contratti dei connettori | Test unitari |
| `packages/connectors` | 14 connettori: Gmail, Microsoft 365, IMAP/SMTP, WhatsApp Meta, waWebApi, gestionale REST, webhook generico, Google Calendar, Meta social, GoHighLevel, Twilio, sito da leggere, Stripe, firma tramite link | Test con rete simulata |
| `packages/ai` | Blocchi `ai.*`, assistente dei flussi, tracciatura e riparazione dello scraping | Test con modello simulato |
| `apps/worker` | Coda eventi, motore dei flussi, attese e solleciti, simulazione, scraping con Playwright, lavori pianificati | Test su database in memoria, compreso il flusso pilota da capo a fondo |
| `apps/web` | Area cliente (Inizio, Collegamenti, Flussi, Inbox, Contatti, Trattative, Report, Impostazioni), area admin, area riservata pubblica (Registrati, Accedi, Password dimenticata, richiesta di accesso con approvazione) | Build, tipi e test della logica; la sola pagina di accesso è stata aperta nel browser. Registrazione e recupero password mai provati con Supabase Auth |
| `supabase/functions/webhook` | Webhook in ingresso | Mai eseguita (Deno non installato) |
| `site/` | Pagina di presentazione | Aperta nel browser |

Controlli al momento della consegna: 583 test, controllo dei tipi, lint e build dell'interfaccia passano.

## Verifiche di fase

| Fase | Verifica richiesta dalla specifica | Stato |
| --- | --- | --- |
| 0 | Un evento attraversa un flusso, invia un messaggio al numero di test, crea una trattativa; due aziende isolate | Dimostrato dai test con connettore simulato. Manca l'invio vero al numero di prova |
| 1 | Il pilota usa il flusso su dati reali per due settimane | Da fare |
| 2 | Un cliente nuovo crea e attiva un flusso da solo | Da fare |
| 3 | Due settori venduti, un rivenditore attivo | Da fare |

## Cosa serve per accenderlo

Già fatto il 2026-10-04:

- Lo schema `ia_connect` è esposto nell'API (vedi nota sotto).
- L'utente `paolo.baldassare@gmail.com` è amministratore della piattaforma. Si entra con la stessa
  password usata per "alter ego".
- I file `.env` (radice) e `apps/web/.env.local` esistono, con i valori pubblici e un
  `OAUTH_STATE_SECRET` generato. Non sono nel repository.

**Come si entra.** Dal sito di presentazione il pulsante dell'area riservata porta a
`<APP_URL>/area-riservata`. Chi ha un invito entra come prima. Chi non ce l'ha si registra da
`/registrati`, conferma la mail e resta su «Richiesta ricevuta» finché un amministratore della
piattaforma non approva la richiesta da Area admin → Richieste, scegliendo il piano: in quel
momento nasce l'azienda e la persona ne diventa titolare. Il primo amministratore resta una riga
messa a mano in `ia_connect.memberships` (non si diventa admin registrandosi). Dettagli in
[moduli/web.md](moduli/web.md) e in
[decisioni/2026-10-04-14-registrazione-con-approvazione.md](decisioni/2026-10-04-14-registrazione-con-approvazione.md).

Resta da fare, in ordine:

1. **Chiavi.** Compilare in `.env` e in `apps/web/.env.local` le righe vuote:
   `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `ANTHROPIC_API_KEY`, `OUTBOUND_OVERRIDE_RECIPIENT`.
   Accanto a ciascuna c'è scritto dove si trova.
2. **Prova in locale.** `npm run dev -w @ia-connect/web` e, in un altro terminale,
   `npm run start -w @ia-connect/worker`. Entrare su http://localhost:3000, creare un'azienda di prova
   dall'area admin e percorrere le pagine: nessuna è stata ancora usata con un accesso vero.
3. **Indirizzi di accesso.** Supabase → Authentication → URL Configuration: aggiungere
   `<APP_URL>/auth/callback` ai Redirect URLs. Serve per il link via mail, gli inviti, la conferma
   della registrazione e il recupero della password; l'accesso con password funziona anche senza.
4. **Registrazione.** Prima di dare a qualcuno l'indirizzo dell'area riservata:
   - applicare al database la migrazione `supabase/migrations/20261004002000_access_requests.sql`;
   - in Supabase → Authentication controllare che le registrazioni via mail siano permesse e che
     la conferma della mail sia attiva (sono impostazioni condivise con "alter ego", come i modelli
     delle mail: la mail di conferma e quella di recupero hanno oggi il suo aspetto e il suo nome);
   - fornire il testo dell'informativa per `/privacy` (oggi è un segnaposto dichiarato);
   - prima dell'apertura al pubblico: attivare un CAPTCHA in Supabase Auth e aggiungerlo al modulo
     (non fatto), e decidere il passaggio a un progetto Supabase dedicato.
   Nessuna mail avvisa di una nuova richiesta: va guardato il contatore nell'area admin.
5. **Webhook.** Pubblicare la edge function e provarla (non è mai stata eseguita; il suo codice si
   compila in un unico file senza moduli Node):
   ```bash
   npx supabase login
   npx supabase functions deploy webhook --project-ref ywsolxklcyctrezngclz
   ```
6. **App dei fornitori.** Google (Gmail, Calendar), Microsoft Entra, Meta (WhatsApp, pagine, Instagram):
   creare le app, registrare `<APP_URL>/api/oauth/<connettore>/callback`, compilare le variabili relative.
   Nell'app Meta puntare WhatsApp a `…/webhook/p/whatsapp_meta` e le pagine a `…/webhook/p/meta_social`.
   Dettagli in [moduli/connettori.md](moduli/connettori.md).
7. **Worker.** Costruire l'immagine con `apps/worker/Dockerfile` su un VPS in UE. Bloccare a livello
   di rete l'uscita verso indirizzi privati (elenco in [moduli/worker.md](moduli/worker.md)).
8. **Pubblicazione su Cloudflare.** Due progetti distinti sullo stesso repository:
   - **Sito di presentazione** (Cloudflare Pages): comando di build `npm run build`, cartella di
     uscita `dist`. La configurazione è in `wrangler.jsonc` nella radice; il nome lì dentro
     (`iaconnect`) deve coincidere con quello del progetto Pages.
   - **Applicazione** (Cloudflare Workers, adattatore OpenNext): comando di build `npm run build:app`,
     comando di deploy `npm run deploy:app`. Le variabili segrete (`SUPABASE_SERVICE_ROLE_KEY`,
     `ANTHROPIC_API_KEY`, `OAUTH_STATE_SECRET`, `APP_URL` e quelle dei fornitori) vanno aggiunte nel
     progetto Workers come segreti. In locale la build e la pagina di accesso funzionano nel motore
     di Workers; le pagine con accesso e il connettore IMAP/SMTP lì non sono stati provati.

**Nota sullo schema esposto.** L'esposizione è fatta con un'impostazione del database, non dalla
pagina di Supabase, quindi in Project Settings → API l'elenco mostra ancora solo `public` e
`graphql_public`:

```sql
alter role authenticator set pgrst.db_schemas = 'public, graphql_public, ia_connect';
notify pgrst, 'reload config';
```

Questa impostazione prevale su quella della pagina. Per aggiungere in futuro un altro schema va
ripetuto il comando con l'elenco completo; per tornare alla pagina:
`alter role authenticator reset pgrst.db_schemas;`.

## Decisioni da confermare

Prese in autonomia e segnate come provvisorie in [decisioni/](decisioni/): Next.js, code su tabelle
al posto di pgmq, Meta Cloud API come WhatsApp predefinito, Meta diretto per i social, modelli Claude
su due livelli, Twilio per gli SMS, VPS Hetzner, canone a pacchetti (i prezzi nel database sono
segnaposto), Stripe per i pagamenti.

Da decidere ancora: il fornitore di firma elettronica (oggi c'è un segnaposto senza valore legale)
e se passare a un progetto Supabase dedicato prima dei clienti veri (oggi gli utenti sono condivisi
con "alter ego": con la registrazione libera ogni iscritto a IA Connect diventa un utente anche lì,
e viceversa).

## Limiti noti

- **Registrazione:** senza CAPTCHA, con l'informativa da scrivere e senza mail di avviso all'admin e
  al richiedente. Mai provata con Supabase Auth.
- **Mai provato dal vivo:** tutti i connettori, le chiamate a Claude, la edge function, l'immagine Docker,
  ogni pagina dell'interfaccia che richiede l'accesso.
- **waWebApi e GoHighLevel:** le chiamate sono ipotesi da confrontare con i prodotti reali.
- **Consenso nei modelli di flusso:** i modelli registrano il consenso WhatsApp con origine "richiesta di
  preventivo" o "ordine". Se questa base è adeguata va valutato con chi cura la privacy del cliente.
- **Modello e-commerce:** legge gli ordini cercando il telefono del contatto nel campo `phone` del
  gestionale; il nome del campo va adattato a ogni cliente.
- **Accesso in assistenza:** è tracciato e visibile al cliente, ma un admin può leggere i dati di
  un'azienda anche senza aprire una sessione. Renderla obbligatoria è un punto aperto.
- **Ricerca contatti:** per telefono e mail trova solo il valore intero.
- **Dipendenze:** resta un avviso su `postcss` incluso in Next.js 15; si risolve passando a Next.js 16.
- **Dopo la fase 3** (agente vocale, marketplace): non iniziato, come da specifica.

## Sicurezza

Una verifica di sicurezza sul codice ha trovato 17 punti, uno critico (un titolare poteva ricevere i
messaggi in arrivo di un'altra azienda). Sono stati corretti tutti, ciascuno con un test che lo blocca;
la sintesi è in [decisioni/2026-10-04-12-rafforzamento-sicurezza.md](decisioni/2026-10-04-12-rafforzamento-sicurezza.md).
Prima di mettere dati reali conviene una seconda verifica indipendente sul sistema in funzione.
