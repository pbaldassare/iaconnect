# Admin, cliente e API di lettura

Data: 2026-11-20 · Stato: presa

**Decisione.** I clienti restano righe `organizations`. Pititto è una di queste,
senza codice dedicato. L'admin di piattaforma vede ogni azienda; il titolare e
i collaboratori vedono solo la propria, nell'area `/app`.

Lo storico è `conversations` e `messages`, le stesse righe dell'Inbox. L'admin
le legge nella scheda azienda, sezione Conversazioni. Le altre piattaforme le
leggono da `GET /api/v1`, con una chiave Bearer.

Una chiave con `organization_id` nullo legge tutti i clienti. Una chiave con
l'azienda impostata legge solo quella. In tabella stanno il prefisso e l'hash
SHA-256, mai la chiave. Emetterla e revocarla è un'azione da admin di
piattaforma e scrive `audit_log`.

**Motivo.** Serviva un confine netto tra chi gestisce la piattaforma e chi usa
il prodotto, uno storico consultabile anche fuori dall'Inbox, e un modo
documentato per collegare altri software senza dare la chiave di servizio
Supabase e senza un ramo per cliente.

**Conseguenza.** L'API non invia messaggi. L'invio resta nell'Inbox e nei
flussi, dove passano consenso, finestra e quota. Un messaggio partito fuori da
IA Connect non entra nello storico. Specifica: `docs/moduli/api.md`.
