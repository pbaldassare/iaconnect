# Scadenze del gestionale: eventi, contatti e trattative, nessuna tabella dedicata

Data: 2026-10-06 · Stato: presa in autonomia

**Contesto.** Il gestionale di un'agenzia assicurativa (Assicurapp, vedi
`docs/riferimenti/assicurapp-scadenze.md`) espone l'elenco delle polizze proprie e dei
preventivi per targhe assicurate altrove in scadenza entro 30 giorni. L'agenzia vuole che
ogni riga diventi un contatto avvisato su WhatsApp e una trattativa di rinnovo da seguire.

**Decisione.**

1. Una scadenza **non è un'entità della piattaforma**: non nasce una tabella `renewals`.
   È un evento (`policy.expiring`, `quote.expiring`) letto dal collegamento `crm_rest`, che
   un flusso trasforma in ciò che la piattaforma già conosce: un contatto (con codice
   fiscale tra i campi extra), un messaggio da modello WhatsApp, una trattativa nella fase
   «In scadenza» (`renewal_due`) con i dati della scadenza nei **campi delle trattative**
   (`targa`, `scadenza`, `compagnia`, `premio`, `tipo`, `numero_polizza` /
   `compagnia_attuale`). La vista «Scadenze» dell'elenco delle trattative legge il campo
   `scadenza` e ordina per data.
2. I due tipi di evento sono **riservati al collegamento `crm`** (`RESERVED_EVENT_SOURCES`):
   valgono solo se `events.connection_id` è un gestionale della stessa azienda. Non sono tipi
   aperti (un cliente, il webhook generico o `logic.for_each` non possono crearli) e non sono
   messaggi in arrivo (nessuna conversazione, nessun consenso implicito).
3. Il connettore `crm_rest` resta generico: le opzioni per risorsa `initialPoll`, `eventType`,
   `contactFields`, `query` sono additive e facoltative. **Il primo controllo emette tutto**
   (`initialPoll: "emit"`): l'intero elenco è da lavorare, a differenza di un elenco di
   ordini dove solo i nuovi interessano. La «novità» di una riga è decisa dagli
   identificativi già visti, conservati nel cursore del collegamento: l'API non ha un
   «dal».
4. **Lettura giornaliera** (`pollIntervalMinutes: 1440`, il massimo ammesso dal worker):
   l'elenco cambia una volta al giorno e ogni riga resta finché la scadenza non passa; una
   lettura più frequente non porterebbe nulla e costerebbe chiamate al gestionale.
5. I modelli di flusso dichiarano in `requirements` anche le **fasi** e i **campi delle
   trattative** che usano; l'installazione dal web li crea se mancano (la fase dopo
   l'ultima aperta, prima di «vinta» e «persa»; i campi in coda a quelli esistenti).

**Motivo.** Nessuna migrazione, nessuna pagina nuova, nessun codice di settore: il motore,
le trattative, i consensi, le quote e l'inbox valgono già per le scadenze. Una tabella
dedicata avrebbe richiesto RLS, pagine, report e un secondo posto in cui seguire lo stesso
cliente. Il costo è che la data di scadenza vive in un campo JSON (`deals.custom_fields`):
la vista «Scadenze» la legge in memoria sulle trattative aperte (fino a 3.000, come la
lavagna), senza indici dedicati. Se un giorno servirà di più, si potrà promuovere il campo a
colonna con una migrazione, senza cambiare i flussi.

**Limiti noti.**

- I modelli non sanno formattare le date: nei messaggi WhatsApp la scadenza compare come
  `AAAA-MM-GG` (`expire_date` così com'è). Il cliente può riscrivere il modello su Meta con
  un testo che la introduca («entro il giorno …»).
- Il nome del contatto arriva in maiuscolo dal gestionale e così viene salvato.
- Una riga che esce dall'elenco e vi rientra con lo stesso identificativo non genera un nuovo
  evento finché il cursore la ricorda (al massimo 10.000 identificativi per risorsa).
