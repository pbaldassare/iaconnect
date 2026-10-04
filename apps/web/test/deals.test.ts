import { describe, expect, it } from "vitest";
import {
  buildBoard,
  dealAgeDays,
  dealAgeLabel,
  filterDeals,
  parseDealFilter,
  stageChange,
  stageIdsForFilter,
} from "../src/lib/deals/board";
import {
  buildDealCustomFields,
  buildDealFieldDefs,
  nextStagePosition,
  parseDealFieldDefs,
  reorderStages,
  stageKey,
  stageSetProblem,
} from "../src/lib/deals/stages";
import { buildOrgBrand, orgBrandFormValues } from "../src/lib/settings/brand";
import { hasManagePermission, memberChangeProblem, withManagePermission } from "../src/lib/settings/members";

const stages = [
  { id: "s-won", name: "Chiusa", position: 3, kind: "won" },
  { id: "s-new", name: "Nuova richiesta", position: 0, kind: "open" },
  { id: "s-quote", name: "Proposta inviata", position: 1, kind: "open" },
  { id: "s-lost", name: "Persa", position: 4, kind: "lost" },
];
const deal = (id: string, stage: string, value: number | null, extra: Record<string, unknown> = {}) => ({
  id,
  stage_id: stage,
  estimated_value_cents: value,
  created_at: "2026-09-20T10:00:00Z",
  closed_at: null as string | null,
  assignee_user_id: null as string | null,
  next_action_at: null as string | null,
  ...extra,
});
const U1 = "11111111-1111-4111-8111-111111111111";
const now = new Date("2026-10-04T10:00:00Z");

describe("buildBoard", () => {
  const deals = [
    deal("d1", "s-new", 100_000, { next_action_at: "2026-10-10T09:00:00Z" }),
    deal("d2", "s-new", null),
    deal("d3", "s-new", 50_000, { next_action_at: "2026-10-05T09:00:00Z" }),
    deal("d4", "s-won", 200_000, { closed_at: "2026-10-01T09:00:00Z" }),
    deal("d5", "s-gone", 1),
  ];
  const board = buildBoard(stages, deals);
  it("has one column per stage in pipeline order, even when empty", () => {
    expect(board.map((column) => column.stage.id)).toEqual(["s-new", "s-quote", "s-won", "s-lost"]);
    expect(board[1]).toMatchObject({ count: 0, valueCents: 0, deals: [] });
  });
  it("totals count and value per column", () => {
    expect(board[0]).toMatchObject({ count: 3, valueCents: 150_000, withoutValue: 1 });
    expect(board[2]).toMatchObject({ count: 1, valueCents: 200_000, withoutValue: 0 });
  });
  it("puts the most urgent next action first and deals without a date last", () => {
    expect(board[0]!.deals.map((d) => d.id)).toEqual(["d3", "d1", "d2"]);
  });
  it("works with no stages and no deals", () => {
    expect(buildBoard([], deals)).toEqual([]);
    expect(buildBoard(stages, []).every((column) => column.count === 0)).toBe(true);
  });
});

describe("stageChange", () => {
  const base = { organizationId: "org", actor: { id: U1, type: "user" as const }, now };
  const byId = (id: string) => stages.find((stage) => stage.id === id)!;
  it("moving between open stages keeps the deal open and writes the event", () => {
    const change = stageChange({
      ...base,
      deal: { id: "d1", stage_id: "s-new", closed_at: null },
      from: byId("s-new"),
      to: byId("s-quote"),
    });
    expect(change?.update).toEqual({ stage_id: "s-quote", closed_at: null });
    expect(change?.event).toEqual({
      organization_id: "org",
      deal_id: "d1",
      type: "stage_changed",
      from_stage_id: "s-new",
      to_stage_id: "s-quote",
      actor_type: "user",
      actor_id: U1,
      data: { from: "Nuova richiesta", to: "Proposta inviata" },
    });
  });
  it("sets closed_at when the deal is won or lost", () => {
    for (const to of ["s-won", "s-lost"]) {
      const change = stageChange({
        ...base,
        deal: { id: "d1", stage_id: "s-new", closed_at: null },
        from: byId("s-new"),
        to: byId(to),
      });
      expect(change?.update.closed_at).toBe(now.toISOString());
    }
  });
  it("keeps the closing date when moving from won to lost, clears it when reopened", () => {
    const closed = { id: "d1", stage_id: "s-won", closed_at: "2026-09-30T08:00:00Z" };
    expect(
      stageChange({ ...base, deal: closed, from: byId("s-won"), to: byId("s-lost") })?.update.closed_at,
    ).toBe("2026-09-30T08:00:00Z");
    expect(
      stageChange({ ...base, deal: closed, from: byId("s-won"), to: byId("s-new") })?.update.closed_at,
    ).toBeNull();
  });
  it("does nothing when the stage does not change, and records support staff as admin", () => {
    const d = { id: "d1", stage_id: "s-new", closed_at: null };
    expect(stageChange({ ...base, deal: d, from: byId("s-new"), to: byId("s-new") })).toBeNull();
    const change = stageChange({
      ...base,
      actor: { id: U1, type: "admin" },
      deal: d,
      from: null,
      to: byId("s-won"),
    });
    expect(change?.event.actor_type).toBe("admin");
    expect(change?.event.data).toEqual({ from: "", to: "Chiusa" });
  });
});

describe("deal list filters and age", () => {
  const deals = [
    deal("d1", "s-new", 1, { assignee_user_id: U1 }),
    deal("d2", "s-quote", 1),
    deal("d3", "s-won", 1),
    deal("d4", "s-lost", 1),
  ];
  it("parses the params", () => {
    expect(parseDealFilter({})).toEqual({ state: "aperte", stageId: null, assignee: null });
    expect(parseDealFilter({ stato: "vinte", fase: U1, assegnata: "nessuno" })).toEqual({
      state: "vinte",
      stageId: U1,
      assignee: "nessuno",
    });
    expect(parseDealFilter({ stato: "x", fase: "y", assegnata: "z" })).toEqual({
      state: "aperte",
      stageId: null,
      assignee: null,
    });
  });
  it("filters by state, stage and assignee", () => {
    const f = (filter: Partial<ReturnType<typeof parseDealFilter>>) =>
      filterDeals(deals, stages, { state: "aperte", stageId: null, assignee: null, ...filter }).map(
        (d) => d.id,
      );
    expect(f({})).toEqual(["d1", "d2"]);
    expect(f({ state: "vinte" })).toEqual(["d3"]);
    expect(f({ state: "perse" })).toEqual(["d4"]);
    expect(f({ state: "tutte" })).toEqual(["d1", "d2", "d3", "d4"]);
    expect(f({ state: "tutte", stageId: "s-quote" })).toEqual(["d2"]);
    expect(f({ assignee: U1 })).toEqual(["d1"]);
    expect(f({ assignee: "nessuno" })).toEqual(["d2"]);
    expect(stageIdsForFilter(stages, { state: "vinte", stageId: "s-new", assignee: null })).toEqual([]);
  });
  it("computes the age in whole days", () => {
    expect(dealAgeDays("2026-10-04T09:00:00Z", now)).toBe(0);
    expect(dealAgeDays("2026-10-01T09:00:00Z", now)).toBe(3);
    expect(dealAgeDays("2026-12-01T09:00:00Z", now)).toBe(0);
    expect([dealAgeLabel(0), dealAgeLabel(1), dealAgeLabel(3)]).toEqual([
      "da oggi",
      "da 1 giorno",
      "da 3 giorni",
    ]);
  });
});

describe("stage settings", () => {
  it("moves a stage up or down and renumbers the positions", () => {
    expect(reorderStages(stages, "s-quote", "up")).toEqual([
      { id: "s-quote", position: 0 },
      { id: "s-new", position: 1 },
      { id: "s-won", position: 2 },
      { id: "s-lost", position: 3 },
    ]);
    // Stored positions were 0, 1, 3, 4: "Chiusa" keeps 3, only "Persa" is rewritten.
    expect(reorderStages(stages, "s-won", "down")).toEqual([{ id: "s-lost", position: 2 }]);
  });
  it("only closes gaps at the edges, and ignores unknown stages", () => {
    const tidy = stages.map((stage, _i, all) => ({
      ...stage,
      position: [...all].sort((a, b) => a.position - b.position).indexOf(stage),
    }));
    expect(reorderStages(tidy, "s-new", "up")).toEqual([]);
    expect(reorderStages(tidy, "s-lost", "down")).toEqual([]);
    expect(reorderStages(stages, "nope", "up")).toEqual([]);
  });
  it("gives new stages a position, a unique key and requires an open stage", () => {
    expect(nextStagePosition(stages)).toBe(5);
    expect(nextStagePosition([])).toBe(0);
    expect(stageKey("In trattativa", ["new"])).toBe("in_trattativa");
    expect(stageKey("Persa!", ["persa", "persa_2"])).toBe("persa_3");
    expect(stageKey("???", [])).toBe("fase");
    expect(stageSetProblem(stages)).toBeNull();
    expect(stageSetProblem(stages.filter((s) => s.kind !== "open"))).toContain("almeno una fase aperta");
  });
});

describe("deal custom fields", () => {
  it("reads the stored definitions defensively", () => {
    expect(
      parseDealFieldDefs([
        { key: "polizza", label: "Tipo di polizza", type: "text" },
        { key: "premio", type: "number" },
        { key: "premio", label: "doppione" },
        { key: "Bad Key" },
        { key: "scadenza", label: " ", type: "boh" },
        "x",
      ]),
    ).toEqual([
      { key: "polizza", label: "Tipo di polizza", type: "text" },
      { key: "premio", label: "premio", type: "number" },
      { key: "scadenza", label: "scadenza", type: "text" },
    ]);
    expect(parseDealFieldDefs(null)).toEqual([]);
  });
  it("builds definitions from the editor rows", () => {
    expect(
      buildDealFieldDefs([
        { key: "", label: "Tipo di polizza", type: "text" },
        { key: "premio", label: "", type: "number" },
        { key: "", label: "", type: "text" },
      ]),
    ).toEqual({
      defs: [
        { key: "tipo_di_polizza", label: "Tipo di polizza", type: "text" },
        { key: "premio", label: "premio", type: "number" },
      ],
      errors: [],
    });
    expect(
      buildDealFieldDefs([
        { key: "a", label: "A", type: "text" },
        { key: "A", label: "B", type: "text" },
        { key: "1x", label: "C", type: "text" },
      ]).errors,
    ).toHaveLength(2);
  });
  it("types the values of a deal and keeps values of removed fields", () => {
    const defs = parseDealFieldDefs([
      { key: "premio", type: "number" },
      { key: "scadenza", type: "date" },
      { key: "rinnovo", type: "boolean" },
      { key: "note", type: "text" },
    ]);
    expect(
      buildDealCustomFields(
        defs,
        { premio: "1.250,50", scadenza: "2026-12-31", rinnovo: "true", note: "" },
        { vecchio: "resta", premio: 1 },
      ),
    ).toEqual({
      fields: { vecchio: "resta", premio: 1250.5, scadenza: "2026-12-31", rinnovo: true },
      errors: {},
    });
    expect(buildDealCustomFields(defs, { premio: "12.5" }, null).fields).toEqual({ premio: 12.5 });
    expect(buildDealCustomFields(defs, { premio: "tanto", scadenza: "domani" }, null).errors).toEqual({
      premio: "Scrivi un numero.",
      scadenza: "Scegli una data valida.",
    });
  });
});

describe("organization brand", () => {
  const normalize = (raw: string) => (raw.replace(/\D/g, "") ? `+${raw.replace(/\D/g, "")}` : null);
  const empty = { name: "", logoUrl: "", accent: "", ownerPhone: "", ownerEmail: "" };
  it("validates and stores only what is filled in, keeping unknown keys", () => {
    expect(
      buildOrgBrand(
        {
          name: " Agenzia Rossi ",
          logoUrl: "https://x.it/logo.png",
          accent: "#1F7A4D",
          ownerPhone: "+39 333 1234567",
          ownerEmail: "Titolare@X.it",
        },
        { extra: 1, ownerPhone: "+390000" },
        normalize,
      ),
    ).toEqual({
      ok: true,
      brand: {
        extra: 1,
        name: "Agenzia Rossi",
        logoUrl: "https://x.it/logo.png",
        accent: "#1f7a4d",
        ownerPhone: "+393331234567",
        ownerEmail: "titolare@x.it",
      },
    });
    expect(buildOrgBrand(empty, { ownerPhone: "+39333" }, normalize)).toEqual({ ok: true, brand: {} });
  });
  it("reports each invalid field", () => {
    const result = buildOrgBrand(
      { name: "", logoUrl: "http://x.it/a.png", accent: "verde", ownerPhone: "12", ownerEmail: "x" },
      {},
      normalize,
    );
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(Object.keys(result.errors).sort()).toEqual(["accent", "logoUrl", "ownerEmail", "ownerPhone"]);
  });
  it("fills the form from the stored JSON", () => {
    expect(orgBrandFormValues({ name: "A", accent: "#000000", ownerEmail: "a@b.it", ownerPhone: 5 })).toEqual(
      {
        name: "A",
        logoUrl: "",
        accent: "#000000",
        ownerPhone: "",
        ownerEmail: "a@b.it",
      },
    );
    expect(orgBrandFormValues(null)).toEqual(empty);
  });
});

describe("members", () => {
  const members = [
    { id: "m1", user_id: "u1", role: "org_owner", permissions: {} },
    { id: "m2", user_id: "u2", role: "org_member", permissions: { manage: true, other: 1 } },
  ];
  it("never leaves the organization without an owner", () => {
    expect(memberChangeProblem(members, "m1", "remove")).toContain("unico titolare");
    expect(memberChangeProblem(members, "m1", "demote")).toContain("unico titolare");
    expect(memberChangeProblem(members, "m2", "remove")).toBeNull();
    expect(memberChangeProblem(members, "zz", "remove")).toContain("non fa più parte");
    const two = [...members, { id: "m3", user_id: "u3", role: "org_owner", permissions: {} }];
    expect(memberChangeProblem(two, "m1", "demote")).toBeNull();
  });
  it("reads and writes the manage permission without touching the others", () => {
    expect(hasManagePermission(members[1]!.permissions)).toBe(true);
    expect(hasManagePermission({ manage: "true" })).toBe(false);
    expect(hasManagePermission(null)).toBe(false);
    expect(withManagePermission({ manage: true, other: 1 }, false)).toEqual({ manage: false, other: 1 });
    expect(withManagePermission(null, true)).toEqual({ manage: true });
  });
});
