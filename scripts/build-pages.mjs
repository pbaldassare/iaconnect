/**
 * Assembles the Cloudflare Pages output (dist/) from the OpenNext build of the web app:
 * static files at the root, the server bundled as `_worker.js/`, and `_routes.json` so
 * static files (the presentation site included) are served without invoking the server.
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const web = join(root, "apps/web");
const dist = join(root, "dist");
const worker = join(dist, "_worker.js");

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(join(web, ".open-next/assets"), dist, { recursive: true });

// Wrangler bundles the worker exactly as it would for a deploy, without deploying anything.
execFileSync(
  "npx",
  ["wrangler", "deploy", "--dry-run", "--minify", "--outdir", worker, "--config", "wrangler.jsonc"],
  {
    cwd: web,
    stdio: "inherit",
  },
);
renameSync(join(worker, "worker.js"), join(worker, "index.js"));
rmSync(join(worker, "worker.js.map"), { force: true });
rmSync(join(worker, "README.md"), { force: true });

writeFileSync(
  join(dist, "_routes.json"),
  `${JSON.stringify(
    {
      version: 1,
      include: ["/*"],
      exclude: ["/", "/index.html", "/assets/*", "/_next/static/*", "/favicon.ico", "/BUILD_ID"],
    },
    null,
    2,
  )}\n`,
);
// Without a 404 page Cloudflare Pages answers every missing static file with index.html.
writeFileSync(
  join(dist, "404.html"),
  '<!doctype html><html lang="it"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Pagina non trovata · IA Connect</title><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem"><h1>Pagina non trovata</h1><p>L\'indirizzo non esiste o è stato spostato.</p><p><a href="/">Torna al sito</a></p></body></html>\n',
);
console.log("Cloudflare Pages output ready in dist/");
