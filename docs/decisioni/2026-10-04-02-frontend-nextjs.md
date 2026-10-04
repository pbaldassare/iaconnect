# Framework frontend: Next.js

Data: 2026-10-04 · Stato: provvisoria, presa in autonomia su delega di Paolo

**Decisione.** Next.js (App Router) con React, TypeScript e Tailwind.

**Motivo.** Era la proposta della specifica. Le azioni lato server tengono la chiave di servizio fuori dal browser (inviti, collegamenti OAuth) senza un backend separato.

**Alternativa scartata.** React + Vite: più semplice, ma servirebbe un servizio a parte per ogni operazione con segreti.
