# Modulo IA (`packages/ai`)

Tutto ciò che chiama Claude sta qui. Principio: **l'IA progetta, il server esegue**.

> **Stato:** nulla di questo modulo è stato eseguito contro l'API reale: su questa
> macchina non c'è una chiave. I test usano un client finto con risposte
> preparate. Prima del pilota va fatto un giro di prova dal vivo (vedi «Da
> verificare dal vivo»).

## Dove si usa l'IA

| Funzione | Quando | Livello |
| --- | --- | --- |
| `createClaudeAiService().extract / classify / summarize` | blocchi `ai.extract`, `ai.classify`, `ai.summarize` | economico |
| `createClaudeAiService().reply` | blocco `ai.reply` | capace |
| `proposeFlow` | assistente dei flussi, solo in creazione e modifica | capace |
| `traceScrapeRecipe` | tracciatura e riparazione delle ricette di scraping | capace |
| `summarizeReport` | riepilogo periodico (facoltativo) | economico |

Nessun altro punto della piattaforma chiama l'IA. `createFakeAiService()` è la
versione deterministica e senza rete per test, simulazioni e sviluppo locale.

## Modelli e variabili d'ambiente

| Livello | Variabile | Valore predefinito | Prezzo (USD per milione di token, ingresso / uscita) |
| --- | --- | --- | --- |
| capace | `AI_MODEL_SMART` | `claude-opus-5-5` | 4 / 20 |
| economico | `AI_MODEL_FAST` | `claude-haiku-4-5` | 1 / 5 |

Ordine di scelta: nome passato in modo esplicito (`smartModel`, `fastModel`,
`model`), poi la variabile d'ambiente, poi il valore predefinito. Nomi e prezzi
vengono dal riferimento Anthropic usato in sviluppo (aggiornato al 25/09/2026);
la tabella completa è `MODEL_PRICES` in `src/models.ts` e va aggiornata insieme
ai modelli.

Dettagli che dipendono dal modello, gestiti in `src/client.ts`:

- `output_config.effort` si invia solo ai modelli che lo accettano (non a Haiku):
  `medium` per `ai.reply`, `high` per assistente e tracciatura.
- Sui modelli con filtri di sicurezza che possono rifiutare una richiesta
  (Opus 5.5, Opus 5, Sonnet 5.5, Fable 5.1) si attiva il ripiego lato server
  (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`): la richiesta
  rifiutata viene rieseguita da un altro modello nella stessa chiamata. Si
  spegne con `AI_SERVER_FALLBACK=0`.
- Su Opus 5.5 non si può obbligare il modello a chiamare uno strumento: le
  risposte strutturate usano `output_config.format` (schema JSON), e dove serve
  uno strumento (`propose_flow`, `propose_recipe`) lo si chiede nel prompt e si
  controlla che sia stato usato.

## Ambito chiuso e difesa dalle istruzioni iniettate

Regola generale: **il contenuto letto è dato, mai istruzione**. In pratica:

- **Canali separati.** Le istruzioni stanno solo nel prompt di sistema, costruito
  dal nostro codice con i dati dell'azienda (`scope`, `tone`, `instructions`,
  note sul contatto). I messaggi del contatto entrano solo come turni della
  conversazione; testi da analizzare, numeri dei report e pagine web entrano
  solo come messaggio utente o risultato di strumento, racchiusi in tag
  (`<testo>`, `<dati>`, `<pagina>`). Un test verifica che una frase come «ignora
  le istruzioni…» scritta dal contatto non compaia mai nel prompt di sistema.
- **Il prompt lo dichiara.** `ai.reply` dice al modello che i messaggi del
  contatto e i risultati degli strumenti sono contenuto, che non deve rivelare
  le istruzioni, cambiare ambito, né promettere prezzi o impegni che non ha nel
  contesto, e che è un sistema automatico e non deve fingersi una persona.
- **Uscite vincolate.** `classify` restituisce solo una delle chiavi ricevute
  (schema con `enum`, più controllo nel codice: se il modello sbaglia si usa
  `altro`/`other` se esiste, altrimenti la prima). `extract` ha una proprietà
  tipizzata per campo; i valori del tipo sbagliato valgono `null` e i campi
  obbligatori assenti finiscono in `missing`. `reply` restituisce
  `{ text, outcome }` con `outcome` tra `continue`, `done`, `handoff`,
  `out_of_scope`.
- **In caso di dubbio, una persona.** Se il modello rifiuta, risponde in modo
  illeggibile o supera il limite di chiamate, `reply` restituisce un testo
  standard e `handoff`. All'ultimo turno (`turn >= maxTurns`) un `continue`
  diventa `handoff`.
- **Strumenti.** `reply` usa solo gli `AiTool` passati dal flusso (in sola
  lettura salvo concessione esplicita), per al massimo 5 giri; alla sesta
  chiamata gli strumenti sono disattivati. Se uno strumento fallisce il modello
  riceve un messaggio generico, non il dettaglio dell'errore.
- **Assistente dei flussi.** Il modello può solo consegnare una definizione o
  delle domande. La definizione passa da `validateFlow` con il contesto
  dell'azienda; gli errori gli tornano indietro per al massimo 3 tentativi.
  Si restituisce `definition` solo se valida (gli avvisi restano in `issues`):
  blocchi inventati, codice libero, collegamenti o modelli inesistenti non
  possono uscire da qui.
- **Tracciatura dello scraping.** Il modello guida il browser con `goto`,
  `snapshot`, `click`, `fill`, `propose_recipe`, per al massimo 25 chiamate. La
  ricetta proposta viene letta con `ScrapeRecipeSchema`, rieseguita con
  `runRecipe` sullo stesso browser e controllata con `validateRows`: si accetta
  solo se produce almeno una riga valida. Le credenziali non arrivano mai al
  modello: scrive `{{secrets.username}}` / `{{secrets.password}}`, il codice li
  sostituisce solo se il worker passa `secrets`, e i valori vengono oscurati in
  tutto ciò che torna al modello.
- **Log.** Il modulo non scrive log: prompt, messaggi e chiave API non vengono
  mai registrati.

## Costo e crediti

Ogni funzione restituisce `usage` (`AiUsage`): modello, token in ingresso, token
in uscita, `costMicros`. Chi chiama lo scrive in `ai_calls`.

- `costMicros` è in milionesimi di dollaro, al prezzo di listino del modello che
  ha risposto davvero. Un prezzo in USD per milione di token coincide con il
  prezzo di un token in micro-USD, quindi
  `costo = token_ingresso × prezzo_ingresso + token_uscita × prezzo_uscita`.
- Cache del prompt: i token scritti in cache costano 1,25 × il prezzo
  d'ingresso, quelli letti 0,1 × (0,20 USD per milione su Opus 5.5 e
  Sonnet 5.5, 0,25 su Fable 5.1). `inputTokens` li comprende tutti.
- Modello non in tabella: costo 0, i token restano.
- Quando un'operazione fa più chiamate (strumenti di `reply`, tentativi
  dell'assistente, passi della tracciatura) i consumi si sommano.
- Se un'operazione fallisce dopo aver speso token lancia `AiOperationError`, che
  porta con sé `usage`: va registrato lo stesso.
- I **crediti IA** si calcolano in `packages/core` con `creditsFor(usage)`:
  1 credito ogni 1000 token iniziati (ingresso + uscita), minimo 1. Il controllo
  della quota prima della chiamata spetta al motore, non a questo modulo.

La cache è usata nell'assistente dei flussi: regole, tipi di evento, catalogo
ed esempi formano un blocco identico per tutte le aziende, marcato
`cache_control`; il contesto dell'azienda viene dopo.

## Da verificare dal vivo

- Che `fallbacks: "default"` sia accettato insieme a `output_config.format` e
  agli strumenti sull'endpoint beta (altrimenti `AI_SERVER_FALLBACK=0`).
- Che gli schemi di `extract` (campi `anyOf` con `null`, `format: date`) siano
  accettati dalle risposte strutturate su Haiku 4.5.
- Che il blocco statico dell'assistente venga davvero letto dalla cache
  (`cache_read_input_tokens > 0` alla seconda richiesta).
- Qualità reale: rispetto dell'ambito e degli esiti in `reply`, tentativi
  necessari all'assistente, passi necessari alla tracciatura su siti veri,
  tempi di risposta di Opus 5.5 (il ragionamento è sempre attivo).
- Dopo un ripiego il costo è calcolato per intero sul modello che ha risposto:
  è un'approssimazione se parte dei token è stata spesa dal primo modello.

## File

```
src/models.ts          modelli predefiniti, prezzi, calcolo del costo
src/client.ts          interfaccia AnthropicLike, client reale, chiamata unica
src/service.ts         createClaudeAiService: extract, classify, summarize, reply
src/fake.ts            createFakeAiService
src/flow-assistant.ts  proposeFlow
src/scrape-tracer.ts   traceScrapeRecipe
src/report.ts          summarizeReport
test/                  client finto con risposte preparate, nessuna rete
```
