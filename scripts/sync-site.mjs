/**
 * Copies the presentation site (site/) into the web app's public folder, so one deployment
 * serves both: the site at "/" and the reserved area at /accedi, /registrati, /app, /admin.
 */
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "apps/web/public");
mkdirSync(target, { recursive: true });
rmSync(join(target, "assets"), { recursive: true, force: true });
cpSync(join(root, "site/index.html"), join(target, "index.html"));
cpSync(join(root, "site/assets"), join(target, "assets"), { recursive: true });
console.log("Presentation site copied to apps/web/public/");
