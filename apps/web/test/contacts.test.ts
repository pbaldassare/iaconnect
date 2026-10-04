import { describe, expect, it } from "vitest";
import {
  consentRows,
  grantConsent,
  hasConsent,
  parseConsents,
  revokeConsent,
} from "../src/lib/contacts/consents";
import {
  contactSearchFilter,
  customFieldRows,
  fieldKey,
  fieldValue,
  parseCustomFields,
  parseEmails,
  parsePhones,
} from "../src/lib/contacts/fields";
import { mergeTimeline } from "../src/lib/contacts/timeline";

const now = new Date("2026-10-04T10:00:00Z");
// Same behaviour as normalizePhone in packages/core, kept local so the test has no package dependency.
const normalize = (raw: string) => {
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  if (raw.trim().startsWith("+")) return `+${digits}`;
  return digits.length <= 10 ? `+39${digits}` : `+${digits}`;
};

describe("consents", () => {
  const stored = {
    whatsapp: { granted: true, at: "2026-09-01T08:00:00Z", source: "Messaggio ricevuto dal contatto" },
    mail: { granted: false, at: "2026-09-10T08:00:00Z", source: "Richiesta via mail" },
    sms: "sì",
    fax: { granted: true },
  };
  it("reads the stored JSON and drops what is malformed", () => {
    expect(Object.keys(parseConsents(stored))).toEqual(["whatsapp", "mail"]);
    expect(parseConsents(null)).toEqual({});
    expect(parseConsents([])).toEqual({});
  });
  it("counts only an explicit grant as valid", () => {
    const consents = parseConsents(stored);
    expect(hasConsent(consents, "whatsapp")).toBe(true);
    expect(hasConsent(consents, "mail")).toBe(false);
    expect(hasConsent(consents, "sms")).toBe(false);
  });
  it("lists every channel with its state, date and source", () => {
    expect(consentRows(parseConsents(stored))).toEqual([
      {
        channel: "whatsapp",
        state: "granted",
        at: "2026-09-01T08:00:00Z",
        source: "Messaggio ricevuto dal contatto",
      },
      { channel: "mail", state: "revoked", at: "2026-09-10T08:00:00Z", source: "Richiesta via mail" },
      { channel: "sms", state: "missing", at: null, source: null },
      { channel: "social", state: "missing", at: null, source: null },
    ]);
  });
  it("records a grant with date and source, leaving the other channels alone", () => {
    const next = grantConsent(stored, "sms", "  Modulo firmato in agenzia ", now);
    expect(next.sms).toEqual({ granted: true, at: now.toISOString(), source: "Modulo firmato in agenzia" });
    expect(next.whatsapp).toEqual(stored.whatsapp);
    expect(grantConsent(null, "mail", "Telefono", now)).toEqual({
      mail: { granted: true, at: now.toISOString(), source: "Telefono" },
    });
  });
  it("keeps date and source of a revocation", () => {
    const next = revokeConsent(stored, "whatsapp", "Ha chiesto di non essere più contattato", now);
    expect(next.whatsapp).toEqual({
      granted: false,
      at: now.toISOString(),
      source: "Ha chiesto di non essere più contattato",
    });
    expect(next.mail).toEqual(stored.mail);
    expect(hasConsent(parseConsents(next), "whatsapp")).toBe(false);
    expect(consentRows(parseConsents(next))[0]).toMatchObject({ state: "revoked", at: now.toISOString() });
    // Without a reason the revocation is still dated and attributed.
    expect((revokeConsent({}, "sms", " ", now).sms as { source: string }).source).toBe(
      "Revocato dall'operatore",
    );
  });
});

describe("contact form", () => {
  it("normalizes phones, removes doubles, reports the invalid ones", () => {
    expect(parsePhones("333 1234567\n+39 333 1234567, 02 12345678; abc\n12", normalize)).toEqual({
      phones: ["+393331234567", "+390212345678"],
      invalid: ["abc", "12"],
    });
    expect(parsePhones("", normalize)).toEqual({ phones: [], invalid: [] });
  });
  it("lowercases mails and reports the invalid ones", () => {
    expect(parseEmails("Maria@Example.it, maria@example.it\nnon-una-mail")).toEqual({
      emails: ["maria@example.it"],
      invalid: ["non-una-mail"],
    });
  });
  it("builds custom fields with clean keys and typed values", () => {
    expect(fieldKey("Budget max (€)")).toBe("budget_max");
    expect(fieldValue("250000")).toBe(250000);
    expect(fieldValue("1500,50")).toBe(1500.5);
    expect(fieldValue("0612345")).toBe("0612345");
    expect(fieldValue("Centro storico")).toBe("Centro storico");
    expect(parseCustomFields(["Zona", "budget_max", "", "vuoto"], ["Centro", "250000", "", ""])).toEqual({
      fields: { zona: "Centro", budget_max: 250000 },
      errors: [],
    });
    expect(parseCustomFields(["zona", "Zona", "123"], ["a", "b", "c"]).errors).toHaveLength(2);
  });
  it("turns stored fields back into editor rows", () => {
    expect(
      customFieldRows({ zona: "Centro", budget_max: 1500.5, vip: true, vuoto: "", altro: { a: 1 } }),
    ).toEqual([
      { key: "zona", value: "Centro" },
      { key: "budget_max", value: "1500,5" },
      { key: "vip", value: "true" },
      { key: "altro", value: '{"a":1}' },
    ]);
    expect(customFieldRows(null)).toEqual([]);
  });
  it("builds the search filter", () => {
    expect(contactSearchFilter("  ", normalize)).toBeNull();
    expect(contactSearchFilter("rossi", normalize)).toBe('full_name.ilike."%rossi%"');
    expect(contactSearchFilter("333 1234567", normalize)).toBe(
      'full_name.ilike."%333 1234567%",phones.cs.{+393331234567}',
    );
    expect(contactSearchFilter("Maria@Example.it", normalize)).toBe(
      'full_name.ilike."%Maria@Example.it%",emails.cs.{"maria@example.it"}',
    );
    // Characters with a meaning for LIKE or for the filter syntax are escaped.
    expect(contactSearchFilter('50%_"a', normalize)).toBe('full_name.ilike."%50\\\\%\\\\_\\"a%"');
  });
});

describe("mergeTimeline", () => {
  it("merges the three sources, newest first", () => {
    const items = mergeTimeline({
      messages: [
        {
          id: "m1",
          created_at: "2026-10-01T10:00:00Z",
          direction: "in",
          channel: "whatsapp",
          content: "Buongiorno",
          ai_generated: false,
          conversation_id: "c1",
        },
      ],
      dealEvents: [
        {
          id: "e1",
          created_at: "2026-10-02T10:00:00Z",
          deal_id: "d1",
          type: "stage_changed",
          from_stage_id: "s1",
          to_stage_id: "s2",
          actor_type: "user",
        },
      ],
      appointments: [
        { id: "a1", starts_at: "2026-10-03T10:00:00Z", title: "Visita", status: "booked", location: null },
      ],
    });
    expect(items.map((item) => `${item.kind}:${item.id}`)).toEqual([
      "appointment:a1",
      "deal_event:e1",
      "message:m1",
    ]);
  });
  it("is empty without data", () => {
    expect(mergeTimeline({ messages: [], dealEvents: [], appointments: [] })).toEqual([]);
  });
});
