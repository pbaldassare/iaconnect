# Registrazione libera, azienda attiva solo dopo l'approvazione di un admin

Data: 2026-10-04 · Stato: chiesta da Paolo (area riservata pubblica con Registrati e Accedi), dettagli presi in autonomia

**Decisione.** Chiunque può creare un account dall'area riservata (`/registrati`) e chiedere
l'accesso per la propria azienda. La richiesta è una riga di `ia_connect.access_requests`
(`pending`, `approved`, `rejected`), una per utente. Finché un amministratore della piattaforma non
la approva da `/admin/richieste`, per quella persona in IA Connect non esiste nient'altro: né
azienda, né ruolo, né dati. L'approvazione crea l'azienda sotto il rivenditore `default` con il
piano scelto dall'admin e fa del richiedente il titolare. Gli inviti restano come prima.

La tabella si scrive solo attraverso due funzioni del database: `request_access` (l'utente, con
mail confermata, senza alcun ruolo) e `decide_access_request` (solo admin di piattaforma). Gli
amministratori dei rivenditori per ora non vedono le richieste.

**Motivo.** Il principio 2 della specifica resta intatto («l'admin attiva l'azienda»), ma il primo
passo lo fa il cliente da solo: non serve più che qualcuno crei l'azienda e mandi un invito prima
ancora di sapere chi è l'interessato. Tenere richiesta e azienda separate evita di avere nel
database aziende «a metà» create da sconosciuti, con le loro impostazioni, fasi e quote: una
richiesta rifiutata o abbandonata non lascia nulla da ripulire. Le regole stanno nel database e
non nelle pagine perché un utente con una sessione può parlare direttamente con l'API.

**Conseguenze.**

- Essere entrati non significa più avere un accesso: dopo ogni accesso l'app decide dove mandare
  la persona (area admin, area cliente, «Richiesta ricevuta», «Completa la registrazione»).
- **Ogni registrazione crea un utente nel progetto Auth condiviso con "alter ego"**, anche se la
  richiesta viene poi rifiutata, e gli utenti di quell'applicazione possono entrare qui (arrivano
  a «Completa la registrazione»). Limiti di invio, conferma della mail, modelli delle mail e
  CAPTCHA sono impostazioni uniche per le due applicazioni. È un motivo in più per passare a un
  progetto Supabase dedicato prima dell'apertura al pubblico (vedi la decisione 01).
- Il modulo è pubblico: prima di pubblicizzarlo va attivato un CAPTCHA (ad esempio Cloudflare
  Turnstile) in Supabase Auth e aggiunto al modulo. Oggi ci sono solo i limiti di Supabase Auth,
  un campo trappola, un tempo minimo di compilazione e i limiti di lunghezza nel database.
- La pagina `/privacy` è un segnaposto: il testo dell'informativa va fornito dal titolare prima
  dell'apertura. La data in cui la persona ha spuntato la casella resta nei metadati dell'utente.
- Nessuna mail avvisa l'admin di una nuova richiesta né la persona dell'esito: l'admin vede il
  contatore nell'area admin, la persona l'esito nella propria pagina. Servirà un invio di mail
  dell'applicazione (oggi partono solo le mail di Supabase Auth).
- Una richiesta rifiutata e poi inviata di nuovo perde la nota del rifiuto precedente nella
  tabella; resta nel registro (`access_request.reject`).

**Quando rivederla.** All'arrivo dei rivenditori (fase 3): a chi va la richiesta di un'azienda
arrivata dal sito di un rivenditore, e chi la approva.
