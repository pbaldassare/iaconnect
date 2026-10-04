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
  kind: "simulate_flow",
  payload: { flow_version_id: versionId },
  dedupeKey: `simulate:${versionId}:${Date.now()}`,   // facoltativa
  actor: actorOf(context),
});
```

Tipi ammessi dalla RLS: `send_message`, `approval_decided` (ogni membro); `simulate_flow`,
`scrape_run`, `scrape_trace`, `verify_connection` (chi gestisce). La forma del `payload` è
quella letta dai gestori in `apps/worker/src/jobs/` (vedi `docs/moduli/worker.md`).
`requestJob` scrive anche la riga di registro `job.<tipo>`.

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
