# Contratto dei connettori: webhook e polling al posto di `listen`

Data: 2026-10-04 · Stato: presa in autonomia

**Decisione.** Il metodo `listen?(connection): EventSource` della specifica diventa due metodi: `handleWebhook` (edge function) e `poll` (worker, a orari fissi).

**Motivo.** Le due sorgenti girano in posti diversi. Entrambe restituiscono eventi normalizzati con `dedupe_key`.
