import { describe, expect, it } from "vitest";
import { safeInternalLink } from "../src/lib/customer-labels";
import {
  filterConversations,
  inboxCounts,
  inboxFilterParams,
  matchesSearch,
  messagePreview,
  parseInboxFilter,
} from "../src/lib/inbox/filters";
import { composerMode, whatsappWindow } from "../src/lib/inbox/window";
import {
  checkVariables,
  missingPlaceholders,
  placeholderIndexes,
  renderTemplate,
  sampleVariables,
  variableCount,
} from "../src/lib/message-templates";

const now = new Date("2026-10-04T10:00:00Z");

describe("whatsappWindow", () => {
  it("does not apply to the other channels", () => {
    const state = whatsappWindow("mail", null, now);
    expect(state).toMatchObject({ applies: false, open: true });
    expect(composerMode(state)).toBe("free_or_template");
  });
  it("is closed when the contact never wrote", () => {
    const state = whatsappWindow("whatsapp", null, now);
    expect(state).toMatchObject({ applies: true, open: false, minutesLeft: 0, expiresAt: null });
    expect(state.note).toContain("non ha ancora scritto");
    expect(composerMode(state)).toBe("template_only");
  });
  it("is closed once the 24 hours have passed, and exactly at the limit", () => {
    expect(whatsappWindow("whatsapp", "2026-10-04T09:59:59Z", now).open).toBe(false);
    expect(whatsappWindow("whatsapp", now.toISOString(), now).open).toBe(false);
    expect(whatsappWindow("whatsapp", "2026-10-03T08:00:00Z", now).note).toContain("24 ore");
  });
  it("is open with the time left", () => {
    const state = whatsappWindow("whatsapp", "2026-10-04T12:30:00Z", now);
    expect(state).toMatchObject({ applies: true, open: true, minutesLeft: 150 });
    expect(state.note).toContain("2 ore e 30 min");
    expect(composerMode(state)).toBe("free_or_template");
    expect(whatsappWindow("whatsapp", "2026-10-04T10:00:30Z", now).note).toContain("meno di un minuto");
  });
  it("treats an unreadable date as closed", () => {
    expect(whatsappWindow("whatsapp", "boh", now).open).toBe(false);
  });
});

const rows = [
  {
    id: "a",
    status: "open",
    channel: "whatsapp",
    assignee_type: "user",
    unread_count: 2,
    contact: { full_name: "Maria Rossi", phones: ["+393331234567"], emails: ["maria@example.it"] },
  },
  {
    id: "b",
    status: "open",
    channel: "mail",
    assignee_type: "automation",
    unread_count: 0,
    contact: { full_name: "Nicolò Verdi", phones: [], emails: ["nico@studio.it"] },
  },
  {
    id: "c",
    status: "closed",
    channel: "whatsapp",
    assignee_type: "user",
    unread_count: 0,
    contact: null,
  },
];
const ids = (filter: Parameters<typeof filterConversations>[1]) =>
  filterConversations(rows, filter).map((row) => row.id);

describe("inbox filters", () => {
  it("parses the search params and falls back to the defaults", () => {
    expect(parseInboxFilter({})).toEqual({ view: "tutte", channel: null, search: "" });
    expect(parseInboxFilter({ vista: "da-gestire", canale: "mail", q: " rossi " })).toEqual({
      view: "da-gestire",
      channel: "mail",
      search: "rossi",
    });
    expect(parseInboxFilter({ vista: "x", canale: "fax" })).toEqual({
      view: "tutte",
      channel: null,
      search: "",
    });
    expect(inboxFilterParams({ view: "tutte", channel: null, search: "" })).toEqual({
      vista: null,
      canale: null,
      q: null,
    });
  });
  it("filters by view", () => {
    const base = { channel: null, search: "" };
    expect(ids({ ...base, view: "tutte" })).toEqual(["a", "b", "c"]);
    expect(ids({ ...base, view: "da-gestire" })).toEqual(["a"]);
    expect(ids({ ...base, view: "automatiche" })).toEqual(["b"]);
    expect(ids({ ...base, view: "non-lette" })).toEqual(["a"]);
    expect(ids({ ...base, view: "chiuse" })).toEqual(["c"]);
  });
  it("filters by channel and by search together", () => {
    expect(ids({ view: "tutte", channel: "whatsapp", search: "" })).toEqual(["a", "c"]);
    expect(ids({ view: "tutte", channel: "whatsapp", search: "maria" })).toEqual(["a"]);
    expect(ids({ view: "tutte", channel: "mail", search: "maria" })).toEqual([]);
  });
  it("searches name without accents, part of a phone, part of a mail", () => {
    expect(matchesSearch(rows[1]!.contact, "nicolo")).toBe(true);
    expect(matchesSearch(rows[0]!.contact, "333 123")).toBe(true);
    expect(matchesSearch(rows[0]!.contact, "+39 333")).toBe(true);
    expect(matchesSearch(rows[0]!.contact, "999")).toBe(false);
    expect(matchesSearch(rows[1]!.contact, "studio.it")).toBe(true);
    expect(matchesSearch(null, "x")).toBe(false);
    expect(matchesSearch(null, "")).toBe(true);
  });
  it("counts each view", () => {
    expect(inboxCounts(rows)).toEqual({
      tutte: 3,
      "da-gestire": 1,
      automatiche: 1,
      "non-lette": 1,
      chiuse: 1,
    });
    expect(inboxCounts([]).tutte).toBe(0);
  });
  it("builds a one-line preview", () => {
    expect(messagePreview("Buongiorno,\n\nvorrei   un preventivo")).toBe("Buongiorno, vorrei un preventivo");
    expect(messagePreview("x".repeat(200), 20)).toHaveLength(20);
    expect(messagePreview(null)).toBe("");
  });
});

describe("message templates", () => {
  it("finds the placeholders", () => {
    expect(placeholderIndexes("Ciao {{1}}, ci vediamo {{ 2 }}. A presto {{1}}")).toEqual([1, 2]);
    expect(placeholderIndexes("Oggetto {{3}}", "Testo {{1}}")).toEqual([1, 3]);
    expect(placeholderIndexes("Nessuno {{nome}} {{0}}")).toEqual([]);
    expect(variableCount("a {{1}} b {{3}}")).toBe(3);
    expect(variableCount("")).toBe(0);
    expect(missingPlaceholders("a {{1}} b {{3}}")).toEqual([2]);
    expect(missingPlaceholders("a {{1}} b {{2}}")).toEqual([]);
  });
  it("renders a preview and keeps what is not filled in", () => {
    expect(renderTemplate("Ciao {{1}}, a {{2}}", ["Maria", "martedì"])).toBe("Ciao Maria, a martedì");
    expect(renderTemplate("Ciao {{1}}, a {{2}}", ["Maria"])).toBe("Ciao Maria, a {{2}}");
    expect(renderTemplate("Ciao {{1}}", ["  "])).toBe("Ciao {{1}}");
    expect(renderTemplate(null, [])).toBe("");
    expect(renderTemplate("Ciao {{1}}", sampleVariables(1))).toBe("Ciao Maria Rossi");
    expect(sampleVariables(7)).toHaveLength(7);
  });
  it("requires every variable before sending", () => {
    expect(checkVariables("Ciao {{1}} {{2}}", ["a", ""])).toBe("Compila il valore 2 del modello.");
    expect(checkVariables("Ciao {{1}} {{2}}", ["a", "b"])).toBeNull();
    expect(checkVariables("Ciao", [])).toBeNull();
  });
});

describe("safeInternalLink", () => {
  it("follows only in-app paths", () => {
    expect(safeInternalLink("/app/inbox/123?vista=tutte")).toBe("/app/inbox/123?vista=tutte");
    expect(safeInternalLink("https://evil.example")).toBeNull();
    expect(safeInternalLink("//evil.example")).toBeNull();
    expect(safeInternalLink("/\\evil")).toBeNull();
    expect(safeInternalLink("javascript:alert(1)")).toBeNull();
    expect(safeInternalLink(null)).toBeNull();
  });
});
