# waWebApi allineato alla specifica Futureflow

Data: 2026-11-20 · Stato: presa

**Decisione.** Il connettore `whatsapp_wawebapi` parla l'API waWebApi 1.0
(Infinity Digital), sul server `https://whatsapp.futureflow.it` quando
l'indirizzo è quello del collegamento. Il fornitore predefinito resta Meta
Cloud API.

**Motivo.** La mappatura precedente (`/sessions`, `x-api-key`, QR creato da noi)
non esiste su quel server. L'invio vero è `POST /api/message/text` con Bearer.
I webhook sono documentati come schemi (`message`, `message_update`,
`connection`) e non hanno una chiamata di registrazione: l'indirizzo si incolla
nel pannello. Un numero già associato si collega con id istanza e token, senza
un QR nuovo.

**Conseguenza.** Pititto (e ogni altro cliente su questo gateway) è una riga
`connections`, non codice dedicato. Il token sta nel Vault.
