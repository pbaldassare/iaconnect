/** Builds the presentation site: copies site/ into dist/ (the Cloudflare Pages output). */
import { cpSync, rmSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });
cpSync("site", "dist", { recursive: true });
console.log("Presentation site copied to dist/");
