import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { CONNECTOR_CATEGORIES, STANDARD_ACTIONS, isKnownEventType } from "@ia-connect/core";
import { describe, expect, it } from "vitest";
import { getConnector, listConnectors, webhookConnectors } from "../src/index.ts";

const root = join(import.meta.dirname, "..", "..", "..");
const srcDir = join(import.meta.dirname, "..", "src");

/** Connector types seeded by the migration: key, category, name, connect mode. */
function seededTypes(): { key: string; category: string; name: string; connectMode: string }[] {
  const sql = readFileSync(join(root, "supabase/migrations/20261004000300_functions.sql"), "utf8");
  const start = sql.indexOf("insert into ia_connect.connector_types");
  const block = sql.slice(start, sql.indexOf(";", start));
  const rows = [
    ...block.matchAll(/\('([a-z0-9_]+)', '([a-z]+)', '((?:[^']|'')*)', '(?:[^']|'')*', '([a-z_]+)'\)/g),
  ];
  return rows.map((row) => ({ key: row[1]!, category: row[2]!, name: row[3]!, connectMode: row[4]! }));
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? sourceFiles(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

function relativeImports(file: string): string[] {
  const source = readFileSync(file, "utf8");
  return [...source.matchAll(/from\s+"(\.[^"]+)"/g)].map((match) => match[1]!);
}

/** Every source file reachable from `entry` through relative imports. */
function reachable(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const specifier of relativeImports(file)) queue.push(join(file, "..", specifier));
  }
  return seen;
}

describe("connector registry", () => {
  const seeded = seededTypes();

  it("implements exactly the connector types seeded in the database", () => {
    expect(seeded.length).toBe(14);
    expect(
      listConnectors()
        .map((connector) => connector.key)
        .sort(),
    ).toEqual(seeded.map((type) => type.key).sort());
    for (const type of seeded) {
      const connector = getConnector(type.key);
      expect(connector, type.key).toBeDefined();
      expect(connector!.category, type.key).toBe(type.category);
      expect(connector!.connectMode, type.key).toBe(type.connectMode);
      expect(connector!.name, type.key).toBe(type.name);
    }
    expect(getConnector("nope")).toBeUndefined();
  });

  it("exposes the standard actions of its category, each with a matching key", () => {
    for (const connector of listConnectors()) {
      expect(CONNECTOR_CATEGORIES).toContain(connector.category);
      for (const key of STANDARD_ACTIONS[connector.category]) {
        expect(connector.actions[key], `${connector.key}.${key}`).toBeDefined();
      }
      for (const [key, action] of Object.entries(connector.actions)) {
        expect(action.key).toBe(key);
        expect(action.title.length).toBeGreaterThan(0);
      }
    }
  });

  it("only emits known event types", () => {
    for (const connector of listConnectors()) {
      for (const type of connector.emits)
        expect(isKnownEventType(type), `${connector.key}: ${type}`).toBe(true);
    }
  });

  it("gives OAuth connectors a start step and webhook connectors a handler", () => {
    for (const connector of listConnectors()) {
      expect(typeof connector.startOAuth === "function", connector.key).toBe(
        connector.connectMode === "oauth",
      );
      if (connector.receiveProviderWebhook) expect(connector.handleWebhook, connector.key).toBeDefined();
    }
    expect(Object.keys(webhookConnectors).sort()).toEqual([
      "ghl_social",
      "meta_social",
      "payment_stripe",
      "signature_link",
      "sms_twilio",
      "webhook_inbound",
      "whatsapp_meta",
      "whatsapp_wawebapi",
    ]);
  });

  it("builds authorization URLs without leaking the client secret", () => {
    const env = {
      GOOGLE_CLIENT_ID: "google-id",
      GOOGLE_CLIENT_SECRET: "google-secret",
      MICROSOFT_CLIENT_ID: "ms-id",
      MICROSOFT_CLIENT_SECRET: "ms-secret",
      META_APP_ID: "meta-id",
      META_APP_SECRET: "meta-secret",
    };
    for (const key of ["gmail", "microsoft365", "google_calendar", "meta_social"]) {
      const { authorizationUrl } = getConnector(key)!.startOAuth!({
        redirectUri: "https://app.example.com/oauth/callback",
        state: "state-123",
        env,
      });
      const url = new URL(authorizationUrl);
      expect(url.protocol).toBe("https:");
      expect(url.searchParams.get("state")).toBe("state-123");
      expect(url.searchParams.get("redirect_uri")).toBe("https://app.example.com/oauth/callback");
      expect(url.searchParams.get("client_id")).toMatch(/-id$/);
      expect(authorizationUrl).not.toContain("secret");
    }
    expect(() =>
      getConnector("gmail")!.startOAuth!({ redirectUri: "https://x.example", state: "s", env: {} }),
    ).toThrow(/GOOGLE_CLIENT_ID/);
  });
});

describe("Deno compatibility of the sources", () => {
  it("uses explicit .ts extensions on every relative import", () => {
    for (const file of sourceFiles(srcDir)) {
      for (const specifier of relativeImports(file)) expect(specifier, file).toMatch(/\.ts$/);
    }
  });

  it("keeps Node-only modules out of everything webhooks.ts imports", () => {
    const files = reachable(join(srcDir, "webhooks.ts"));
    expect(files.size).toBeGreaterThan(10);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(file).not.toMatch(/imap-smtp\.ts$/);
      expect(source, file).not.toMatch(/from\s+"(node:[^"]+|imapflow|nodemailer|mailparser)"/);
      expect(source, file).not.toMatch(/\bBuffer\b|\bprocess\./);
    }
  });
});
