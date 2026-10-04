import type { Connector } from "@ia-connect/core";
import { z } from "zod";
import { errorFromStatus, healthFromError, parseInput, requireString, send } from "./lib/http.ts";
import { assertPublicHttpUrl } from "./lib/url.ts";
import { compact } from "./lib/values.ts";

const SERVICE = "Sito";

export const ScraperSiteInput = z.object({
  siteUrl: z.string().url().describe("Indirizzo del sito o del portale"),
  username: z.string().optional().describe("Nome utente (solo se il sito richiede l'accesso)"),
  password: z.string().optional().describe("Password (solo se il sito richiede l'accesso)"),
});

/** The site must answer; the login itself is exercised by the scraping recipes in the worker. */
async function checkReachable(fetchFn: typeof fetch, siteUrl: string): Promise<void> {
  const url = assertPublicHttpUrl(siteUrl, SERVICE);
  const response = await send(fetchFn, SERVICE, url.toString(), { headers: { accept: "text/html,*/*" } });
  await response.body?.cancel().catch(() => undefined);
  // 401/403 on the home page are normal for portals behind a login.
  if (response.status >= 400 && response.status !== 401 && response.status !== 403) {
    throw errorFromStatus(SERVICE, response.status);
  }
}

export const scraperSiteConnector: Connector = {
  key: "scraper_site",
  category: "scraper",
  name: "Sito o portale",
  description: "Legge le novità da un sito a orari fissi.",
  connectMode: "credentials",
  inputSchema: ScraperSiteInput,
  // Emitted by the worker's scraping recipes on behalf of this connection.
  emits: ["scrape.item.found", "listing.published"],

  async connect(input, deps) {
    const { siteUrl, username, password } = parseInput(ScraperSiteInput, input);
    await checkReachable(deps.fetch, siteUrl);
    return {
      config: { siteUrl, hasCredentials: Boolean(username && password) },
      secrets: compact({ username, password }),
      externalAccountId: new URL(siteUrl).hostname,
    };
  },

  async verify(context) {
    try {
      await checkReachable(context.fetch, requireString(context.connection.config, "siteUrl", SERVICE));
      return { status: "active", message: "Il sito risponde." };
    } catch (error) {
      return healthFromError(error);
    }
  },

  actions: {},

  async disconnect() {
    // Nothing to revoke on the site.
  },
};
