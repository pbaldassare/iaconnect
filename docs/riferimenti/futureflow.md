# Futureflow — waWebApi 1.0

Riletto il 2026-11-20 dalla specifica pubblica (OpenAPI 1.0, id `bkaibnti9tysr`):
https://infinity-digital.stoplight.io/docs/wawebapi/bkaibnti9tysr-wa-web-api

Il connettore `whatsapp_wawebapi` segue questo contratto. Il server in uso per
Ass.ni Pititto è `https://whatsapp.futureflow.it` (la specifica scrive solo
`http://localhost:3000`).

## Autenticazione

`Authorization: Bearer <token>` su ogni chiamata di invio. Un corpo senza token
è accettato: il token nel JSON non è richiesto. Senza Bearer la risposta è `401`.

## Invio

`POST /api/message/text` con `Content-Type: application/json`.

| Campo | Obbligatorio | Significato |
| --- | --- | --- |
| `instanceId` | sì | Istanza da cui parte il messaggio |
| `recipient` | sì | Numero con prefisso internazionale, senza `+` |
| `message` | sì | Testo |

La specifica scrive il percorso come `/api/message/text/{paramsPath}` e non spiega
`paramsPath`. Sul server Futureflow la route che esiste è `/api/message/text`,
senza quel segmento. Il connettore usa questa.

Risposta `200`:

```json
{
  "success": true,
  "data": {
    "key": { "remoteJid": "393400000000@s.whatsapp.net", "fromMe": true, "id": "BAE54E95D9C9B31F" },
    "status": "PENDING"
  }
}
```

L'identificativo del messaggio è `data.key.id`.

Stessi campi comuni per immagine, video, audio, documento e contatto
(`/api/message/image`, `/video`, `/audio`, `/document`, `/contact`), con
`imageUrl`, `videoUrl`, `audioUrl`, `documentUrl` oppure `fullName` e
`phoneNumber`. Il connettore oggi invia solo testo: i modelli del motore
diventano `message`.

Codici: `401` token non valido, `404` istanza assente, `422` campi mancanti,
`503` dispositivo non connesso (ritentabile).

## Webhook in ingresso

La specifica descrive il corpo, non una chiamata per registrare l'indirizzo.
L'indirizzo del collegamento (`…/webhook/c/<token>`) va incollato nel pannello
Futureflow. Non c'è firma: l'autenticazione è il token nel percorso.

| `type` | `body` | Effetto nel connettore |
| --- | --- | --- |
| `message` (o tipo omesso, `body` oggetto) | `key`, `message`, `pushName`, `messageTimestamp` | `whatsapp.message.received` se `fromMe` non è vero |
| `message_update` | array di `{ key, update: { status } }` | `whatsapp.status.updated` |
| `connection` | `{ connection: "open" \| "close" \| "connecting" }` | stato del collegamento, nessun evento di flusso |

Mittente: cifre di `key.remoteJid` prima di `@`. Un jid che finisce in `@lid`
non è un numero e il messaggio non diventa un contatto.

Testo: `message.conversation`, oppure `extendedTextMessage.text`, oppure la
didascalia di immagine, video o documento.

Stati di `update.status`: `0` errore, `2` inviato, `3` consegnato, `4` letto,
`5` letto (nota vocale riprodotta). `1` (in attesa) non genera un evento.

I file arrivano cifrati (`url` + `mediaKey`). Il payload tiene `mediaUrl` e non
scarica il file.
