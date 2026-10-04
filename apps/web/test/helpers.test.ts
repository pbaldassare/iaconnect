import { describe, expect, it } from "vitest";
import { z } from "zod";
import { errorMessage, fail, formToObject, ok, parseForm } from "../src/lib/action";
import { auditFieldLabel, changedFields, describeAuditAction, isSupportRow } from "../src/lib/audit-labels";
import { brandToJson, mergeBrand, parseBrand } from "../src/lib/brand";
import {
  aggregateAiSpend,
  connectionsNeedingAttention,
  countByStatus,
  dealsByStage,
  onboardingSteps,
} from "../src/lib/dashboard";
import { KNOWN_FEATURES, isFeatureEnabled } from "../src/lib/features";
import { escapeLike, pageCount, pageWindow, parsePage, withParams } from "../src/lib/pagination";
import {
  centsToEurosInput,
  eurosToCents,
  nextDay,
  parseIsoDate,
  parseLimit,
  slugify,
} from "../src/lib/parse";

describe("action results", () => {
  it("builds ok and fail results", () => {
    expect(ok()).toEqual({ ok: true });
    expect(ok("Salvato.")).toEqual({ ok: true, message: "Salvato." });
    expect(fail("No", { name: "Manca" })).toEqual({
      ok: false,
      message: "No",
      fieldErrors: { name: "Manca" },
    });
  });

  it("explains database errors in Italian", () => {
    expect(
      errorMessage({ code: "PGRST106", message: "The schema must be one of the following: public" }),
    ).toMatch(/Exposed schemas/);
    expect(errorMessage({ code: "42501", message: "new row violates row-level security policy" })).toBe(
      "Non hai i permessi per questa operazione.",
    );
    expect(errorMessage({ code: "23505", message: "duplicate key" })).toMatch(/Esiste già/);
    expect(errorMessage({ message: "TypeError: fetch failed" })).toMatch(/non risponde/);
    expect(errorMessage(new Error("boom"))).toMatch(/Operazione non riuscita/);
    expect(errorMessage(null)).toMatch(/Operazione non riuscita/);
  });

  it("passes through the missing service key message", () => {
    const error = Object.assign(new Error("Manca la chiave."), { name: "MissingServiceKeyError" });
    expect(errorMessage(error)).toBe("Manca la chiave.");
  });

  it("turns a form into an object and validates it", () => {
    const form = new FormData();
    form.set("name", " Rossi ");
    form.append("plans", "pro");
    form.append("plans", "business");
    expect(formToObject(form)).toEqual({ name: " Rossi ", plans: ["pro", "business"] });

    const schema = z.object({ name: z.string().trim().min(10, "Troppo corto.") });
    const parsed = parseForm(schema, form);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.result).toEqual({
        ok: false,
        message: "Controlla i campi evidenziati.",
        fieldErrors: { name: "Troppo corto." },
      });
    }
    const good = parseForm(z.object({ name: z.string().trim() }), form);
    expect(good).toEqual({ ok: true, data: { name: "Rossi" } });
  });
});

describe("audit labels", () => {
  it("describes trigger actions and explicit actions", () => {
    expect(describeAuditAction("connections.update")).toBe("Collegamento: modifica");
    expect(describeAuditAction("flows.insert")).toBe("Flusso: creazione");
    expect(describeAuditAction("support_sessions.insert")).toBe("Accesso in assistenza: inizio");
    expect(describeAuditAction("organization.export")).toBe("Esportazione dei dati dell'azienda");
    expect(describeAuditAction("job.simulate_flow")).toBe("Richiesta al motore: simulazione di un flusso");
    expect(describeAuditAction("something.else")).toBe("something.else");
  });

  it("spots support rows", () => {
    expect(isSupportRow({ is_support_access: true, entity_type: "flows", action: "flows.update" })).toBe(
      true,
    );
    expect(isSupportRow({ is_support_access: false, entity_type: "support_sessions", action: "x" })).toBe(
      true,
    );
    expect(isSupportRow({ is_support_access: false, entity_type: "flows", action: "flows.update" })).toBe(
      false,
    );
  });

  it("reads the changed fields", () => {
    expect(changedFields({ changed: ["name", "status", 3] })).toEqual(["name", "status"]);
    expect(changedFields({})).toEqual([]);
    expect(auditFieldLabel("stage_id")).toBe("fase");
    expect(auditFieldLabel("status")).toBe("stato");
    expect(auditFieldLabel("webhook_token")).toBe("webhook token");
    expect(auditFieldLabel("template_id")).toBe("template");
    expect(changedFields(null)).toEqual([]);
  });
});

describe("brand", () => {
  it("accepts only a hex color and an https logo", () => {
    expect(
      parseBrand({ name: " Agenzia Rossi ", logoUrl: "https://x.example/l.png", accent: "#0A7F5A" }),
    ).toEqual({
      name: "Agenzia Rossi",
      logoUrl: "https://x.example/l.png",
      accent: "#0a7f5a",
    });
    expect(
      parseBrand({ name: "", logoUrl: "http://x.example/l.png", accent: "red; background:url(x)" }),
    ).toEqual({
      name: null,
      logoUrl: null,
      accent: null,
    });
    expect(parseBrand({ logoUrl: "javascript:alert(1)" }).logoUrl).toBeNull();
    expect(parseBrand(null)).toEqual({ name: null, logoUrl: null, accent: null });
  });

  it("prefers the organization brand, field by field", () => {
    expect(
      mergeBrand(
        { name: "Rossi", logoUrl: null, accent: null },
        { name: "Rivenditore", logoUrl: "https://r.example/l.png", accent: "#112233" },
      ),
    ).toEqual({ name: "Rossi", logoUrl: "https://r.example/l.png", accent: "#112233" });
  });

  it("stores only the filled fields", () => {
    expect(brandToJson({ name: "Rossi", logoUrl: "", accent: "" })).toEqual({ name: "Rossi" });
    expect(brandToJson({})).toEqual({});
  });
});

describe("dashboard aggregations", () => {
  const connections = [
    { status: "active", category: "mail" },
    { status: "error", category: "whatsapp" },
    { status: "expired", category: "crm" },
    { status: "active", category: "crm" },
  ];

  it("counts by status and finds what needs attention", () => {
    expect(countByStatus(connections)).toEqual({ active: 2, error: 1, expired: 1 });
    expect(connectionsNeedingAttention(connections).map((c) => c.status)).toEqual(["error", "expired"]);
  });

  it("groups open deals by stage in pipeline order", () => {
    const stages = [
      { id: "s2", name: "Proposta inviata", position: 1, kind: "open" },
      { id: "s1", name: "Nuova richiesta", position: 0, kind: "open" },
      { id: "s3", name: "Chiusa", position: 3, kind: "won" },
    ];
    const deals = [
      { stage_id: "s1", estimated_value_cents: 10000 },
      { stage_id: "s1", estimated_value_cents: null },
      { stage_id: "s2", estimated_value_cents: 25050 },
      { stage_id: "s3", estimated_value_cents: 999 },
    ];
    expect(dealsByStage(stages, deals)).toEqual([
      { stageId: "s1", name: "Nuova richiesta", kind: "open", count: 2, valueCents: 10000 },
      { stageId: "s2", name: "Proposta inviata", kind: "open", count: 1, valueCents: 25050 },
    ]);
  });

  it("tracks the first steps of a new customer", () => {
    expect(onboardingSteps([], []).map((s) => s.done)).toEqual([false, false, false]);
    const steps = onboardingSteps(connections, [{ status: "draft" }]);
    expect(steps.map((s) => [s.key, s.done])).toEqual([
      ["mail", true],
      ["whatsapp", false],
      ["flow", false],
    ]);
    expect(onboardingSteps(connections, [{ status: "active" }])[2]!.done).toBe(true);
  });

  it("sums AI spend by organization and purpose, most expensive first", () => {
    expect(
      aggregateAiSpend([
        { organization_id: "a", purpose: "ai.reply", cost_micros: 100, credits: 1 },
        { organization_id: "a", purpose: "ai.reply", cost_micros: 300, credits: 2 },
        { organization_id: "b", purpose: "ai.extract", cost_micros: 900, credits: 1 },
        { organization_id: "a", purpose: "ai.extract", cost_micros: 50, credits: 1 },
      ]),
    ).toEqual([
      { organizationId: "b", purpose: "ai.extract", calls: 1, costMicros: 900, credits: 1 },
      { organizationId: "a", purpose: "ai.reply", calls: 2, costMicros: 400, credits: 3 },
      { organizationId: "a", purpose: "ai.extract", calls: 1, costMicros: 50, credits: 1 },
    ]);
  });
});

describe("feature flags", () => {
  it("uses the stored row, then the default, and is off for unknown keys", () => {
    const on = KNOWN_FEATURES.find((f) => f.defaultEnabled)!;
    const off = KNOWN_FEATURES.find((f) => !f.defaultEnabled)!;
    expect(isFeatureEnabled([], on.key)).toBe(true);
    expect(isFeatureEnabled([], off.key)).toBe(false);
    expect(isFeatureEnabled([{ feature_key: on.key, enabled: false }], on.key)).toBe(false);
    expect(isFeatureEnabled([{ feature_key: off.key, enabled: true }], off.key)).toBe(true);
    expect(isFeatureEnabled([], "does_not_exist")).toBe(false);
  });

  it("has unique keys", () => {
    expect(new Set(KNOWN_FEATURES.map((f) => f.key)).size).toBe(KNOWN_FEATURES.length);
  });
});

describe("pagination", () => {
  it("parses the page and computes the row window", () => {
    expect(parsePage("3")).toBe(3);
    expect(parsePage("0")).toBe(1);
    expect(parsePage("abc")).toBe(1);
    expect(parsePage(undefined)).toBe(1);
    expect(parsePage(["2", "9"])).toBe(2);
    expect(pageWindow(1, 25)).toEqual({ from: 0, to: 24 });
    expect(pageWindow(3, 25)).toEqual({ from: 50, to: 74 });
    expect(pageCount(0, 25)).toBe(1);
    expect(pageCount(26, 25)).toBe(2);
  });

  it("builds links without empty params and without page 1", () => {
    expect(withParams("/admin/aziende", { q: "rossi & c", stato: "", pagina: 1 })).toBe(
      "/admin/aziende?q=rossi+%26+c",
    );
    expect(withParams("/admin/aziende", { q: null, pagina: 2 })).toBe("/admin/aziende?pagina=2");
    expect(withParams("/x", {})).toBe("/x");
  });

  it("escapes like wildcards", () => {
    expect(escapeLike("100%_ok\\")).toBe("100\\%\\_ok\\\\");
  });
});

describe("form parsers", () => {
  it("parses euro amounts", () => {
    expect(eurosToCents("249")).toBe(24900);
    expect(eurosToCents("249,5")).toBe(24950);
    expect(eurosToCents("1.249,00")).toBe(124900);
    expect(eurosToCents("249.50")).toBe(24950);
    expect(eurosToCents(" 99 € ")).toBe(9900);
    expect(eurosToCents("0")).toBe(0);
    expect(eurosToCents("")).toBeNull();
    expect(eurosToCents("-5")).toBeNull();
    expect(eurosToCents("abc")).toBeNull();
    expect(eurosToCents("1,234")).toBeNull();
  });

  it("round-trips cents to the input text", () => {
    expect(centsToEurosInput(24900)).toBe("249");
    expect(centsToEurosInput(24950)).toBe("249,50");
    expect(eurosToCents(centsToEurosInput(59905))).toBe(59905);
  });

  it("parses plan limits, -1 meaning unlimited", () => {
    expect(parseLimit("10")).toBe(10);
    expect(parseLimit("-1")).toBe(-1);
    expect(parseLimit("0")).toBe(0);
    expect(parseLimit("-2")).toBeNull();
    expect(parseLimit("1.5")).toBeNull();
    expect(parseLimit("")).toBeNull();
  });

  it("makes slugs", () => {
    expect(slugify("Agenzia Rossi & C.")).toBe("agenzia-rossi-c");
    expect(slugify("  Città Più  ")).toBe("citta-piu");
    expect(slugify("!!!")).toBe("");
  });

  it("validates and advances dates", () => {
    expect(parseIsoDate("2026-10-04")).toBe("2026-10-04");
    expect(parseIsoDate("2026-02-30")).toBeNull();
    expect(parseIsoDate("04/10/2026")).toBeNull();
    expect(parseIsoDate(undefined)).toBeNull();
    expect(nextDay("2026-10-31")).toBe("2026-11-01");
    expect(nextDay("2026-12-31")).toBe("2027-01-01");
  });
});
