/**
 * Smoke test of the public demo against a running server.
 *
 *   npm run build -w @ia-connect/web && (cd apps/web && npx next start -p 3100) &
 *   node apps/web/scripts/demo-smoke.mjs                      # http://127.0.0.1:3100
 *   DEMO_BASE_URL=http://localhost:8788 node apps/web/scripts/demo-smoke.mjs
 *
 * It enters through /demo, then asks for every page of the customer area with the demo
 * cookie: each must answer 200 without the error page. It also follows every internal link
 * found in those pages, and checks the rules around the demo: no cookie → /accedi, the
 * cookie does not open /admin, /api or the downloads, pages are marked noindex.
 * Exit code 1 when something fails.
 */
const BASE = (process.env.DEMO_BASE_URL ?? "http://127.0.0.1:3100").replace(/\/$/, "");

/** Same rule as `demoId` in src/lib/demo/fixtures.ts. */
const id = (group, n) =>
  `${group.toString(16).padStart(2, "0")}${n.toString(16).padStart(6, "0")}-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

const FLOW = id(8, 1);
const ROUTES = [
  "/app",
  // Collegamenti
  "/app/collegamenti",
  `/app/collegamenti/${id(5, 1)}`,
  `/app/collegamenti/${id(5, 2)}`,
  `/app/collegamenti/${id(5, 3)}`,
  `/app/collegamenti/${id(5, 4)}`,
  "/app/collegamenti/nuovo/imap_smtp",
  "/app/collegamenti/nuovo/whatsapp_meta",
  "/app/collegamenti/nuovo/webhook_inbound",
  "/app/collegamenti/nuovo/gmail",
  `/app/collegamenti/nuovo/google_calendar?ricollega=${id(5, 3)}`,
  "/app/collegamenti/siti",
  "/app/collegamenti/siti/nuova",
  `/app/collegamenti/siti/${id(24, 1)}`,
  // Flussi
  "/app/flussi",
  "/app/flussi/modelli",
  "/app/flussi/nuovo",
  `/app/flussi/${FLOW}`,
  `/app/flussi/${FLOW}?scheda=schema`,
  `/app/flussi/${FLOW}?scheda=controlli`,
  `/app/flussi/${FLOW}?scheda=simulazione`,
  `/app/flussi/${FLOW}?scheda=versioni`,
  `/app/flussi/${FLOW}?scheda=esecuzioni`,
  `/app/flussi/${FLOW}?scheda=schema&versione=${id(9, 1)}`,
  `/app/flussi/${FLOW}/assistente`,
  `/app/flussi/${FLOW}/esecuzioni/${id(10, 1)}`,
  `/app/flussi/${FLOW}/esecuzioni/${id(10, 2)}`,
  `/app/flussi/${FLOW}/esecuzioni/${id(10, 4)}`,
  `/app/flussi/${FLOW}/esecuzioni/${id(10, 10)}`,
  `/app/flussi/${id(8, 2)}`,
  `/app/flussi/${id(8, 2)}?scheda=controlli`,
  `/app/flussi/${id(8, 2)}?scheda=esecuzioni`,
  `/app/flussi/${id(8, 2)}/esecuzioni/${id(10, 7)}`,
  `/app/flussi/${id(8, 3)}`,
  `/app/flussi/${id(8, 3)}/assistente`,
  // Inbox
  "/app/inbox",
  "/app/inbox?vista=da-gestire",
  "/app/inbox?vista=automatiche",
  "/app/inbox?vista=non-lette",
  "/app/inbox?vista=chiuse",
  "/app/inbox?canale=mail",
  "/app/inbox?q=ferrarini",
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `/app/inbox/${id(14, n)}`),
  // Contatti
  "/app/contatti",
  "/app/contatti?q=marta",
  "/app/contatti?q=%2B393330000002",
  "/app/contatti/nuovo",
  ...[1, 2, 7, 12, 14].map((n) => `/app/contatti/${id(13, n)}`),
  `/app/contatti/${id(13, 1)}/modifica`,
  // Trattative
  "/app/trattative",
  "/app/trattative?vista=elenco",
  "/app/trattative?vista=elenco&stato=vinte",
  "/app/trattative/nuova",
  `/app/trattative/nuova?contatto=${id(13, 1)}`,
  ...[1, 2, 7, 8, 10, 12].map((n) => `/app/trattative/${id(16, n)}`),
  // Report
  "/app/report",
  "/app/report?periodo=mese-scorso",
  "/app/report?periodo=7-giorni",
  "/app/report?periodo=30-giorni",
  "/app/report?periodo=90-giorni",
  // Impostazioni
  "/app/impostazioni",
  "/app/impostazioni/utenti",
  "/app/impostazioni/modelli",
  "/app/impostazioni/modelli/nuovo",
  `/app/impostazioni/modelli/${id(6, 1)}`,
  `/app/impostazioni/modelli/${id(6, 4)}`,
  `/app/impostazioni/modelli/${id(6, 5)}`,
  "/app/impostazioni/assistente",
  "/app/impostazioni/marchio",
  "/app/impostazioni/fasi",
  "/app/impostazioni/campi",
  "/app/impostazioni/privacy",
  "/app/impostazioni/registro",
  "/app/impostazioni/registro?assistenza=1",
  // Approvazioni e notifiche
  "/app/approvazioni",
  "/app/notifiche",
];

// A missing page answers 404, so the status is enough for "not found" (its text is in every
// page's payload, as the fallback of the not-found boundary).
const ERROR_MARKERS = [
  "Application error",
  "Qualcosa non ha funzionato",
  "Internal Server Error",
  "NEXT_REDIRECT",
];

const failures = [];
const fail = (message) => {
  failures.push(message);
  console.log(`  FAIL  ${message}`);
};

async function get(path, cookie) {
  const response = await fetch(`${BASE}${path}`, {
    redirect: "manual",
    headers: cookie ? { cookie } : {},
  });
  return response;
}

function location(response) {
  const value = response.headers.get("location") ?? "";
  return value.startsWith("http") ? new URL(value).pathname + new URL(value).search : value;
}

async function main() {
  console.log(`Demo smoke test against ${BASE}`);

  // 1. Entry: /demo sets the cookie and goes to /app.
  const entry = await get("/demo");
  const setCookie = entry.headers.get("set-cookie") ?? "";
  const cookie = /ia_demo=1/.test(setCookie) ? "ia_demo=1" : "";
  if (entry.status < 300 || entry.status >= 400 || location(entry) !== "/app") {
    fail(`/demo should redirect to /app (got ${entry.status} → ${location(entry)})`);
  }
  if (!cookie) fail("/demo did not set the ia_demo cookie");
  if (!/httponly/i.test(setCookie)) fail("the demo cookie is not httpOnly");
  if (!/samesite=lax/i.test(setCookie)) fail("the demo cookie is not SameSite=Lax");
  if (!/noindex/.test(entry.headers.get("x-robots-tag") ?? "")) fail("/demo is not marked noindex");

  // 2. Rules around the demo.
  const noCookie = await get("/app");
  if (location(noCookie) !== "/accedi")
    fail(`/app without cookie → ${noCookie.status} ${location(noCookie)}`);
  for (const closed of [
    "/admin",
    "/admin/aziende",
    "/api/oauth/gmail/start",
    "/imposta-password",
    "/in-attesa",
  ]) {
    const response = await get(closed, cookie);
    if (!location(response).startsWith("/accedi")) {
      fail(`${closed} with the demo cookie → ${response.status} ${location(response)} (expected /accedi)`);
    }
  }
  for (const [download, back] of [
    [`/app/contatti/${id(13, 1)}/export`, `/app/contatti/${id(13, 1)}?demo=sola-lettura`],
    ["/app/impostazioni/privacy/export", "/app/impostazioni/privacy?demo=sola-lettura"],
  ]) {
    const response = await get(download, cookie);
    if (location(response) !== back) fail(`${download} → ${response.status} ${location(response)}`);
  }
  // A forged header without the cookie opens nothing.
  const forged = await fetch(`${BASE}/app`, { redirect: "manual", headers: { "x-ia-demo": "1" } });
  if (location(forged) !== "/accedi") fail(`forged x-ia-demo header → ${forged.status} ${location(forged)}`);

  // 3. Every page, then every internal link found in them.
  const seen = new Set();
  const queue = [...ROUTES];
  const listed = new Set(ROUTES);
  let checked = 0;
  while (queue.length > 0) {
    const path = queue.shift();
    if (seen.has(path)) continue;
    seen.add(path);
    const response = await get(path, cookie);
    checked += 1;
    if (response.status !== 200) {
      fail(`${path} → ${response.status} ${location(response)}`);
      continue;
    }
    const html = await response.text();
    const marker = ERROR_MARKERS.find((text) => html.includes(text));
    if (marker) fail(`${path} contains "${marker}"`);
    if (!/noindex/.test(response.headers.get("x-robots-tag") ?? "")) fail(`${path} is not marked noindex`);
    // The strip of components/shell/demo-banner.tsx.
    if (!html.includes('aria-label="Demo"')) fail(`${path} has no demo banner`);
    console.log(`  ok    ${listed.has(path) ? "" : "(link) "}${path}`);
    for (const match of html.matchAll(/href="(\/app[^"#]*)"/g)) {
      const href = match[1].replaceAll("&amp;", "&");
      // Downloads are closed in the demo and checked above.
      if (/\/export(\?|$)/.test(href)) continue;
      if (!seen.has(href)) queue.push(href);
    }
  }

  // 4. Leaving.
  const exit = await get("/demo/esci", cookie);
  if (location(exit) !== "/" || !/ia_demo=;/.test(exit.headers.get("set-cookie") ?? "")) {
    fail(`/demo/esci → ${exit.status} ${location(exit)} (cookie: ${exit.headers.get("set-cookie")})`);
  }

  console.log(
    `\n${checked} pages checked (${ROUTES.length} listed, ${checked - ROUTES.length} reached by links).`,
  );
  if (failures.length > 0) {
    console.log(`${failures.length} failure(s):`);
    for (const message of failures) console.log(`  - ${message}`);
    process.exit(1);
  }
  console.log("All good.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
