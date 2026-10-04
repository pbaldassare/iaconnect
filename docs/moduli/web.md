# Modulo web (`apps/web`)

Un'unica applicazione Next.js (App Router) con due aree: **area cliente** (`/app/...`) e
**area admin** (`/admin/...`). Qui c'è la base comune (sessione, azienda corrente, guscio,
componenti) e le parti già complete: Inizio, registro del cliente, tutta l'area admin.

Stato: fondamenta + area admin fatte. Collegamenti, Flussi, Inbox, Contatti, Trattative,
Report e Impostazioni sono pagine segnaposto da sostituire.

## Comandi

```
npm run dev -w @ia-connect/web          # sviluppo
npm run build -w @ia-connect/web        # build di produzione
npm run typecheck -w @ia-connect/web
npx vitest run apps/web                 # test delle funzioni pure
npx biome check apps/web                # --write per formattare
```

Se `typecheck` segnala file mancanti sotto `.next/types`, è un residuo di una build
precedente (una pagina spostata o cancellata): `rm -rf apps/web/.next` e rilancia.

## Configurazione

`apps/web/.env.local`:

| Variabile | Serve per |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client con la sessione dell'utente (obbligatorie) |
| `APP_URL` | indirizzo pubblico dell'app, usato nei link delle mail (accesso, inviti) |
| `SUPABASE_SERVICE_ROLE_KEY` | solo server: mail di invito, indirizzi degli utenti, ricerca utente per mail, marchio del rivenditore per i clienti |

Senza `SUPABASE_SERVICE_ROLE_KEY` l'app funziona lo stesso; le funzioni che la richiedono
lo dicono a schermo in italiano (vedi «Cosa cambia senza chiave di servizio»).

Da fare in Supabase prima di usare l'app:

1. **Esporre lo schema**: Project Settings → API → Exposed schemas → aggiungere `ia_connect`.
   Finché manca, dopo l'accesso si arriva a `/non-disponibile`.
2. **Indirizzi di ritorno**: Authentication → URL Configuration → aggiungere
   `<APP_URL>/auth/callback` tra i Redirect URLs. Il progetto è condiviso con alter ego:
   Site URL e modelli delle mail sono i suoi, quindi le mail di accesso e di invito hanno
   oggi il suo aspetto.
3. **Primo amministratore**: una riga in `ia_connect.memberships` con
   `role = 'platform_admin'` per il proprio utente (non c'è una pagina per farlo, di proposito).

## Struttura

```
apps/web
  next.config.ts          transpilePackages, serverExternalPackages, intestazioni di sicurezza
  src/middleware.ts       rinnova la sessione; chi non è entrato va a /accedi
  src/app
    layout.tsx, globals.css        font, token di colore, tema
    accedi/                        accesso con password o link via mail
    auth/callback, auth/conferma   arrivo dei link delle mail
    imposta-password/              scelta o cambio della password
    nessuna-azienda/, non-disponibile/
    app/                           AREA CLIENTE (layout = guscio + azienda corrente)
      page.tsx                     Inizio
      collegamenti/ flussi/ inbox/ contatti/ trattative/ report/   segnaposto
      impostazioni/page.tsx        segnaposto (tenere il link al registro)
      impostazioni/registro/       registro delle azioni dell'azienda
    admin/                         AREA ADMIN
      aziende/ aziende/nuova/ aziende/[id]/ aziende/[id]/export
      catalogo/ piani/ rivenditori/ rivenditori/[id]/ monitoraggio/ registro/
  src/components
    ui/                   kit di componenti (vedi sotto)
    shell/                guscio: barra laterale, cambio azienda, tema, azioni di sessione
    audit-table.tsx, usage-meters.tsx, placeholder.tsx
  src/lib                 sessione, client Supabase, formattazione, regole pure
  test/                   test Vitest delle funzioni pure
```

### Mappa delle pagine

| Indirizzo | Chi | Cosa |
| --- | --- | --- |
| `/accedi` | tutti | mail + password, oppure «Ricevi un link via mail» |
| `/auth/callback` | — | scambia il codice del link, accetta gli inviti, prosegue |
| `/auth/conferma` | — | link che portano la sessione nel frammento dell'indirizzo (inviti) |
| `/imposta-password` | utente | sceglie o cambia la password |
| `/nessuna-azienda` | utente | nessuna azienda collegata, oppure azienda sospesa |
| `/non-disponibile` | utente | il database non si legge (schema non esposto) |
| `/app` | membri, assistenza | Inizio |
| `/app/<sezione>` | membri, assistenza | le sette sezioni |
| `/app/impostazioni/registro` | membri | registro delle azioni, accessi dell'assistenza marcati |
| `/admin/aziende`, `/nuova`, `/[id]` | admin piattaforma e rivenditore | elenco, creazione, scheda |
| `/admin/aziende/[id]/export` | come sopra | scarica il JSON di `export_organization` |
| `/admin/registro` | come sopra | registro con filtri |
| `/admin/catalogo`, `/piani`, `/rivenditori`, `/monitoraggio` | solo admin piattaforma | |

La scheda azienda usa `?scheda=` per le sezioni: `dati`, `utenti`, `collegamenti`, `flussi`,
`consumi`, `funzioni`, `personalizzazioni`, `assistenza`.

## Sessione, azienda corrente, assistenza

Tutto in `src/lib/session.ts` (solo server). **Il confine di sicurezza è la RLS**: questi
aiutanti aggiungono solo reindirizzamenti e comodità.

| Funzione | Restituisce | Se non va |
| --- | --- | --- |
| `getSession()` | utente, `memberships`, `isPlatformAdmin`, `resellerIds`, `isStaff` | `null` |
| `requireUser()` | la sessione | → `/accedi` |
| `requireOrg()` | `{ supabase, session, org, organizations }` | → `/accedi`, `/admin` (staff senza azienda), `/nessuna-azienda` |
| `requireOrgManager()` | come sopra, solo chi può gestire | 404 |
| `requireStaff()` | `{ supabase, session }` per admin di piattaforma o rivenditore | 404 |
| `requirePlatformAdmin()` | `{ supabase, session }` | 404 |
| `requireStaffForOrg(id)` | `{ supabase, session, organization }` | 404 |
| `actorOf(context)` | `{ id, type: "user" \| "admin" }` per registro e richieste al motore | — |

`org` contiene: `organization` (riga), `mode` (`"member"` o `"support"`), `membership`,
`canManage` (titolare, `permissions.manage`, oppure assistenza), `supportSession`.

**Azienda corrente.** Cookie `org` (httpOnly). La scelta è in `lib/org-selection.ts`
(`selectOrganization`, con test): il cookie vale se l'utente è membro di quell'azienda;
altrimenti si usa la prima azienda in ordine di nome. Il cambio azienda (visibile con più
di un'azienda) passa dall'azione `switchOrganization`, che accetta solo aziende di cui si è membri.

**Accesso in assistenza.** Dalla scheda azienda → «Assistenza e dati» l'admin scrive un
motivo; l'azione inserisce una riga in `support_sessions`, imposta il cookie `org` ed entra
in `/app`. Il cookie di un'azienda di cui non si è membri vale **solo** se esiste una
sessione di assistenza aperta, dello stesso admin, per quella stessa azienda, iniziata da
meno di 8 ore. In assistenza compare la fascia «Stai lavorando come assistenza su …» con
«Esci dall'assistenza», che imposta `ended_at`, toglie il cookie e torna alla scheda. Anche
uscire dall'account o passare a una propria azienda chiude la sessione. I trigger del
database marcano `is_support_access` su ogni modifica fatta dallo staff: il cliente le vede
in Impostazioni → Registro con l'etichetta «Assistenza».

**Inviti.** Nessuna registrazione libera. L'invito è una riga in `invitations`; a ogni
accesso (`/accedi`, `/auth/callback`, `/auth/conferma`, e in `/nessuna-azienda`) si chiama
`accept_invitations()`, che la trasforma in appartenenza.

**Layout.** I layout di `/app` e `/admin` disegnano il guscio ma **non sono un controllo**:
ogni pagina e ogni azione chiama da sé `requireOrg()` / `requireStaff()` ecc. (il risultato
è in cache per la richiesta, non costa nulla ripeterlo).

## Aspetto

Token in `src/app/globals.css`, gli stessi di `site/index.html`: sfondo carta con griglia,
verde per l'accento, **ambra solo per ciò che è IA**. Tema chiaro e scuro seguono il sistema;
`<html data-theme="light|dark">` li forza (pulsante «Tema chiaro / scuro», cookie `theme`).

Si usano solo le classi Tailwind mappate sui token, mai colori scritti a mano:

| Classi | Uso |
| --- | --- |
| `bg-bg`, `bg-surface`, `bg-surface-2` | sfondo pagina, superfici, superfici secondarie |
| `text-ink`, `text-muted` | testo, testo secondario |
| `border-line`, `border-line-strong` | bordi, bordi dei campi |
| `bg-accent`, `text-on-accent`, `bg-accent-soft`, `text-accent-strong` | azione principale, stato positivo |
| `bg-ai-soft`, `text-ai` | solo IA |
| `bg-warn-soft`, `text-warn` | attenzione (ocra, diverso dall'ambra dell'IA) |
| `bg-danger`, `text-danger`, `bg-danger-soft` | errori e azioni distruttive |
| `font-display`, `font-sans`, `font-mono` | titoli, testo, etichette e dati |
| `rounded-panel`, `shadow-panel` | raggio e ombra delle superfici |

Marchio: `org_settings.brand` e `resellers.brand` hanno `{ name, logoUrl, accent }`
(`lib/brand.ts` li valida: colore solo `#rrggbb`, logo solo `https`). Il guscio mostra
nome e logo; il colore tinge soltanto il riquadro del marchio, non l'accento dell'interfaccia
(così il contrasto resta garantito nei due temi).

## Kit di componenti

Ogni file in `src/components/ui/` comincia con un commento che mostra come usarlo.
Si importa dal file o da `@/components/ui`.

| Componente | Import | Note |
| --- | --- | --- |
| `Button`, `ButtonLink`, `buttonClass` | `@/components/ui/button` | varianti `primary`, `secondary`, `ghost`, `danger`; misure `md`, `sm`; `icon` |
| `Input`, `Textarea`, `Select`, `Checkbox`, `Switch` | `@/components/ui/input` | `Checkbox` e `Switch` hanno la propria etichetta |
| `Field` | `@/components/ui/field` | etichetta + aiuto + errore; `htmlFor` = `id` del campo; `name` prende l'errore dall'azione |
| `ActionForm`, `SubmitButton`, `useActionResult` | `@/components/ui/form` | modulo legato a un'azione server (`useActionState`) |
| `FormMessage`, `Notice` | `@/components/ui/form-message` | messaggi in pagina (niente toast); toni `ok`, `warning`, `error`, `neutral`, `ai` |
| `Card`, `CardHeader`, `Panel` | `@/components/ui/card` | superfici; non annidare le `Card` |
| `Table`, `Th`, `Td` | `@/components/ui/table` | scorre in orizzontale sotto `minWidth`; `caption` obbligatoria |
| `Badge`, `StatusPill`, `AiBadge` | `@/components/ui/badge` | `<StatusPill {...connectionStatus(x)} />` |
| `Tabs` | `@/components/ui/tabs` | schede come link (parametro o sotto-pagina) |
| `Dialog` | `@/components/ui/dialog` | `<dialog>` nativo, disegna il proprio pulsante |
| `EmptyState` | `@/components/ui/empty-state` | dice cosa conterrà l'elenco e cosa fare per primo |
| `PageHeader` | `@/components/ui/page-header` | l'unico `<h1>` della pagina; `actions`, `back`, `eyebrow` |
| `Pagination` | `@/components/ui/pagination` | con `parsePage`, `pageWindow`, `withParams` di `@/lib/pagination` |
| `Meter` | `@/components/ui/meter` | valore su limite; `UsageMeters` in `@/components/usage-meters` |
| `Skeleton`, `PageSkeleton` | `@/components/ui/skeleton` | per i `loading.tsx` |
| `Icon` | `@/components/ui/icons` | SVG in linea; per aggiungerne una si aggiunge il tracciato a `PATHS` |

Altri pezzi riusabili: `AuditTable` (`@/components/audit-table`), `Placeholder`
(`@/components/placeholder`), `PlainPage` (`@/components/shell/plain-page`).

Funzioni:

| Modulo | Cosa |
| --- | --- |
| `@/lib/format` | `formatDate`, `formatDateTime`, `formatMonth`, `formatRelative`, `formatMoney` (centesimi), `formatMicros`, `formatNumber`, `shortId` — it-IT, fuso Europe/Rome |
| `@/lib/labels` | etichette e toni degli stati: `connectionStatus`, `flowStatus`, `runStatus`, `queueStatus`, `organizationStatus`, `invitationStatus`, `scrapeRecipeStatus`, `sectorLabel`, `roleLabel`, `connectorCategoryLabel`, `blockCategoryLabel`, `aiPurposeLabel` |
| `@/lib/action` | `ActionResult`, `ok`, `fail`, `failFromError`, `errorMessage`, `parseForm` |
| `@/lib/usage` | `usagePeriod`, `parsePlanLimits`, `buildUsage` |
| `@/lib/dashboard` | `countByStatus`, `connectionsNeedingAttention`, `dealsByStage`, `onboardingSteps`, `aggregateAiSpend` |
| `@/lib/features` | `KNOWN_FEATURES`, `isFeatureEnabled` |
| `@/lib/pagination`, `@/lib/parse` | pagine, parametri, importi in euro, limiti, date |
| `@/lib/audit`, `@/lib/jobs` | `writeAudit`, `requestJob` |

## Regole per chi costruisce le prossime sezioni

**Dove vanno le pagine.** Si sostituisce `src/app/app/<sezione>/page.tsx` e si aggiungono
sotto-pagine nella stessa cartella. Il dettaglio di un flusso è atteso a
`/app/flussi/[id]` (Inizio ci punta già). In Impostazioni va tenuto il link a
`/app/impostazioni/registro`. La navigazione è in `lib/nav.ts` (`CUSTOMER_NAV`).

**Come si legge.** Componenti server, client con la sessione dell'utente:

```tsx
export default async function ContactsPage() {
  const { supabase, org } = await requireOrg();
  const { data, error } = await supabase
    .from("contacts")
    .select("id, full_name, phones")
    .eq("organization_id", org.organization.id)   // sempre, anche se la RLS filtra già
    .order("created_at", { ascending: false })
    .range(from, to);
  …
}
```

- Sempre il filtro `organization_id`: lo staff vede tutte le aziende attraverso la RLS.
- I tipi generati non hanno relazioni: niente `select("*, plans(name)")`. Due letture e
  una `Map`.
- PostgREST restituisce al massimo 1000 righe: paginare.
- Controllare sempre `error` e mostrarlo con `<Notice tone="error">{errorMessage(error)}</Notice>`.
- `org.canManage` decide se mostrare le azioni di modifica; un collaboratore vede ma non modifica
  collegamenti, flussi e impostazioni.
- Le funzioni attivabili si leggono con `isFeatureEnabled(righe di org_features, chiave)`;
  una chiave nuova si aggiunge prima a `KNOWN_FEATURES`.
- Il client di servizio (`createServiceClient()`) solo dove la RLS non può arrivare, solo
  dopo aver verificato il permesso con il client di sessione, mai in un componente client.

**Come si scrive un'azione.** File `actions.ts` accanto alla pagina:

```ts
"use server";
const Schema = z.object({ name: z.string().trim().min(2, "Scrivi il nome.") });

export async function saveThing(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const { supabase, org } = await requireOrgManager();        // 1. chi sei
  const parsed = parseForm(Schema, formData);                 // 2. valida
  if (!parsed.ok) return parsed.result;
  const { error } = await supabase.from("things")             // 3. scrivi (la RLS decide)
    .update(parsed.data).eq("organization_id", org.organization.id);
  if (error) return failFromError(error);
  revalidatePath("/app/things");                              // 4. aggiorna
  return ok("Salvato.");                                      // 5. dillo
}
```

```tsx
<ActionForm action={saveThing} className="grid gap-4">
  <Field label="Nome" htmlFor="name" name="name"><Input id="name" name="name" required /></Field>
  <SubmitButton>Salva</SubmitButton>
</ActionForm>
```

- Un file `"use server"` esporta solo funzioni asincrone: costanti e schemi condivisi
  vanno in un file a parte.
- Un identificativo si passa con `azione.bind(null, id)` e si ricontrolla nell'azione.
- I messaggi dicono cosa è successo e cosa fare; mai il testo tecnico dell'errore.
- Le funzioni pure vanno in `src/lib` **senza** `import "server-only"` e senza importare a
  runtime da `@/…` (solo `import type`): così i test in `apps/web/test` le caricano con
  percorsi relativi, senza configurare alias in Vitest.

**Registro.** Quasi tutte le modifiche sono registrate dai trigger del database
(`20261004000200_security.sql`: organizations, memberships, invitations, org_settings,
org_features, connections, flows, flow_versions, message_templates, deal_stages, deals,
contacts, scrape_recipes, approvals, support_sessions, messaggi in uscita scritti da una
persona). Per quelle **non** si chiama `writeAudit`. Lo si chiama per ciò che i trigger non
vedono (un'esportazione, una mail inviata), con un nome `<area>.<verbo>` e la descrizione
italiana aggiunta in `lib/audit-labels.ts`.

**Chiedere un lavoro al motore.** Il web non chiama connettori, IA o scraping: inserisce
una riga in `scheduled_jobs` e mostra l'esito quando il motore aggiorna i dati.

```ts
const context = await requireOrg();
const { error } = await requestJob(context.supabase, {
  organizationId: context.org.organization.id,
  ...simulateFlowJob(versionId),          // tipo, contenuto e chiave: lib/job-requests.ts
  actor: actorOf(context),
});
```

Tipi ammessi dalla RLS: `send_message`, `approval_decided` (ogni membro); `simulate_flow`,
`scrape_run`, `scrape_trace`, `verify_connection` (chi gestisce). Ogni richiesta si costruisce
con le funzioni di `lib/job-requests.ts`; la forma del contenuto è lo schema
`USER_JOB_PAYLOADS` di `packages/core/src/jobs.ts`, lo stesso che i gestori del motore
usano per leggerlo. `requestJob` scrive anche la riga di registro `job.<tipo>`.

**Contratto con il motore.** Web e motore si parlano solo attraverso il database. Le forme
condivise stanno in `packages/core` (`jobs.ts`: lavori e `meta` dei messaggi dell'operatore;
`links.ts`: indirizzi delle notifiche; `aiCallColumns`: righe di `ai_calls`) e le funzioni pure
che costruiscono ciò che il web scrive (`lib/job-requests.ts`, `lib/inbox/outgoing.ts`,
`lib/flows/test-event.ts`, `mergeReconnectConfig`) sono importate dai test del motore
(`apps/worker/test/web-contract.test.ts`), che le inseriscono passando dalla RLS e fanno
lavorare i gestori veri. Lo stesso test scrive in `apps/web/test/fixtures/` i passi di
un'esecuzione simulata e di una vera: `apps/web/test/contract.test.ts` li usa per provare
`stepOutcome`. Se cambia l'esito di un blocco, il test del motore fallisce: si aggiorna il
file con `npx vitest run apps/worker/test/web-contract.test.ts -u` e si guarda cosa dice il test del web.

**Interfaccia.** Testi in italiano, con i nomi che usa il cliente (Collegamenti, Flussi,
Trattative). Ogni campo ha un'etichetta; il fuoco è visibile; tutto si usa da tastiera.
Deve reggere a 380 px: le griglie di pagina partono a una colonna e le tabelle stanno in
`Table`, che scorre da sola senza allargare la pagina. Un elenco vuoto è un `EmptyState`
che dice cosa fare.

## Cosa cambia senza chiave di servizio

| Funzione | Senza `SUPABASE_SERVICE_ROLE_KEY` |
| --- | --- |
| Invito (creazione azienda, scheda → Utenti) | la riga in `invitations` viene creata; la mail non parte e la pagina spiega come far entrare la persona |
| Utenti dell'azienda e amministratori del rivenditore | compaiono con l'identificativo abbreviato al posto della mail |
| Aggiungere un amministratore al rivenditore | rifiutato con un messaggio che dice quale variabile impostare |
| Marchio del rivenditore nell'area cliente | non applicato (resta quello dell'azienda, se c'è) |

## Verifiche

Fatte:

- `npm run build`, `npm run typecheck`, `npx biome check apps/web`: puliti.
- `npx vitest run apps/web`: 76 test su formattazione, consumi e limiti, scelta
  dell'azienda e sessione di assistenza, navigazione e permessi delle aree, protezione
  degli indirizzi, messaggi d'errore, marchio, aggregazioni, parametri dei moduli.
- App avviata dalla build: `/accedi` risponde 200 con il modulo; `/app`, `/admin` e gli
  altri indirizzi protetti rimandano a `/accedi` (con `next` quando serve); un `next` verso
  un altro sito viene ignorato.
- A occhio, con dati finti e senza accesso: pagina di accesso, guscio, kit di componenti,
  nei due temi e a 380 px.

**Non verificate**, perché servono un utente di prova e lo schema esposto:

- accesso reale (password, link via mail, invito) e `accept_invitations`;
- ogni lettura e scrittura sul database: Inizio, registro, tutte le pagine admin e le loro azioni;
- accesso in assistenza dall'inizio alla fine, cambio azienda, sospensione;
- esportazione e cancellazione di un'azienda;
- tutti i percorsi che usano la chiave di servizio (mail di invito, ricerca utenti).

Sono coperte solo dai tipi (`createClient<Database>` sullo schema `ia_connect`) e dai test
delle funzioni pure. Vanno provate a mano appena lo schema è esposto.

Limiti noti:

- Monitoraggio somma la spesa IA leggendo le chiamate del mese a pagine di 1000, fino a
  10.000; oltre, lo segnala. Più avanti servirà una vista o una funzione SQL.
- Il periodo dei consumi è il mese in UTC, come `usage_period()` nel database.
- I filtri per data del registro usano la mezzanotte UTC.
- Il conteggio delle notifiche nel guscio si aggiorna al caricamento di una pagina intera o
  dopo «Segna come lette», non a ogni navigazione interna.
- Chi ha già un account e viene invitato in una seconda azienda la vede dal prossimo accesso.
- La ricerca di un utente per mail scorre gli utenti del progetto (fino a 5.000): con il
  progetto condiviso va bene, con molti utenti servirà una funzione SQL dedicata.

## Inbox, Contatti, Trattative, Report, Impostazioni, Approvazioni, Notifiche

Sezioni dell'area cliente costruite sopra le fondamenta. Tutte chiamano `requireOrg()`,
filtrano per `organization_id`, non usano select annidate e tengono la logica in funzioni
pure con test.

### Pagine

| Indirizzo | Chi | Cosa |
| --- | --- | --- |
| `/app/inbox` | membri | elenco delle conversazioni: viste (tutte, da gestire, automatiche, non lette, chiuse), canale, ricerca per nome / telefono / mail |
| `/app/inbox/[id]` | membri | la conversazione: messaggi, stato di consegna, scheda del contatto, azioni e campo di scrittura. Su schermo stretto è una pagina a sé, su schermo largo sta accanto all'elenco |
| `/app/contatti`, `/nuovo`, `/[id]`, `/[id]/modifica` | membri | elenco con ricerca e pagine, creazione, scheda (dati, consensi, memoria, storia, trattative, conversazioni), modifica |
| `/app/contatti/[id]/export` | membri | scarica il JSON di `export_contact` (registrato come `contact.export`) |
| `/app/trattative` | membri | colonne per fase con totali; `?vista=elenco` per l'elenco con filtri (stato, fase, assegnatario) |
| `/app/trattative/nuova`, `/[id]` | membri | creazione a mano (`?contatto=<id>` preseleziona il contatto), scheda con modifica, fase, origine, storia |
| `/app/report` | membri | `?periodo=` `questo-mese` (predefinito), `mese-scorso`, `7-giorni`, `30-giorni`, `90-giorni` |
| `/app/impostazioni` | membri | indice delle sezioni |
| `/app/impostazioni/utenti`, `/modelli`, `/modelli/nuovo`, `/modelli/[id]`, `/assistente`, `/marchio`, `/fasi`, `/campi`, `/privacy` | tutti leggono, **scrive solo chi gestisce** (`requireOrgManager` nelle azioni) | utenti e inviti, modelli di messaggio, assistente IA, marchio, fasi e campi delle trattative, dati e privacy |
| `/app/impostazioni/privacy/export` | chi gestisce | scarica il JSON di `export_organization` |
| `/app/approvazioni` | membri | richieste in attesa (Approva / Rifiuta) e storico |
| `/app/notifiche` | membri | notifiche, prima quelle da leggere; la campanella del guscio porta qui |

Approvazioni e Notifiche non sono nella barra laterale (`CUSTOMER_NAV` resta di otto voci,
come da test): ci si arriva dalla campanella, dal pulsante «Approvazioni» in Notifiche e,
quando ce ne sono in attesa, dal pulsante in cima all'Inbox.

Le sezioni Inbox, Trattative e Report rispettano le funzioni `inbox`, `deals`, `reports` di
`org_features` (`lib/feature-gate.ts`): se spente mostrano un avviso al posto della pagina.

### Dove sta la logica

| Modulo (puro, con test) | Cosa |
| --- | --- |
| `lib/customer-labels.ts` | etichette di canali, stati di consegna, approvazione dei modelli, fasi; `safeInternalLink` per i link delle notifiche |
| `lib/inbox/window.ts` | stato della finestra WhatsApp di 24 ore e modalità del campo di scrittura |
| `lib/inbox/filters.ts` | filtri e conteggi dell'elenco, anteprima del messaggio |
| `lib/message-templates.ts` | segnaposto `{{1}}`, `{{2}}`: elenco, anteprima, controlli |
| `lib/contacts/consents.ts` | lettura, concessione e revoca del consenso (la revoca resta scritta con data e origine) |
| `lib/contacts/fields.ts`, `timeline.ts` | telefoni, mail, campi personalizzati, filtro di ricerca; storia unica del contatto |
| `lib/deals/board.ts` | colonne e totali, effetti di un cambio di fase (`closed_at`, riga di `deal_events`), filtri dell'elenco |
| `lib/deals/stages.ts` | riordino delle fasi, chiavi, definizioni e valori dei campi delle trattative |
| `lib/report/period.ts`, `metrics.ts`, `fetch.ts` | periodi, ogni cifra del report, lettura a pagine oltre le 1000 righe |
| `lib/settings/brand.ts`, `members.ts` | marchio con `ownerPhone` / `ownerEmail`, regole su ruoli e ultimo titolare |

Solo server: `lib/people.ts` (nomi degli utenti: la mail con la chiave di servizio,
altrimenti «Utente 1a2b3c4d»), `lib/feature-gate.ts`, `lib/deals/assignees.ts`.

### Come parte un messaggio scritto da un operatore

`inbox/actions.ts → sendMessage`:

1. legge la conversazione dell'azienda corrente;
2. WhatsApp con finestra chiusa (o scelta «Modello approvato»): serve un modello con
   `approval_status = 'approved'`; il testo salvato è il modello riempito, i valori vanno in
   `meta.variables` (array, in ordine) e `template_id` punta al modello. Altrimenti testo
   libero; per la mail l'oggetto va in `meta.subject`. Sugli altri canali un modello serve
   solo come testo di partenza e `template_id` resta vuoto (il motore pretende
   l'approvazione per ogni messaggio con `template_id`);
3. inserisce la riga in `messages` con `direction = 'out'`, `delivery_status = 'queued'`,
   `sent_by_user_id`;
4. chiede il lavoro `send_message` con `{ message_id }` (`requestJob`, chiave
   `send_message:<id>`); se la richiesta fallisce il messaggio diventa `failed` con il motivo.
   La riga del messaggio è costruita da `lib/inbox/outgoing.ts` (`buildTemplateMessage`,
   `buildFreeMessage`, `outgoingMessageRow`); la forma di `meta` è `OperatorMessageMetaSchema`
   in `packages/core`;
5. se la conversazione era dell'automazione passa a chi ha scritto (una persona che
   risponde non deve incrociarsi con l'IA) e torna aperta.

Consenso, quota e finestra li controlla il motore: un rifiuto torna come
`delivery_status = 'failed'` + `error` e si legge sotto il messaggio. La pagina avvisa prima
(consenso mancante, finestra chiusa) ma non blocca. L'Inbox si aggiorna da sola ogni 10
secondi con `router.refresh()` quando la scheda è visibile (Realtime non è usato: non
verificato sullo schema `ia_connect`). Il contatore dei non letti si azzera all'apertura
della conversazione, da un componente client (non durante il rendering).

### Altre regole

- **Presa in carico**: `assignee_type = 'user'` + `assignee_user_id`; «Riaffida
  all'automazione» li riporta a `automation` / `null`.
- **Cambio di fase**: aggiorna la trattativa solo se è ancora nella fase letta (due persone
  che spostano insieme: la seconda riceve un avviso), poi inserisce `deal_events`
  (`stage_changed`, da / a, attore). Creazione a mano → evento `created`; modifica dei dati
  → evento `updated` con i campi cambiati.
- **Prossima azione**: è un giorno, salvato a mezzogiorno UTC.
- **Fasi**: una fase con trattative non si elimina; serve sempre almeno una fase aperta; i
  flussi usano `key`, che non cambia quando si rinomina.
- **Modelli**: solo WhatsApp ha lo stato di approvazione (impostato a mano dopo
  l'approvazione su Meta) e `external_name`; gli altri canali vengono salvati come `approved`.
  I flussi richiamano i modelli WhatsApp per nome.
- **Report**: giorni e mesi in UTC. Ogni tabella è letta fino a 10.000 righe; oltre, la
  pagina dice quali cifre sono parziali. La spesa IA è mostrata in dollari e non è sottratta
  al valore vinto (è compresa nel piano).
- **Eliminare un contatto**: conferma scrivendo ELIMINA; il database cancella a cascata
  conversazioni, messaggi, trattative e appuntamenti.

### Limiti e punti aperti

- Ricerca dei contatti: il nome anche per una parte; telefono e mail solo per intero
  (`phones` ed `emails` sono array: PostgREST non cerca dentro i singoli elementi). La
  ricerca dell'Inbox invece è fatta in memoria sulle 400 conversazioni più recenti e trova
  anche parti di numero.
- Un collaboratore vede solo la propria riga di `memberships` (RLS): può assegnare una
  trattativa a sé stesso o lasciare chi c'è; l'elenco completo lo vede chi gestisce.
- Cambio di fase, creazione e modifica di una trattativa sono due scritture (trattativa, poi
  evento) senza transazione: se la seconda fallisce la storia perde una riga (l'errore è nei log).
- Il riordino delle fasi scrive una riga alla volta.
- La colonna di una fase mostra 30 trattative; le altre sono nell'elenco. Oltre 3.000
  trattative i totali delle colonne sono parziali e la pagina lo dice.
- `export_organization` include `connections.webhook_token`: va trattato come dato riservato.
- Senza `SUPABASE_SERVICE_ROLE_KEY`: gli inviti vengono registrati ma la mail non parte (la
  pagina spiega cosa fare), e assegnatari, autori dei messaggi e utenti compaiono con un
  codice al posto della mail.

### Verifiche di queste sezioni

Fatte: build, typecheck, Biome sui file di queste sezioni, e i test `inbox`, `contacts`,
`deals`, `report` in `apps/web/test` (finestra WhatsApp, filtri dell'Inbox, anteprima dei
modelli, consensi con revoca, campi e ricerca dei contatti, storia, colonne e totali,
effetti del cambio di fase, riordino delle fasi, campi delle trattative, marchio, regole
sugli utenti, periodi, ogni cifra del report compresi periodi vuoti e divisioni per zero,
lettura a pagine).

**Non verificate** (servono accesso, schema esposto e un motore acceso): ogni lettura e
scrittura reale di queste pagine; l'invio di un messaggio fino alla consegna e il ritorno
di un rifiuto; la ripresa di un flusso dopo un'approvazione; il filtro `or(...)` della
ricerca contatti contro PostgREST; inviti e indirizzi mail con la chiave di servizio; le due
esportazioni; l'aspetto con dati veri nei due temi e a 380 px.

## Collegamenti e Flussi

Sezioni dell'area cliente. Vedono tutti i membri; creare e modificare è riservato a chi
gestisce l'azienda (`requireOrgManager`). Le regole pure stanno in `lib/connections/*`,
`lib/flows/*`, `lib/scrape/*` (con test in `test/connections.test.ts` e `test/flows.test.ts`).

### Pagine

| Indirizzo | Cosa |
| --- | --- |
| `/app/collegamenti` | collegamenti dell'azienda (stato, ultimo controllo, ultimo errore; quelli scaduti o in errore in evidenza con «Ricollega») e catalogo per categoria: disponibile, «Non incluso» (piano o funzione spenta), «In arrivo» (tipo senza codice) |
| `/app/collegamenti/nuovo/[connector]` | collegamento guidato; `?ricollega=<id>` aggiorna un collegamento esistente |
| `/app/collegamenti/[id]` | scheda: stato, dati non segreti, indirizzo del webhook, scelta della pagina Facebook, verifica / ricollega / scollega |
| `/app/collegamenti/siti`, `/nuova`, `/[id]` | letture da siti e portali: elenco, creazione, versioni del percorso, letture eseguite |
| `/api/oauth/[connector]/start`, `/callback` | andata e ritorno dell'autorizzazione OAuth |
| `/app/flussi` | elenco con stato, trigger, ultima esecuzione, esecuzioni e fallite negli ultimi 7 giorni |
| `/app/flussi/modelli` | libreria: prima i modelli del settore dell'azienda |
| `/app/flussi/nuovo`, `/app/flussi/[id]/assistente` | assistente IA: crea o modifica |
| `/app/flussi/[id]` | schede `?scheda=` `schema`, `controlli`, `simulazione`, `versioni`, `esecuzioni`; `?versione=<id>` sceglie la versione mostrata |
| `/app/flussi/[id]/esecuzioni/[runId]` | una esecuzione passo per passo |

### Collegamento guidato

Il web chiama `connector.connect` sul server (è l'unica eccezione alla regola «il web non
chiama i connettori»: serve una risposta immediata e i segreti non devono passare da
`scheduled_jobs`). Ordine, in `lib/connections/server.ts` → `saveConnection`:

1. `connect(input, { fetch, env })`; l'`env` passato è solo l'elenco di variabili che i
   connettori dichiarano di leggere (`connectorEnv`).
2. riga in `connections` con il client di sessione (RLS e registro vedono l'utente vero);
   `config` passa da `sanitizeConfig`, che scarta chiavi dal nome di credenziale e valori
   uguali a un segreto;
3. `store_connection_secret` con il client di servizio; se fallisce la riga viene tolta;
4. se il connettore ha l'azione `registerWebhook` (Stripe, waWebApi) viene chiamata con
   l'indirizzo del collegamento; se fallisce il collegamento resta e la scheda offre
   «Registra di nuovo il webhook». Per Twilio l'indirizzo viene scritto in
   `config.statusCallbackUrl`.

Per modalità:

- `api_key`, `credentials`, `webhook`, `qr`: modulo generato da `z.toJSONSchema(inputSchema)`
  (`schemaToFields`): l'etichetta è il testo di `.describe()`, i campi dal nome di
  credenziale (`secret`, `token`, `password`, `key`, `authHeaderValue`…) sono campi
  password e non tornano mai al browser; dopo un errore il modulo ripropone solo i valori
  non segreti.
- I segreti **generati** dal connettore (`webhook_inbound`, `signature_link`, `ghl_social`)
  sono mostrati una sola volta nello stato dell'azione, con «Copia» e l'avviso che non
  saranno più visibili (`revealableSecrets`). Token e chiavi scritti dal cliente non
  vengono mai rimostrati.
- `webhook`: indirizzo `<SUPABASE_URL>/functions/v1/webhook/c/<webhook_token>` (o
  `WEBHOOK_PUBLIC_URL`), segreto una volta, esempio `curl` con la firma.
- `qr`: il collegamento nasce «in errore» con il messaggio di attesa; «Controlla stato»
  chiama `verify` subito dal server web.
- «Verifica ora» chiede il lavoro `verify_connection`; «Scollega» chiama `disconnect`
  (se riesce) e imposta `disconnected`.

### OAuth

1. `GET /api/oauth/<connector>/start[?ricollega=<id>][&pagina=<id pagina>]`: solo gestori,
   connettore consentito all'azienda. Crea lo stato `{ org, connector, user, nonce, exp,
   reconnect?, extra? }`, lo firma (HMAC-SHA256) e lo mette nel cookie `oauth_state`
   (httpOnly, SameSite=Lax, 10 minuti, percorso `/api/oauth`). Al fornitore va solo il `nonce`.
2. `GET /api/oauth/<connector>/callback`: il cookie deve avere firma valida, non essere
   scaduto, avere il `nonce` uguale a `state`, il connettore della rotta, l'utente della
   sessione e l'azienda corrente. Poi `connect({ code, redirectUri, ...extra })`,
   `saveConnection`, ritorno alla scheda con `?esito=`. Qualunque altro caso torna a
   `/app/collegamenti?esito=<motivo>` con un messaggio fisso (mai testo preso dall'indirizzo).
3. `meta_social` con più pagine: la scheda mostra `config.availablePages`; scegliere
   un'altra pagina ripete l'autorizzazione con `pagina=<id>` (il token delle altre pagine
   non viene conservato).

Chiave della firma: `OAUTH_STATE_SECRET`, altrimenti `SUPABASE_SERVICE_ROLE_KEY`.
`APP_URL` deve essere l'indirizzo pubblico: l'indirizzo di ritorno registrato presso
Google, Microsoft e Meta è `<APP_URL>/api/oauth/<connector>/callback`.

### Flussi

- **Schema leggibile**: `buildDiagram` (trigger, passi, uscite con `resolveTarget`, problemi
  accanto al passo) → `FlowDiagram`. `describeStep` dà la riga in italiano di ogni blocco.
- **Controlli**: `validateFlow` sul server con il contesto vero (`loadFlowEnvironment`:
  collegamenti con categoria, modelli, fasi, limiti del piano, altri flussi attivi,
  crediti IA rimasti). Un limite assente o negativo vale «senza limite».
- **Attivazione**: solo senza errori; scrive `status`, `active_version_id`, `trigger_event`.
- **Versioni**: mai modificate; assistente (`ai`), modifica manuale e ripristino (`user`),
  installazione da modello (`system`) creano una riga con `version = max + 1`
  (`insertFlowVersion`, con nuovo tentativo se due salvataggi si scontrano).
  `flows.trigger_event` segue l'ultima bozza solo finché il flusso non è mai stato attivato.
- **Assistente**: permesso → `ANTHROPIC_API_KEY` → chiave di servizio → `quota_left` >
  0 → `proposeFlow` → riga in `ai_calls` (`flow_assistant`) e `add_usage` con `creditsFor`,
  anche quando la chiamata fallisce a metà (`AiOperationError`). La cronologia arriva dal
  browser e viene ridotta (`sanitizeHistory`); «Salva come bozza» ricontrolla lo schema.
- **Simulazione**: lavoro `simulate_flow`; la scheda legge `flow_runs` con
  `mode = 'simulation'` e i loro passi e si aggiorna da sola finché il lavoro è in coda.
  Per ogni passo `stepOutcome` (`lib/flows/outcome.ts`) dice in una frase cosa sarebbe
  successo, con i dettagli del blocco (destinatario e testo, contatto e trattativa che
  verrebbero creati, dati per il gestionale…) e gli avvisi sui rifiuti; il JSON completo
  resta sotto.
- **Evento di prova**: riga in `events` (`manual.test` o il tipo del trigger) con
  `dedupe_key = manual:<uuid>` e voce di registro `flow.test_event` (`lib/flows/test-event.ts`).
  Se il trigger è limitato a un collegamento l'evento porta quel `connection_id`, altrimenti
  non corrisponderebbe mai. Per i messaggi in arrivo (mail, WhatsApp, SMS, social) il
  contenuto deve avere `from`: senza mittente il motore ignora l'evento, quindi l'azione lo
  rifiuta prima; il contenuto proposto è un esempio adatto al tipo. Un messaggio in arrivo
  di prova crea davvero contatto, conversazione e messaggio. Su un flusso attivo
  l'esecuzione è vera: la pagina lo dice.
- Funzioni: `flow_editor` spento → il cliente vede soltanto; `flow_assistant` spento →
  niente assistente; `scraping` spento → niente nuove letture. L'assistenza non è
  bloccata da questi interruttori. `social`, `scraping`, `payments_signature` spenti
  rendono «Non incluso» le rispettive categorie del catalogo.

### Variabili d'ambiente in più (`apps/web`)

| Variabile | Serve per |
| --- | --- |
| `SUPABASE_SERVICE_ROLE_KEY` | ogni nuovo collegamento (segreti nel Vault), scollegamento presso il fornitore, registro delle chiamate IA dell'assistente. Senza, le pagine lo dicono e rifiutano l'operazione |
| `ANTHROPIC_API_KEY` (`AI_MODEL_SMART` facoltativa) | assistente dei flussi |
| `OAUTH_STATE_SECRET` | firma dello stato OAuth (facoltativa: ripiego sulla chiave di servizio) |
| `GOOGLE_CLIENT_ID/SECRET`, `MICROSOFT_CLIENT_ID/SECRET`, `META_APP_ID/SECRET`, `META_GRAPH_VERSION` | OAuth di Gmail, Google Calendar, Microsoft 365, Facebook e Instagram |
| `WAWEBAPI_BASE_URL` | WhatsApp via QR |
| `WEBHOOK_PUBLIC_URL` | indirizzo di base dei webhook mostrato al cliente (predefinito: la funzione del progetto Supabase) |

### Non verificato

Costruito senza poter accedere né leggere il database: tutto ciò che segue è coperto solo
da tipi, build e test delle funzioni pure.

- ogni lettura e scrittura di queste pagine, comprese le RLS su `connections`, `flows`,
  `flow_versions`, `events`, `scheduled_jobs`, `scrape_recipes`, `message_templates`;
- `store_connection_secret`, `read_connection_secret`, `add_usage`, inserimento in
  `ai_calls` (chiave di servizio);
- `connect`, `verify`, `disconnect`, `registerWebhook` di ogni connettore contro il
  servizio reale; l'intero giro OAuth con app vere;
- l'assistente con una chiave Anthropic vera; tempi di risposta dentro i limiti di durata
  delle azioni server dell'hosting;
- come si vedono a schermo i passi di un'esecuzione (la lettura degli esiti è provata sui
  passi scritti dal motore, il componente `RunSteps` no);
- l'aspetto con dati veri, nei due temi e a 380 px.

Limiti noti e ripieghi:

- Il QR di waWebApi si disegna solo se arriva come immagine (`data:image/…`); un testo
  grezzo viene mostrato da copiare (non c'è una libreria per generare il QR).
- I segreti di un collegamento scollegato restano nel Vault (non esiste una funzione per
  toglierli).
- Cambiare pagina Facebook richiede una nuova autorizzazione (vedi OAuth).
- I conteggi dell'elenco dei flussi leggono le ultime 1000 esecuzioni reali.
- Un ricollegamento conserva in `connections.config` ciò che scrive il motore (`cursor`,
  `pollIntervalMinutes`, `statusCallbackUrl`); il cursore solo se l'account è lo stesso. Web
  e motore scrivono la stessa colonna senza blocco: un ricollegamento fatto proprio mentre il
  motore salva un cursore può rimettere quello di un attimo prima (gli eventi non si
  duplicano, hanno una `dedupe_key`).
