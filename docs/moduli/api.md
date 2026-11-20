# API di piattaforma

Lettura, per collegare IA Connect ad altri software. Non sostituisce l'area
cliente e non invia messaggi.

## Due livelli

| Livello | Chi | Dove |
| --- | --- | --- |
| Admin | `platform_admin` | `/admin`: tutte le aziende, le chiavi, lo storico di ogni cliente |
| Cliente | `org_owner`, `org_member` | `/app`: una sola azienda. Inbox, contatti, flussi, collegamenti |

Un cliente è una riga `organizations`. Pititto è una di queste. Non c'è codice
con il nome di un cliente.

Un admin di piattaforma che è anche membro di un'azienda passa da un'area
all'altra con «Area cliente» e «Area admin».

## Storico

Le tabelle sono `conversations` e `messages`.

- Il cliente le vede in `/app/inbox`.
- L'admin le vede in `/admin/aziende/[id]?scheda=conversazioni`.
- Un'altra piattaforma le legge dagli endpoint qui sotto.

Ci entra ciò che IA Connect registra: messaggi arrivati dal webhook e invii
fatti dall'Inbox o da un flusso. Un invio fatto sul pannello del fornitore,
fuori da IA Connect, non compare.

L'API non ha un endpoint di invio. L'invio controlla consenso del contatto,
finestra del canale e quota dell'azienda, e questo resta nel prodotto.

## Chiavi

Si creano in `/admin/api`. La chiave intera (`iac_` più 64 caratteri esadecimali)
si vede una volta sola. In database restano:

- `key_prefix`: i primi 12 caratteri, per riconoscerla nell'elenco
- `key_hash`: SHA-256 esadecimale della chiave intera

Una chiave revocata smette di funzionare subito. Cancellare l'azienda cancella
le sue chiavi.

| Ambito | `organization_id` | Legge |
| --- | --- | --- |
| Piattaforma | nullo | tutte le aziende |
| Cliente | l'id dell'azienda | solo quell'azienda |

Emettere e revocare scrive `audit_log` (`api_keys.issue`, `api_keys.revoke`)
con il prefisso, mai con la chiave.

## Chiamate

Base: l'indirizzo del sito, per esempio `https://iaconnect.pages.dev`.
Il cookie di accesso non serve. Manca la chiave di servizio sul server: `503`.

```http
Authorization: Bearer iac_…
```

| Metodo e percorso | Cosa restituisce |
| --- | --- |
| `GET /api/v1/organizations` | le aziende visibili alla chiave |
| `GET /api/v1/organizations/{organizationId}/conversations` | le conversazioni di quell'azienda |
| `GET /api/v1/organizations/{organizationId}/conversations/{conversationId}/messages` | i messaggi di quella conversazione |

Query, sulle liste di conversazioni e messaggi:

| Parametro | Default | Regola |
| --- | --- | --- |
| `limit` | 50 | intero da 1 a 100 |
| `before` | assente | istante ISO: solo righe con `created_at` precedente |

L'ordine è dal più recente. La risposta è `{ "data": [ ... ] }`.

Azienda:

```json
{ "id": "uuid", "name": "Pititto Assicurazioni", "sector": "insurance", "status": "active", "created_at": "2026-11-20T18:00:00.000Z" }
```

Conversazione:

```json
{
  "id": "uuid",
  "contact_id": "uuid",
  "contact_name": "Mario Rossi",
  "channel": "whatsapp",
  "status": "open",
  "last_message_at": "2026-11-20T18:00:00.000Z",
  "unread_count": 1,
  "created_at": "2026-11-20T17:00:00.000Z"
}
```

Messaggio:

```json
{
  "id": "uuid",
  "direction": "in",
  "channel": "whatsapp",
  "content": "Buongiorno",
  "delivery_status": "received",
  "external_id": null,
  "created_at": "2026-11-20T18:00:00.000Z"
}
```

`direction` è `in` o `out`. `channel` è `whatsapp`, `mail`, `sms` o `social`.
`delivery_status` è `queued`, `sent`, `delivered`, `read`, `failed`, `received`
o `simulated`.

## Errori

Corpo: `{ "error": "<codice>" }`. Nessun dettaglio interno.

| HTTP | `error` | Quando |
| --- | --- | --- |
| 401 | `unauthorized` | chiave assente, malformata, sconosciuta o revocata |
| 403 | `forbidden` | la chiave è di un'altra azienda |
| 404 | `not_found` | percorso, azienda o conversazione inesistenti |
| 400 | `invalid_query` | `limit` o `before` non validi |
| 405 | `method_not_allowed` | metodo diverso da GET |
| 503 | `unavailable` | il server non ha la chiave di servizio |
| 500 | `internal` | errore non previsto; il testo non esce |

Una chiave di un cliente che chiede l'id di un'altra azienda riceve 403, anche
se quell'azienda non esiste. Così la risposta non dice quali aziende ci sono.

## Esempio

```bash
curl -s https://iaconnect.pages.dev/api/v1/organizations \
  -H "Authorization: Bearer iac_…"

curl -s "https://iaconnect.pages.dev/api/v1/organizations/ORGANIZATION_ID/conversations?limit=20" \
  -H "Authorization: Bearer iac_…"

curl -s "https://iaconnect.pages.dev/api/v1/organizations/ORGANIZATION_ID/conversations/CONVERSATION_ID/messages?before=2026-11-20T18:00:00.000Z" \
  -H "Authorization: Bearer iac_…"
```

La pagina successiva usa il `created_at` dell'ultima riga ricevuta come `before`.
