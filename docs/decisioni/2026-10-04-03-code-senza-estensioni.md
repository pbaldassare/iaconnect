# Code e pianificazione: tabelle Postgres al posto di pgmq e pg_cron

Data: 2026-10-04 · Stato: provvisoria, presa in autonomia su delega di Paolo

**Decisione.** La coda eventi è la tabella `events` (stato, tentativi, `locked_until`) e la pianificazione è `scheduled_jobs`. Il worker prende le righe con `FOR UPDATE SKIP LOCKED`.

**Motivo.** Il progetto Supabase è condiviso con un'altra applicazione: attivare pgmq e pg_cron cambierebbe il progetto per tutti. Le tabelle danno le stesse garanzie (almeno-una-volta, ripresa dopo riavvio) e si collaudano in memoria.

**Quando rivederla.** Con un progetto Supabase dedicato si può passare a pgmq: il motore usa un'interfaccia di coda, quindi cambia solo l'implementazione.
