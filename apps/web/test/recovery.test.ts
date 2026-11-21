import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  formatLinePhone,
  recoverySettingsView,
  recoverySheet,
  sessionStatusUrl,
  showsRecoverySheet,
} from "../src/lib/connections/recovery";

const HIDDEN = "gateway-token-must-stay-hidden";

describe("WhatsApp recovery sheet", () => {
  it("builds the session status URL from the gateway base and the instance id", () => {
    expect(sessionStatusUrl("https://whatsapp.futureflow.it", "xZ8cOwc3ZvJ7D4DL")).toBe(
      "https://whatsapp.futureflow.it/sessionStatus/xZ8cOwc3ZvJ7D4DL",
    );
    expect(sessionStatusUrl("https://whatsapp.futureflow.it/", "xZ8cOwc3ZvJ7D4DL")).toBe(
      "https://whatsapp.futureflow.it/sessionStatus/xZ8cOwc3ZvJ7D4DL",
    );
    expect(sessionStatusUrl("https://wa.example.com/gateway", "a b")).toBe(
      "https://wa.example.com/gateway/sessionStatus/a%20b",
    );
  });

  it("returns no link when the instance id or a public base is missing", () => {
    expect(sessionStatusUrl("https://whatsapp.futureflow.it", "")).toBeNull();
    expect(sessionStatusUrl("https://whatsapp.futureflow.it", "   ")).toBeNull();
    expect(sessionStatusUrl("https://whatsapp.futureflow.it", null)).toBeNull();
    expect(sessionStatusUrl("", "abc")).toBeNull();
    expect(sessionStatusUrl(null, "abc")).toBeNull();
    expect(sessionStatusUrl("nota senza indirizzo", "abc")).toBeNull();
    expect(sessionStatusUrl("https://user:secret@wa.example.com", "abc")).toBeNull();
  });

  it("strips secret keys and keeps the public restore facts", () => {
    const sheet = recoverySheet({
      externalAccountId: "inst-1",
      config: {
        phone: "+393318611124",
        displayPhoneNumber: "+390000000000",
        baseUrl: "https://whatsapp.futureflow.it/",
        instanceId: "inst-1",
        sessionId: "other-session",
        lineName: "Linea principale",
        inboundWebhookUrl: "https://example.supabase.co/functions/v1/whatsapp-webhook",
        office: "Sede",
        apiKey: HIDDEN,
        accessToken: "access-token-hidden",
        webhookSecret: "webhook-secret-hidden",
        password: "password-hidden",
        cursor: { last: 1, token: HIDDEN },
        pollIntervalMinutes: 15,
        statusCallbackUrl: "https://status.example/callback",
        notes: [
          { label: "Numero di prova", value: "+39 02 0000 0000" },
          { label: "apiKey", value: HIDDEN },
          { label: "", value: "vuota" },
        ],
        note: "Promemoria interno",
      },
    });

    expect(sheet.phone).toBe("+393318611124");
    expect(sheet.lineName).toBe("Linea principale");
    expect(sheet.baseUrl).toBe("https://whatsapp.futureflow.it");
    expect(sheet.instanceId).toBe("inst-1");
    expect(sheet.sessionStatusUrl).toBe("https://whatsapp.futureflow.it/sessionStatus/inst-1");
    expect(sheet.inboundWebhookUrl).toBe("https://example.supabase.co/functions/v1/whatsapp-webhook");
    expect(sheet.notes).toEqual([
      { label: "Numero di prova", value: "+39 02 0000 0000" },
      { label: "Nota", value: "Promemoria interno" },
    ]);
    expect(sheet.extras).toEqual([
      { key: "displayPhoneNumber", label: "Numero visualizzato", value: "+390000000000" },
      { key: "office", label: "office", value: "Sede" },
      { key: "sessionId", label: "Sessione", value: "other-session" },
    ]);

    const dumped = JSON.stringify(sheet);
    expect(dumped).not.toContain(HIDDEN);
    expect(dumped).not.toContain("access-token-hidden");
    expect(dumped).not.toContain("webhook-secret-hidden");
    expect(dumped).not.toContain("password-hidden");
    expect(dumped).not.toContain("pollIntervalMinutes");
    expect(dumped).not.toContain("status.example");
    expect(dumped).not.toContain("cursor");
  });

  it("uses the external account id when the config has no instance id, and no link without one", () => {
    const fromAccount = recoverySheet({
      externalAccountId: "ext-9",
      config: { baseUrl: "https://wa.example.com" },
    });
    expect(fromAccount.instanceId).toBe("ext-9");
    expect(fromAccount.sessionStatusUrl).toBe("https://wa.example.com/sessionStatus/ext-9");

    const fromSession = recoverySheet({
      externalAccountId: null,
      config: { sessionId: "sess-2", baseUrl: "https://wa.example.com" },
    });
    expect(fromSession.instanceId).toBe("sess-2");
    expect(fromSession.sessionStatusUrl).toBe("https://wa.example.com/sessionStatus/sess-2");

    const missing = recoverySheet({
      externalAccountId: "  ",
      config: { baseUrl: "https://wa.example.com", instanceId: "" },
    });
    expect(missing.instanceId).toBeNull();
    expect(missing.sessionStatusUrl).toBeNull();
  });

  it("drops a base URL that carries credentials and does not link it", () => {
    const sheet = recoverySheet({
      externalAccountId: "inst-1",
      config: { baseUrl: "https://user:secret@wa.example.com", instanceId: "inst-1" },
    });
    expect(sheet.baseUrl).toBeNull();
    expect(sheet.sessionStatusUrl).toBeNull();
    expect(JSON.stringify(sheet)).not.toContain("secret");
  });

  it("groups an Italian mobile and leaves other numbers untouched", () => {
    expect(formatLinePhone("+393318611124")).toBe("+39 331 861 1124");
    expect(formatLinePhone("+39 331 861 1124")).toBe("+39 331 861 1124");
    expect(formatLinePhone("+39 02 8111 7548")).toBe("+39 02 8111 7548");
  });

  it("offers the sheet for the QR WhatsApp connector and for QR mode only", () => {
    expect(showsRecoverySheet("whatsapp_wawebapi", "qr")).toBe(true);
    expect(showsRecoverySheet("whatsapp_wawebapi", "")).toBe(true);
    expect(showsRecoverySheet("other_qr", "qr")).toBe(true);
    expect(showsRecoverySheet("whatsapp_meta", "api_key")).toBe(false);
    expect(showsRecoverySheet("gmail", "oauth")).toBe(false);
  });

  it("places qualifying connections on the settings page, and an empty list stays empty", () => {
    const line = { id: "a", connectorType: "whatsapp_wawebapi", connectMode: "", name: "Linea" };
    const otherQr = { id: "b", connectorType: "custom_qr", connectMode: "qr", name: "Altra" };
    const mail = { id: "c", connectorType: "gmail", connectMode: "oauth", name: "Mail" };
    const meta = { id: "d", connectorType: "whatsapp_meta", connectMode: "api_key", name: "Meta" };

    expect(recoverySettingsView([], null)).toEqual({ kind: "empty" });
    expect(recoverySettingsView([mail, meta], null)).toEqual({ kind: "empty" });
    expect(recoverySettingsView([mail, line], null)).toEqual({
      kind: "sheet",
      connection: line,
      total: 1,
    });
    expect(recoverySettingsView([line], line.id)).toEqual({
      kind: "sheet",
      connection: line,
      total: 1,
    });

    expect(recoverySettingsView([mail, line, otherQr], null)).toEqual({
      kind: "list",
      connections: [line, otherQr],
    });
    expect(recoverySettingsView([line, otherQr], otherQr.id)).toEqual({
      kind: "sheet",
      connection: otherQr,
      total: 2,
    });
    expect(recoverySettingsView([], line.id)).toEqual({ kind: "missing" });
    expect(recoverySettingsView([line], mail.id)).toEqual({ kind: "missing" });
    expect(recoverySettingsView([line, otherQr], mail.id)).toEqual({ kind: "missing" });
    expect(recoverySettingsView([mail], mail.id)).toEqual({ kind: "missing" });
  });

  it("keeps the page on the manager gate and off the node connector registry", () => {
    const source = readFileSync(
      join(import.meta.dirname, "../src/app/app/collegamenti/[id]/ripristino/page.tsx"),
      "utf8",
    );
    expect(source).toContain("requireOrgManager");
    expect(source).toContain("showsRecoverySheet");
    expect(source).not.toMatch(/from\s+"@ia-connect\/connectors"/);
    expect(source).not.toContain("apiKey");
    expect(source).not.toContain(HIDDEN);
  });
});
