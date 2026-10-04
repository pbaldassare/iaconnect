# Sicurezza: il database come confine, non le azioni del server

Data: 2026-10-04 · Stato: presa dopo la verifica di sicurezza

**Decisione.**

1. `connections` è scritta solo dal server (funzione `save_connection`, ruolo di servizio,
   per conto dell'utente che ha superato `connector.connect`). I clienti leggono e rinominano.
   Un account del fornitore ha un solo collegamento non scollegato in tutta la piattaforma.
2. Ogni riferimento tra tabelle del cliente è una chiave esterna composta con
   `organization_id`.
3. I tipi di evento con un significato per la piattaforma (messaggi in arrivo, stati di
   consegna, pagamenti, firme) sono riservati ai connettori: né i gestori, né il «Webhook in
   ingresso», né `logic.for_each` possono crearli, e il worker li accetta solo da un
   collegamento della categoria giusta. L'«evento di prova» di quei flussi è una simulazione.
4. Le righe di `audit_log` nascono solo da trigger e da `log_action`, che ricavano l'attore
   dalla sessione. Le scritture del server per conto di un utente passano l'utente con
   l'impostazione di transazione `ia_connect.actor_id`.
5. Il browser dello scraping esce solo attraverso un proxy del worker che controlla e fissa
   l'indirizzo di ogni connessione; i connettori con indirizzi del cliente seguono i
   reindirizzamenti a mano.
6. `ai.reply` legge dal gestionale solo risorse legate al contatto (`matchContact`) o
   dichiarate pubbliche.

**Motivo.** RLS controllava solo `organization_id` della riga scritta e i gestori possono
parlare con PostgREST senza passare dalle azioni del server: bastava inserire un
collegamento con l'identificativo dell'account di un altro cliente per riceverne i messaggi,
o una ricetta che indicava il collegamento di un'altra azienda per leggerne i segreti. Le
azioni del server restano (danno messaggi migliori), ma non sono più il confine.

**Conseguenze.** Creare, ricollegare e scollegare un collegamento richiede la chiave di
servizio sul server web. `OAUTH_STATE_SECRET` e, in produzione, `APP_URL` sono obbligatorie.
I flussi esistenti con `readResources` senza `matchContact` né `public: true` non offrono
più quella lettura all'assistente finché non vengono corretti. Dettagli:
`supabase/migrations/20261004001000_security_hardening.sql`, `docs/moduli/web.md`
(«Sicurezza»), `docs/moduli/worker.md` («Rete in uscita»), `docs/moduli/connettori.md`.

**Non fatto.** Letture del personale condizionate a una sessione di assistenza aperta;
CSP con nonce. Entrambe descritte come punti aperti in `docs/moduli/web.md`.
