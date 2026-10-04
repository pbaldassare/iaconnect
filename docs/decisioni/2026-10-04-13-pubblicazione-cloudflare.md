# Pubblicazione: Cloudflare Pages per il sito, Workers con OpenNext per l'applicazione

Data: 2026-10-04 · Stato: decisa da Paolo (Cloudflare), dettagli presi in autonomia

**Decisione.** Il sito di presentazione va su Cloudflare Pages come sito statico. L'applicazione
Next.js va su Cloudflare Workers con l'adattatore OpenNext.

**Motivo.** Paolo ha collegato il repository a Cloudflare. Cloudflare oggi consiglia vinext per
Next.js, ma richiede Next.js 16 ed è in beta; l'applicazione è su Next.js 15, che OpenNext supporta.

**Quando rivederla.** Al passaggio a Next.js 16 (che chiude anche l'avviso su `postcss`) si può
valutare vinext. Il worker dei flussi resta su un VPS: usa Playwright e connessioni lunghe.
