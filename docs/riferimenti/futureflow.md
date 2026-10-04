# Futureflow — documentazione waWebApi

Appunti presi il 2026-10-04 dalla documentazione pubblica di waWebApi (versione 1.0):
https://infinity-digital.stoplight.io/docs/wawebapi/bkaibnti9tysr-wa-web-api

Descrizione nella fonte: "Api per l'invio di messaggi tramite waWebApi".
Serve come riferimento per riallineare il connettore `whatsapp_wawebapi`
(`packages/connectors/src/whatsapp-wawebapi.ts`), che oggi usa indirizzi e campi ipotizzati.

## Indirizzi

| Ambiente | Indirizzo |
| --- | --- |
| Server reale (come scritto nella documentazione) | `http://localhost:3000` |
| Server di prova (Stoplight) | `https://stoplight.io/mocks/infinity-digital/wawebapi/14362840` |

L'indirizzo reale dell'installazione va chiesto al fornitore: la documentazione riporta solo `localhost`.

## Autenticazione

Token nell'intestazione di ogni richiesta: `Authorization: Bearer <token>`.

## Campi comuni a tutte le chiamate

| Campo | Tipo | Obbligatorio | Significato |
| --- | --- | --- | --- |
| `instanceId` | stringa | sì | Istanza da cui parte il messaggio |
| `recipient` | stringa | sì | Numero del destinatario con prefisso internazionale, senza `+` (es. `393400000000`) |

Tutte le chiamate sono `POST` con corpo `application/json`.

## Chiamate

| Cosa invia | Percorso | Campi oltre a quelli comuni |
| --- | --- | --- |
| Messaggio di testo | `/api/message/text/{paramsPath}` | `message` (obbligatorio) |
| Immagine | `/api/message/image` | `imageUrl` (obbligatorio, indirizzo completo), `caption` |
| Video | `/api/message/video` | `videoUrl` (obbligatorio, indirizzo completo), `caption` |
| Audio | `/api/message/audio` | `audioUrl` (obbligatorio, indirizzo completo), `caption` |
| Documento | `/api/message/document` | `documentUrl` (obbligatorio, indirizzo completo), `caption` |
| Contatto | `/api/message/contact` | `fullName` (obbligatorio), `phoneNumber` (obbligatorio), `organization` |

`{paramsPath}` nella chiamata di testo è descritto come "Path of params on request json (keys
separated by dot)": il suo uso non è spiegato oltre e va chiarito con il fornitore.

Esempio (testo):

```bash
curl --request POST \
  --url <indirizzo>/api/message/text/{paramsPath} \
  --header 'Authorization: Bearer <token>' \
  --header 'Content-Type: application/json' \
  --data '{ "instanceId": "…", "recipient": "393400000000", "message": "…" }'
```

## Risposta

Codici dichiarati per ogni chiamata: `200`, `401`, `404`, `422`, `500`, `503`.
Con `200` ("Messaggio disposto per l'invio"):

```json
{
  "success": true,
  "data": {
    "key": { "remoteJid": "393400000000@s.whatsapp.net", "fromMe": true, "id": "BAE54E95D9C9B31F" },
    "message": { "extendedTextMessage": { "text": "…" } },
    "messageTimestamp": "1669410173",
    "status": "PENDING"
  }
}
```

- `data.key.id` è l'identificativo del messaggio.
- `data.message` cambia forma secondo il tipo: `extendedTextMessage`, `imageMessage`,
  `videoMessage`, `audioMessage`, `documentMessage`, `contactMessage`.
- `status` nell'esempio è sempre `PENDING`.

## Cosa la documentazione non copre

- **Ricezione**: nessuna chiamata o webhook per i messaggi in arrivo.
- **Stati di consegna**: nessun modo documentato per sapere se un messaggio è stato consegnato o letto.
- **Collegamento del numero**: nessuna chiamata per creare un'istanza o ottenere il codice QR.
- **Modelli**: non esistono modelli lato fornitore; si invia solo testo libero o file.
- **Limiti di invio** e significato dei codici d'errore.

Senza ricezione e stati di consegna il connettore può solo inviare: attese di risposta,
`ai.reply` e inbox non funzionano su questo canale finché il fornitore non offre anche quelli.

## Differenze con il connettore attuale

Il connettore `whatsapp_wawebapi` è stato scritto prima di avere questa documentazione. Da riallineare:
percorsi delle chiamate, nomi dei campi (`instanceId`, `recipient`, `message`), formato del numero
(senza `+`), lettura dell'identificativo da `data.key.id`. Le parti su codice QR, stato della
sessione e webhook in ingresso non hanno riscontro in questa documentazione.
