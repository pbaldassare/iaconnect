import { ConnectorError, type HostResolver } from "@ia-connect/core";
import { describe, expect, it } from "vitest";
import {
  assertPublicHttpUrl,
  createImapSmtpConnector,
  crmRestConnector,
  guardedFetch,
  scraperSiteConnector,
} from "../src/index.ts";
import { fakeFetch, json, makeContext } from "./helpers.ts";

/** Finding 3 of the security audit: customer-supplied addresses must not reach our own network. */

const DNS: Record<string, string[]> = {
  "gestionale.example.com": ["93.184.216.34"],
  "www.portale.example": ["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"],
  "rebind.example.com": ["93.184.216.34", "10.0.0.7"],
  "inside.example.com": ["169.254.169.254"],
  "imap.example.com": ["198.51.100.1"],
  "mail.example.org": ["93.184.216.40"],
  "smtp.example.org": ["93.184.216.41"],
};
const resolveHost: HostResolver = async (hostname) => {
  const found = DNS[hostname];
  if (!found) throw new Error("ENOTFOUND");
  return found;
};

const redirect = (location: string, status = 302) => new Response(null, { status, headers: { location } });

async function failure(promise: Promise<unknown>): Promise<ConnectorError> {
  const error = await promise.then(
    () => undefined,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(ConnectorError);
  return error as ConnectorError;
}

describe("assertPublicHttpUrl", () => {
  it("refuses the forms the old pattern list let through", () => {
    for (const url of [
      "http://[::ffff:127.0.0.1]/",
      "http://[::ffff:7f00:1]/",
      "http://[::]/",
      "http://100.64.0.1/", // carrier-grade NAT
      "http://host.docker.internal:8080/",
      "http://metadata.google.internal/computeMetadata/v1/",
      "http://metadata/",
      "http://db.internal/",
      "http://printer.local/",
      "http://2130706433/",
      "http://0x7f.0.0.1/",
      "http://127.1/",
      "http://intranet/",
      "https://user:pass@example.com/",
      "file:///etc/passwd",
      "gopher://example.com/",
    ]) {
      expect(() => assertPublicHttpUrl(url, "Test"), url).toThrow(/non consentito|non valido/);
    }
    expect(assertPublicHttpUrl("https://gestionale.example.com/api", "Test").hostname).toBe(
      "gestionale.example.com",
    );
  });
});

describe("guardedFetch", () => {
  it("checks every redirect hop and never follows one to a private address", async () => {
    for (const target of [
      "http://169.254.169.254/latest/meta-data/",
      "http://localhost:5432/",
      "http://[::ffff:10.0.0.1]/",
      "http://inside.example.com/", // public name, private address
    ]) {
      const net = fakeFetch((call) =>
        call.url.startsWith("https://gestionale.example.com") ? redirect(target) : json({ secret: true }),
      );
      const error = await failure(
        guardedFetch(net.fetch, "Test", resolveHost)("https://gestionale.example.com/api/orders"),
      );
      expect(error.retryable, target).toBe(false);
      expect(error.message).toContain("non consentito");
      // The private address was never requested.
      expect(
        net.calls.map((call) => call.url),
        target,
      ).toEqual(["https://gestionale.example.com/api/orders"]);
    }
  });

  it("follows public redirects by hand, without carrying credentials to another origin", async () => {
    const net = fakeFetch((call) => {
      if (call.url === "https://gestionale.example.com/api/orders") return redirect("/api/v2/orders", 307);
      if (call.url === "https://gestionale.example.com/api/v2/orders")
        return redirect("https://www.portale.example/orders");
      return json({ ok: true });
    });
    const response = await guardedFetch(
      net.fetch,
      "Test",
      resolveHost,
    )("https://gestionale.example.com/api/orders", {
      headers: { "x-api-key": "crm-secret", accept: "application/json" },
    });
    expect(response.status).toBe(200);
    expect(
      net.calls.map((call) => [call.url, call.headers["x-api-key"] ?? null, call.headers.accept]),
    ).toEqual([
      ["https://gestionale.example.com/api/orders", "crm-secret", "application/json"],
      ["https://gestionale.example.com/api/v2/orders", "crm-secret", "application/json"],
      ["https://www.portale.example/orders", null, "application/json"],
    ]);
  });

  it("stops after five redirects and does not follow a redirect of a write", async () => {
    const loop = fakeFetch((call) => redirect(`${call.url}x`));
    const error = await failure(
      guardedFetch(loop.fetch, "Test", resolveHost)("https://gestionale.example.com/a"),
    );
    expect(error.message).toContain("troppi reindirizzamenti");
    expect(loop.calls).toHaveLength(6);

    const post = fakeFetch(() => redirect("https://www.portale.example/collect"));
    const refused = await failure(
      guardedFetch(
        post.fetch,
        "Test",
        resolveHost,
      )("https://gestionale.example.com/a", {
        method: "POST",
        body: "{}",
      }),
    );
    expect(refused.message).toContain("reindirizzamento non consentito");
    expect(post.calls).toHaveLength(1);
  });

  it("refuses a name that resolves to a private address, even next to a public one", async () => {
    const net = fakeFetch(() => json({}));
    for (const url of ["https://rebind.example.com/", "https://inside.example.com/"]) {
      const error = await failure(guardedFetch(net.fetch, "Test", resolveHost)(url));
      expect(error.options.code, url).toBe("private_host");
    }
    // A name that does not resolve is a (retryable) network problem, not a refusal.
    const missing = await failure(
      guardedFetch(net.fetch, "Test", resolveHost)("https://missing.example.com/"),
    );
    expect(missing.retryable).toBe(true);
    expect(net.calls).toEqual([]);
    // Without a resolver (edge function) only the name is checked.
    expect((await guardedFetch(net.fetch, "Test")("https://rebind.example.com/")).status).toBe(200);
  });
});

describe("connectors with customer-supplied addresses", () => {
  const crmInput = (baseUrl: string) => ({
    baseUrl,
    authHeaderValue: "crm-secret",
    resources: { ordini: { listPath: "/orders" } },
  });

  it("crm_rest: connect refuses internal addresses and DNS names that resolve inside", async () => {
    for (const baseUrl of [
      "http://[::ffff:127.0.0.1]:8080",
      "http://100.64.1.1/api",
      "http://host.docker.internal/api",
      "https://inside.example.com/api",
      "https://rebind.example.com/api",
    ]) {
      const net = fakeFetch(() => json([]));
      const error = await failure(
        crmRestConnector.connect(crmInput(baseUrl), { fetch: net.fetch, env: {}, resolveHost }),
      );
      expect(error.retryable, baseUrl).toBe(false);
      expect(net.calls, baseUrl).toEqual([]);
    }
  });

  it("crm_rest: a read does not follow the API into the metadata service, nor leak the key", async () => {
    const net = fakeFetch((call) =>
      call.url.startsWith("https://gestionale.example.com")
        ? redirect("http://169.254.169.254/latest/meta-data/iam/security-credentials/")
        : json({ AccessKeyId: "leak" }),
    );
    const context = {
      ...makeContext({
        connectorKey: "crm_rest",
        config: crmInput("https://gestionale.example.com/api"),
        secrets: { authHeaderValue: "crm-secret" },
        fetch: net.fetch,
      }),
      resolveHost,
    };
    const error = await failure(
      crmRestConnector.actions.read!.execute(context, { resource: "ordini", query: {} }),
    );
    expect(error.retryable).toBe(false);
    expect(net.calls).toHaveLength(1);
    expect((await crmRestConnector.verify(context)).status).toBe("error");
    expect(net.calls.every((call) => call.url.startsWith("https://gestionale.example.com/"))).toBe(true);
  });

  it("scraper_site: the reachability check does not follow a redirect inwards", async () => {
    const net = fakeFetch((call) =>
      call.url.startsWith("https://www.portale.example")
        ? redirect("http://localhost:9200/_cat/indices")
        : json({}),
    );
    const error = await failure(
      scraperSiteConnector.connect(
        { siteUrl: "https://www.portale.example/" },
        { fetch: net.fetch, env: {}, resolveHost },
      ),
    );
    expect(error.message).toContain("non consentito");
    expect(net.calls.map((call) => call.url)).toEqual(["https://www.portale.example/"]);

    const context = {
      ...makeContext({
        connectorKey: "scraper_site",
        config: { siteUrl: "https://inside.example.com/" },
        fetch: net.fetch,
      }),
      resolveHost,
    };
    expect((await scraperSiteConnector.verify(context)).status).toBe("error");
    expect(net.calls).toHaveLength(1);
  });

  it("imap_smtp: refuses internal mail hosts before opening a socket, and connects to the checked address", async () => {
    const opened: { kind: string; host: string; servername?: string; tls?: unknown }[] = [];
    const connector = createImapSmtpConnector({
      createImapClient: (options) => {
        opened.push({ kind: "imap", host: options.host, servername: options.servername });
        return {
          mailbox: false,
          connect: async () => undefined,
          logout: async () => undefined,
          getMailboxLock: async () => ({ release() {} }),
          fetch: async function* () {},
        };
      },
      createSmtpTransport: (options) => {
        opened.push({ kind: "smtp", host: options.host, tls: options.tls });
        return { verify: async () => true, sendMail: async () => ({ messageId: "<1@x>" }), close() {} };
      },
      parseMessage: async () => ({}),
    });
    const input = (imapHost: string, smtpHost: string) => ({
      email: "info@example.org",
      username: "info@example.org",
      password: "app-password",
      imapHost,
      smtpHost,
    });
    const deps = { fetch: fakeFetch(() => json({})).fetch, env: {}, resolveHost };

    for (const [imapHost, smtpHost] of [
      ["localhost", "smtp.example.org"],
      ["127.0.0.1", "smtp.example.org"],
      ["10.0.0.5", "smtp.example.org"],
      ["[::1]", "smtp.example.org"],
      ["redis.internal", "smtp.example.org"],
      ["inside.example.com", "smtp.example.org"], // resolves to 169.254.169.254
      ["imap.example.com", "smtp.example.org"], // resolves to a documentation (non-public) range
    ] as const) {
      const error = await failure(connector.connect(input(imapHost, smtpHost), deps));
      expect(error.retryable, imapHost).toBe(false);
    }
    expect(opened).toEqual([]);
    // The SMTP host is checked too, before the transport is created.
    await failure(connector.connect(input("mail.example.org", "169.254.169.254"), deps));
    expect(opened.map((entry) => entry.kind)).toEqual(["imap"]);

    opened.length = 0;
    await connector.connect(input("mail.example.org", "smtp.example.org"), deps);
    expect(opened).toEqual([
      { kind: "imap", host: "93.184.216.40", servername: "mail.example.org" },
      { kind: "smtp", host: "93.184.216.41", tls: { servername: "smtp.example.org" } },
    ]);

    // Sending and polling go through the same check.
    const context = {
      ...makeContext({
        connectorKey: "imap_smtp",
        config: { ...input("mail.example.org", "host.docker.internal"), password: undefined },
        secrets: { password: "p" },
      }),
      resolveHost,
    };
    opened.length = 0;
    await failure(connector.actions.send!.execute(context, { to: "a@b.it", subject: "s", text: "t" }));
    expect(opened).toEqual([]);
  });
});
