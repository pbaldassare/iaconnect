# IA Connect

Piattaforma multi-cliente che collega i sistemi di una PMI (mail, gestionale, WhatsApp, social, siti)
e li trasforma in flussi automatici eseguiti lato server.

- Specifica: [docs/PROGETTO.md](docs/PROGETTO.md)
- Stato dei lavori e cosa resta da fare: [docs/STATO.md](docs/STATO.md)
- Decisioni: [docs/decisioni/](docs/decisioni/)
- Moduli: [docs/moduli/](docs/moduli/)

## Struttura

```
apps/web             applicazione Next.js: area cliente (/app) e area admin (/admin)
apps/worker          motore dei flussi, code, pianificazione, scraping
packages/core        schema dei flussi, catalogo dei blocchi, contratti, tipi del database
packages/connectors  un modulo per servizio esterno
packages/ai          tutto ciò che chiama Claude
supabase/migrations  schema ia_connect, RLS, funzioni
supabase/functions   webhook in ingresso (edge function)
site/                pagina di presentazione
```

## Comandi

```bash
npm install            # dipendenze di tutti i pacchetti
npm test               # tutti i test (il database gira in memoria, non serve Supabase)
npm run typecheck      # controllo dei tipi
npm run lint           # Biome
npm run dev -w @ia-connect/web       # sito su http://localhost:3000, area riservata su /accedi
npm run build          # sito + applicazione in dist/ (quello che pubblica Cloudflare Pages)
npm run start -w @ia-connect/worker  # worker (richiede DATABASE_URL)
npm run gen:types      # rigenera i tipi del database dopo una migrazione
npm run gen:seed       # rigenera il seed dei modelli di flusso
```

## Primo avvio

Le variabili sono elencate in [.env.example](.env.example). I passi da fare una volta sola sono in
[docs/STATO.md](docs/STATO.md), sezione "Cosa serve per accenderlo".
