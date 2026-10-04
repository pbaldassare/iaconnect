import { listConnectors } from "@ia-connect/connectors";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  availablePages,
  buildCatalog,
  categoriesBlockedByFeatures,
  configSummary,
  connectionWebhookUrl,
  connectorErrorMessage,
  defaultConnectionName,
  revealableSecrets,
  sanitizeConfig,
  webhookBaseUrl,
  webhookExample,
} from "../src/lib/connections/catalog";
import {
  coerceFormValues,
  fieldErrorsFromIssues,
  isSecretField,
  schemaToFields,
} from "../src/lib/connections/form-fields";
import { createOAuthState, verifyOAuthState } from "../src/lib/connections/oauth-state";
import { describeRecipe, describeRecipeStep, intervalLabel } from "../src/lib/scrape/describe";

const toJson = (schema: z.ZodType) => z.toJSONSchema(schema, { io: "input", unrepresentable: "any" });

describe("JSON schema → form fields", () => {
  const schema = z.object({
    email: z.string().email().describe("Indirizzo mail della casella"),
    password: z.string().min(1).describe("Password o password per le app"),
    imapPort: z.number().int().positive().default(993).describe("Porta IMAP"),
    imapSecure: z.boolean().default(true).describe("Connessione IMAP cifrata (TLS)"),
    baseUrl: z.string().url().describe("Indirizzo di base"),
    method: z.enum(["PUT", "PATCH"]).default("PUT").describe("Metodo"),
    accountIds: z.array(z.string()).default([]).describe("ID degli account"),
    days: z.array(z.number().int()).optional().describe("Giorni"),
    resources: z.record(z.string(), z.object({ listPath: z.string() })).describe("Risorse"),
    note: z.string().optional(),
  });
  const fields = schemaToFields(toJson(schema));
  const field = (name: string) => fields.find((item) => item.name === name)!;

  it("uses describe() texts as labels and the name as fallback", () => {
    expect(field("email").label).toBe("Indirizzo mail della casella");
    expect(field("note").label).toBe("note");
  });

  it("maps types to controls", () => {
    expect(field("email").kind).toBe("email");
    expect(field("password").kind).toBe("password");
    expect(field("imapPort").kind).toBe("number");
    expect(field("imapSecure").kind).toBe("boolean");
    expect(field("baseUrl").kind).toBe("url");
    expect(field("method")).toEqual(expect.objectContaining({ kind: "select", options: ["PUT", "PATCH"] }));
    expect(field("accountIds")).toEqual(expect.objectContaining({ kind: "list" }));
    expect(field("days")).toEqual(expect.objectContaining({ kind: "list", numericItems: true }));
    expect(field("resources").kind).toBe("json");
  });

  it("marks required fields; defaults and optionals are not required", () => {
    expect(field("email").required).toBe(true);
    expect(field("password").required).toBe(true);
    expect(field("imapPort").required).toBe(false);
    expect(field("imapPort").defaultValue).toBe("993");
    expect(field("imapSecure").defaultValue).toBe("true");
    expect(field("note").required).toBe(false);
  });

  it("detects secret fields by name and never gives them a default", () => {
    for (const name of [
      "password",
      "accessToken",
      "authToken",
      "apiKey",
      "secretKey",
      "signingSecret",
      "webhookSecret",
      "privateToken",
      "authHeaderValue",
    ]) {
      expect(isSecretField(name), name).toBe(true);
    }
    for (const name of [
      "email",
      "username",
      "phoneNumberId",
      "accountSid",
      "sender",
      "baseUrl",
      "sessionId",
      "authHeaderName",
    ]) {
      expect(isSecretField(name), name).toBe(false);
    }
    const withDefault = schemaToFields(toJson(z.object({ apiKey: z.string().default("abc") })));
    expect(withDefault[0]).toEqual(expect.objectContaining({ kind: "password", defaultValue: undefined }));
  });

  it("omits the fields the platform fills in", () => {
    const oauth = schemaToFields(
      toJson(z.object({ code: z.string(), redirectUri: z.string(), pageId: z.string().optional() })),
      { omit: ["code", "redirectUri"] },
    );
    expect(oauth.map((item) => item.name)).toEqual(["pageId"]);
  });

  it("renders every secret of the real connectors as a password input", () => {
    for (const connector of listConnectors()) {
      const connectorFields = schemaToFields(toJson(connector.inputSchema), {
        omit: ["code", "redirectUri", "statusCallbackUrl"],
      });
      for (const item of connectorFields) {
        expect(item.label, `${connector.key}.${item.name}`).not.toBe("");
        if (isSecretField(item.name)) expect(item.kind, `${connector.key}.${item.name}`).toBe("password");
      }
      const text = connectorFields.filter((item) => item.kind !== "password").map((item) => item.name);
      for (const name of text) {
        expect(/password|token|secret/i.test(name), `${connector.key}.${name} looks secret`).toBe(false);
      }
    }
  });

  it("coerces submitted strings to the connector's input", () => {
    const coerced = coerceFormValues(fields, {
      email: " info@esempio.it ",
      password: "s3greta",
      imapPort: "143",
      baseUrl: "https://api.esempio.it",
      method: "PATCH",
      accountIds: "a, b\nc",
      days: "1,2,3",
      resources: '{"clienti":{"listPath":"/clienti"}}',
      note: "",
    });
    expect(coerced).toEqual({
      ok: true,
      input: {
        email: "info@esempio.it",
        password: "s3greta",
        imapPort: 143,
        imapSecure: false,
        baseUrl: "https://api.esempio.it",
        method: "PATCH",
        accountIds: ["a", "b", "c"],
        days: [1, 2, 3],
        resources: { clienti: { listPath: "/clienti" } },
      },
    });
    if (coerced.ok) expect(schema.safeParse(coerced.input).success).toBe(true);
  });

  it("reports per-field errors without echoing values", () => {
    const coerced = coerceFormValues(fields, {
      email: "",
      password: "x",
      imapPort: "abc",
      imapSecure: "on",
      baseUrl: "https://x.it",
      method: "DELETE",
      days: "1,due",
      resources: "{rotto",
    });
    expect(coerced.ok).toBe(false);
    if (!coerced.ok) {
      expect(Object.keys(coerced.fieldErrors).sort()).toEqual([
        "days",
        "email",
        "imapPort",
        "method",
        "resources",
      ]);
      expect(JSON.stringify(coerced.fieldErrors)).not.toContain("rotto");
    }
    const parsed = schema.safeParse({ email: "non-una-mail", password: "p", baseUrl: "x", resources: {} });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const errors = fieldErrorsFromIssues(parsed.error.issues);
      expect(Object.keys(errors).sort()).toEqual(["baseUrl", "email"]);
      expect(JSON.stringify(errors)).not.toContain("non-una-mail");
    }
  });
});

describe("OAuth state", () => {
  const secret = "segreto-di-prova-lungo-abbastanza";
  const now = new Date("2026-10-04T10:00:00Z");
  const input = { org: "org-1", connector: "gmail", user: "user-1" };

  it("round-trips a valid state", () => {
    const { cookie, nonce } = createOAuthState(
      { ...input, reconnect: "conn-1", extra: { pageId: "123" } },
      secret,
      now,
    );
    const check = verifyOAuthState(cookie, { nonce, connector: "gmail" }, secret, now);
    expect(check.ok).toBe(true);
    if (check.ok) {
      expect(check.state).toEqual(
        expect.objectContaining({ ...input, reconnect: "conn-1", extra: { pageId: "123" } }),
      );
    }
    expect(nonce.length).toBeGreaterThanOrEqual(32);
    expect(createOAuthState(input, secret, now).nonce).not.toBe(nonce);
  });

  it("rejects a tampered payload", () => {
    const { cookie, nonce } = createOAuthState(input, secret, now);
    const [payload, signature] = cookie.split(".");
    const forged = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(payload!, "base64url").toString()),
        org: "org-di-un-altro",
      }),
    ).toString("base64url");
    expect(verifyOAuthState(`${forged}.${signature}`, { nonce, connector: "gmail" }, secret, now)).toEqual({
      ok: false,
      reason: "signature",
    });
  });

  it("rejects a tampered or foreign signature", () => {
    const { cookie, nonce } = createOAuthState(input, secret, now);
    const flipped = `${cookie.slice(0, -1)}${cookie.endsWith("A") ? "B" : "A"}`;
    expect(verifyOAuthState(flipped, { nonce, connector: "gmail" }, secret, now).ok).toBe(false);
    const other = createOAuthState({ ...input, nonce }, "un-altro-segreto", now);
    expect(verifyOAuthState(other.cookie, { nonce, connector: "gmail" }, secret, now)).toEqual({
      ok: false,
      reason: "signature",
    });
  });

  it("rejects a wrong nonce, another connector, an expired or missing cookie", () => {
    const { cookie, nonce } = createOAuthState(input, secret, now);
    expect(verifyOAuthState(cookie, { nonce: "altro", connector: "gmail" }, secret, now)).toEqual({
      ok: false,
      reason: "nonce",
    });
    expect(verifyOAuthState(cookie, { nonce: null, connector: "gmail" }, secret, now)).toEqual({
      ok: false,
      reason: "nonce",
    });
    expect(verifyOAuthState(cookie, { nonce, connector: "meta_social" }, secret, now)).toEqual({
      ok: false,
      reason: "connector",
    });
    const later = new Date(now.getTime() + 11 * 60_000);
    expect(verifyOAuthState(cookie, { nonce, connector: "gmail" }, secret, later)).toEqual({
      ok: false,
      reason: "expired",
    });
    expect(verifyOAuthState(undefined, { nonce, connector: "gmail" }, secret, now)).toEqual({
      ok: false,
      reason: "missing",
    });
    expect(verifyOAuthState("senza-punto", { nonce, connector: "gmail" }, secret, now)).toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(verifyOAuthState(cookie, { nonce, connector: "gmail" }, "", now).ok).toBe(false);
  });
});

describe("catalog", () => {
  const type = (
    key: string,
    category: string,
    extra: Partial<{ allowed_plans: string[] | null; is_enabled: boolean }> = {},
  ) => ({
    key,
    name: key,
    description: "",
    category,
    connect_mode: "api_key",
    allowed_plans: null,
    is_enabled: true,
    ...extra,
  });

  it("groups by category and tells available, not in plan and coming apart", () => {
    const groups = buildCatalog(
      [
        type("whatsapp_meta", "whatsapp"),
        type("gmail", "mail"),
        type("imap_smtp", "mail", { allowed_plans: ["pro"] }),
        type("futuro", "crm"),
        type("spento", "mail", { is_enabled: false }),
        type("meta_social", "social"),
      ],
      "base",
      new Set(["gmail", "imap_smtp", "whatsapp_meta", "meta_social"]),
      new Set(["social"]),
    );
    expect(groups.map((group) => group.category)).toEqual(["mail", "whatsapp", "crm", "social"]);
    const flat = Object.fromEntries(
      groups.flatMap((group) => group.entries.map((entry) => [entry.key, entry.availability])),
    );
    expect(flat).toEqual({
      gmail: "available",
      imap_smtp: "plan",
      whatsapp_meta: "available",
      futuro: "coming",
      meta_social: "plan",
    });
  });

  it("derives blocked categories from feature flags", () => {
    expect([...categoriesBlockedByFeatures((key) => key !== "social")]).toEqual(["social"]);
    expect([...categoriesBlockedByFeatures(() => false)].sort()).toEqual([
      "payment",
      "scraper",
      "signature",
      "social",
    ]);
  });

  it("builds webhook addresses", () => {
    const base = webhookBaseUrl({ supabaseUrl: "https://abc.supabase.co/" });
    expect(base).toBe("https://abc.supabase.co/functions/v1/webhook");
    expect(connectionWebhookUrl(base, "tok123")).toBe(
      "https://abc.supabase.co/functions/v1/webhook/c/tok123",
    );
    expect(
      webhookBaseUrl({
        supabaseUrl: "https://abc.supabase.co",
        webhookPublicUrl: "https://hook.esempio.it/",
      }),
    ).toBe("https://hook.esempio.it");
    const example = webhookExample("https://abc.supabase.co/functions/v1/webhook/c/tok123");
    expect(example).toContain("x-ia-signature: sha256=");
    expect(example).toContain("/c/tok123");
  });

  it("reveals only generated secrets, once, and never the customer's own credentials", () => {
    expect(revealableSecrets("webhook_inbound", {}, { signingSecret: "generato" })).toEqual([
      expect.objectContaining({ label: "Segreto di firma", value: "generato" }),
    ]);
    // Typed by the customer: they already have it.
    expect(revealableSecrets("webhook_inbound", { signingSecret: "mio" }, { signingSecret: "mio" })).toEqual(
      [],
    );
    expect(
      revealableSecrets(
        "ghl_social",
        { privateToken: "pit-1" },
        { privateToken: "pit-1", webhookSecret: "whs" },
      ).map((item) => item.value),
    ).toEqual(["whs"]);
    expect(revealableSecrets("gmail", {}, { accessToken: "a", refreshToken: "r" })).toEqual([]);
    expect(revealableSecrets("whatsapp_meta", { accessToken: "t" }, { accessToken: "t" })).toEqual([]);
    expect(
      revealableSecrets("payment_stripe", { secretKey: "sk" }, { secretKey: "sk", webhookSecret: "whsec" }),
    ).toEqual([]);
  });

  it("keeps secrets out of the stored config", () => {
    expect(
      sanitizeConfig(
        {
          email: "a@b.it",
          accessToken: "tok",
          copy: "s3greta",
          hasCredentials: true,
          nothing: undefined,
          pages: [{ id: "1" }],
        },
        { password: "s3greta" },
      ),
    ).toEqual({ email: "a@b.it", hasCredentials: true, pages: [{ id: "1" }] });
  });

  it("turns connector errors into Italian messages without technical detail", () => {
    const error = (message: string, options: Record<string, unknown>) =>
      Object.assign(new Error(message), { name: "ConnectorError", options });
    expect(
      connectorErrorMessage(
        error("Configurazione della piattaforma mancante: GOOGLE_CLIENT_ID", { code: "missing_env" }),
      ),
    ).toContain("manca GOOGLE_CLIENT_ID");
    expect(connectorErrorMessage(error("Stripe: errore 503", { retryable: true }))).toContain(
      "riprova tra qualche minuto",
    );
    expect(
      connectorErrorMessage(error("Twilio: accesso rifiutato", { status: 401, retryable: false })),
    ).toContain("credenziali sono state rifiutate");
    expect(connectorErrorMessage(new TypeError("fetch failed: secret=abc"))).not.toContain("abc");
    expect(connectorErrorMessage(null)).toContain("errore imprevisto");
  });

  it("summarizes config, pages and names", () => {
    expect(configSummary({ email: "a@b.it", cursor: { x: 1 }, pageName: "Agenzia" })).toEqual([
      { label: "Indirizzo", value: "a@b.it" },
      { label: "Pagina Facebook", value: "Agenzia" },
    ]);
    expect(
      availablePages({ availablePages: [{ id: "1", name: "A" }, { id: "2" }, { name: "senza id" }, null] }),
    ).toEqual([
      { id: "1", name: "A" },
      { id: "2", name: "2" },
    ]);
    expect(availablePages(null)).toEqual([]);
    expect(defaultConnectionName("Gmail", "info@esempio.it")).toBe("Gmail · info@esempio.it");
    expect(defaultConnectionName("Gmail", null)).toBe("Gmail");
  });
});

describe("scraping recipes", () => {
  it("describes steps without showing credentials", () => {
    expect(describeRecipeStep({ action: "goto", url: "https://portale.it/login" })).toBe(
      "Apre la pagina https://portale.it/login",
    );
    expect(describeRecipeStep({ action: "fill", selector: "#pwd", value: "{{secrets.password}}" })).toBe(
      "Scrive [credenziale: password] nel campo #pwd",
    );
    const view = describeRecipe({
      steps: [
        { action: "goto", url: "https://portale.it/annunci" },
        {
          action: "extract",
          listSelector: ".annuncio",
          fields: {
            title: { selector: "h2" },
            url: { selector: "a", attr: "href", transform: "absolute_url" },
          },
          paginate: { nextSelector: ".next", maxPages: 2 },
        },
      ],
      output: {
        keyField: "url",
        fields: [
          { name: "title", type: "string", required: true },
          { name: "url", type: "url" },
        ],
      },
    });
    expect(view?.steps[1]).toBe(
      "Legge l'elenco .annuncio e per ogni riga prende: title, url, fino a 2 pagine",
    );
    expect(view?.fields).toEqual(["title (testo, obbligatorio)", "url (indirizzo)"]);
    expect(describeRecipe({ steps: [] })).toBeNull();
  });

  it("labels intervals", () => {
    expect(intervalLabel(15)).toBe("ogni 15 minuti");
    expect(intervalLabel(60)).toBe("ogni ora");
    expect(intervalLabel(120)).toBe("ogni 2 ore");
    expect(intervalLabel(1440)).toBe("ogni giorno");
  });
});
