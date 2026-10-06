# Assicurapp — polizze e preventivi in scadenza

Appunti presi il 2026-10-06 dalle indicazioni del cliente sul gestionale assicurativo
"Assicurapp". Servono al collegamento `crm_rest` (`packages/connectors/src/crm-rest.ts`) e ai
modelli di flusso `insurance_policy_renewal` e `insurance_quote_expiring`.

> **Non verificato dal vivo.** La forma qui sotto è quella comunicata dal cliente; il test di
> integrazione `apps/worker/test/integration-renewals.test.ts` la riproduce con un server finto.
> Da confermare al primo collegamento reale: forma del corpo degli errori, presenza di tutti i
> campi, formato dei numeri di telefono.

## Indirizzo

Una chiamata per agenzia:

```
GET {BASE_URL}/api/policies/expiring_api
Authorization: Bearer <token API dell'agenzia>
```

Parametro facoltativo nell'indirizzo: `client_code` (il codice cliente dell'agenzia; se non
corrisponde al token la risposta è `403 client_code_mismatch`).

L'indirizzo di base (`BASE_URL`) e il token vanno chiesti al cliente; il token è un segreto e
nel collegamento vive solo nel Vault (`secrets.authHeaderValue`).

## Risposta

```json
{
  "status": "success",
  "quotes": [
    {
      "quoteUID": "0199…",
      "plate": "GA123BC",
      "client_name": "MARIO ROSSI",
      "client_cf": "RSSMRA80A01H501U",
      "phone": "3331234567",
      "email": "mario@example.com",
      "product_name": "RCA Auto",
      "creator_name": "Luca Bianchi",
      "created_at": "2026-09-12T08:30:00.000Z",
      "current_company": "ZAVAROVALNICA TRIGLAV D.D.",
      "expire_date": "2026-10-17",
      "days_left": 15
    }
  ],
  "policies": [
    {
      "policyUID": "0198…",
      "quoteUID": "0198…",
      "policy_num": "123456789",
      "company_slug": "groupama",
      "expire_date": "2026-10-20",
      "days_left": 18,
      "created_at": "2025-10-20T09:00:00.000Z",
      "plate": "FX456DE",
      "client_name": "ANNA VERDI",
      "client_cf": "VRDNNA75B41F205X",
      "phone": "3337654321",
      "email": "anna@example.com",
      "product_name": "RCA Auto",
      "policy_price": "412.50",
      "creator_name": "Luca Bianchi"
    }
  ]
}
```

| Elenco | Contenuto | Identificativo |
| --- | --- | --- |
| `quotes` | Preventivi fatti dall'agenzia per targhe **assicurate altrove**, la cui copertura scade entro 30 giorni. Una riga per targa: il preventivo più recente. | `quoteUID` |
| `policies` | Polizze **dell'agenzia** che scadono entro 30 giorni. | `policyUID` |

Campi utili: `plate` (targa), `client_name`, `client_cf` (codice fiscale), `phone` (senza
prefisso internazionale: la piattaforma lo normalizza in `+39…`), `email`, `product_name`,
`expire_date` (giorno `AAAA-MM-GG`), `days_left`, `current_company` (solo preventivi),
`company_slug`, `policy_num` e `policy_price` (euro, come testo; solo polizze).

Le righe **restano nell'elenco finché la scadenza non passa**: non esiste una nozione di
"nuove dall'ultima volta". È il collegamento a ricordare gli identificativi già visti (vedi
`crm_rest` in `docs/moduli/connettori.md`).

## Errori

| HTTP | Codice nel corpo | Significato | Cosa fa il connettore |
| --- | --- | --- | --- |
| 401 | `token_revoked` | Token revocato | Accesso scaduto: lo stato del collegamento diventa `expired`, avviso al cliente |
| 403 | `api_token_required` | Manca il token | Come sopra |
| 403 | `scope_not_allowed` | Il token non può leggere le scadenze | Errore definitivo con il messaggio «il token API non ha il permesso di leggere questa risorsa»; lo stato diventa `error` |
| 403 | `client_code_mismatch` | `client_code` diverso dal token | Errore definitivo con messaggio dedicato |

Il codice viene cercato nei campi `error`, `code`, `error_code`, `reason`, `message` del
corpo JSON (anche dentro un oggetto con `code`). Il testo del corpo non compare mai nei
messaggi d'errore né nei log: solo il codice conosciuto e il nostro messaggio in italiano.

## Configurazione del collegamento

`connections.config` (parte non segreta) per Assicurapp, come la salva la procedura guidata
o un amministratore via SQL:

```json
{
  "baseUrl": "https://<indirizzo del gestionale>",
  "authHeaderName": "Authorization",
  "pollIntervalMinutes": 1440,
  "resources": {
    "quotes": {
      "listPath": "/api/policies/expiring_api",
      "recordsPath": "quotes",
      "idField": "quoteUID",
      "watch": true,
      "initialPoll": "emit",
      "eventType": "quote.expiring",
      "contactFields": { "name": "client_name", "phone": "phone", "email": "email" }
    },
    "policies": {
      "listPath": "/api/policies/expiring_api",
      "recordsPath": "policies",
      "idField": "policyUID",
      "watch": true,
      "initialPoll": "emit",
      "eventType": "policy.expiring",
      "contactFields": { "name": "client_name", "phone": "phone", "email": "email" }
    }
  }
}
```

Segreto (Vault, tramite `connector.connect` o `ia_connect.set_connection_secrets`):
`{ "authHeaderValue": "Bearer <token API>" }`.

Facoltativo: `"query": { "client_code": "<codice>" }` dentro ogni risorsa aggiunge il
parametro alla chiamata.

Con `pollIntervalMinutes: 1440` il worker legge l'elenco una volta al giorno (il massimo
ammesso). Il primo controllo emette un evento per ogni riga presente (`initialPoll: "emit"`);
i successivi solo per le righe nuove. Le due risorse chiamano lo stesso indirizzo: due
richieste al giorno.
