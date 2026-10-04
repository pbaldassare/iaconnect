# Stato dei lavori

Aggiornato: 2026-10-04.

Il codice di tutte le fasi della specifica (0–3) è scritto e collaudato con test automatici.
Nessuna parte è ancora stata provata con servizi reali: mancano le chiavi, le app dei fornitori
e un cliente pilota. Le verifiche di fine fase che richiedono clienti veri restano da fare.

## Cosa c'è

| Parte | Contenuto | Verifica |
| --- | --- | --- |
| Database | 36 tabelle nello schema `ia_connect`, RLS su tutte, chiavi esterne legate all'azienda, registro immutabile, quote, segreti in Vault | Applicato al progetto Supabase reale; test di isolamento in memoria |
| `packages/core` | Schema dei flussi, 28 blocchi, validatore, modelli per tre settori, contratti dei connettori | Test unitari |
| `packages/connectors` | 14 connettori: Gmail, Microsoft 365, IMAP/SMTP, WhatsApp Meta, waWebApi, gestionale REST, webhook generico, Google Calendar, Meta social, GoHighLevel, Twilio, sito da leggere, Stripe, firma tramite link | Test con rete simulata |
| `packages/ai` | Blocchi `ai.*`, assistente dei flussi, tracciatura e riparazione dello scraping | Test con modello simulato |
| `apps/worker` | Coda eventi, motore dei flussi, attese e solleciti, simulazione, scraping con Playwright, lavori pianificati | Test su database in memoria, compreso il flusso pilota da capo a fondo |
| `apps/web` | Area cliente (Inizio, Collegamenti, Flussi, Inbox, Contatti, Trattative, Report, Impostazioni) e area admin | Build, tipi e test della logica; la sola pagina di accesso è stata aperta nel browser |
| `supabase/functions/webhook` | Webhook in ingresso | Mai eseguita (Deno non installato) |
| `site/` | Pagina di presentazione | Aperta nel browser |

Controlli al momento della consegna: 539 test, controllo dei tipi, lint e build dell'interfaccia passano.

## Verifiche di fase

| Fase | Verifica richiesta dalla specifica | Stato |
| --- | --- | --- |
| 0 | Un evento attraversa un flusso, invia un messaggio al numero di test, crea una trattativa; due aziende isolate | Dimostrato dai test con connettore simulato. Manca l'invio vero al numero di prova |
| 1 | Il pilota usa il flusso su dati reali per due settimane | Da fare |
| 2 | Un cliente nuovo crea e attiva un flusso da solo | Da fare |
| 3 | Due settori venduti, un rivenditore attivo | Da fare |

## Cosa serve per accenderlo

In ordine. Senza i primi quattro passi l'interfaccia mostra "non disponibile" dopo l'accesso.

1. **Esporre lo schema.** Supabase → Project Settings → API → Exposed schemas: aggiungere `ia_connect`.
2. **Indirizzi di accesso.** Supabase → Authentication → URL Configuration: aggiungere
   `<APP_URL>/auth/callback` ai Redirect URLs.
3. **Primo amministratore.** Creare il proprio utente (Authentication → Add user), poi nell'editor SQL:
   ```sql
   insert into ia_connect.memberships (user_id, role)
   select id, 'platform_admin' from auth.users where email = 'LA-TUA-MAIL';
   ```
4. **Variabili d'ambiente.** Copiare `.env.example` e compilare almeno: `SUPABASE_SERVICE_ROLE_KEY`,
   `DATABASE_URL`, `ANTHROPIC_API_KEY`, `APP_URL`, `OAUTH_STATE_SECRET` (`openssl rand -hex 32`).
   Fuori produzione impostare `OUTBOUND_OVERRIDE_RECIPIENT`: ogni messaggio va a quel recapito.
5. **App dei fornitori.** Google (Gmail, Calendar), Microsoft Entra, Meta (WhatsApp, pagine, Instagram):
   creare le app, registrare `<APP_URL>/api/oauth/<connettore>/callback`, compilare le variabili relative.
   Dettagli in [moduli/connettori.md](moduli/connettori.md).
6. **Webhook.** Pubblicare la edge function (`supabase functions deploy webhook`) e provarla: non è mai
   stata eseguita. Nell'app Meta puntare WhatsApp a `…/webhook/p/whatsapp_meta` e le pagine a
   `…/webhook/p/meta_social`.
7. **Worker.** Costruire l'immagine con `apps/worker/Dockerfile` su un VPS in UE. Bloccare a livello
   di rete l'uscita verso indirizzi privati (elenco in [moduli/worker.md](moduli/worker.md)).
8. **Interfaccia.** Pubblicare `apps/web` su un servizio che esegue Next.js, con le stesse variabili.

## Decisioni da confermare

Prese in autonomia e segnate come provvisorie in [decisioni/](decisioni/): Next.js, code su tabelle
al posto di pgmq, Meta Cloud API come WhatsApp predefinito, Meta diretto per i social, modelli Claude
su due livelli, Twilio per gli SMS, VPS Hetzner, canone a pacchetti (i prezzi nel database sono
segnaposto), Stripe per i pagamenti.

Da decidere ancora: il fornitore di firma elettronica (oggi c'è un segnaposto senza valore legale)
e se passare a un progetto Supabase dedicato prima dei clienti veri (oggi gli utenti sono condivisi
con "alter ego").

## Limiti noti

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
