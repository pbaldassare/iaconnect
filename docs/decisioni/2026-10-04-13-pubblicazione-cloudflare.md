# Pubblicazione: un solo progetto Cloudflare Pages per sito e applicazione

Data: 2026-10-04 · Stato: decisa da Paolo (un solo progetto e un solo indirizzo), dettagli presi in autonomia

**Decisione.** Sito di presentazione e applicazione si pubblicano insieme, da un solo repository
e un solo progetto Cloudflare Pages. Il sito (`site/`) viene copiato in `apps/web/public` e
servito su `/`; l'applicazione Next.js è compilata con l'adattatore OpenNext e impacchettata come
`_worker.js` nella cartella `dist/`, insieme ai file statici e a `_routes.json`.

**Motivo.** Paolo vuole tutto collegato: un indirizzo, un progetto. Il pulsante "Area riservata"
del sito porta così a `/area-riservata` sullo stesso dominio, senza configurazione.

**Conseguenze.**
- OpenNext produce un'uscita per Workers; l'adattamento a Pages è fatto da `scripts/build-pages.mjs`
  ed è nostro, non una modalità ufficiale dell'adattatore. Va ricontrollato a ogni aggiornamento.
- Il server pesa 2,8 MB compressi; il piano gratuito ne ammette 3.
- Cloudflare oggi consiglia vinext per Next.js, che richiede Next.js 16 ed è in beta: da valutare
  al passaggio a Next.js 16.
- Il worker dei flussi resta su un VPS: usa Playwright e connessioni lunghe.
