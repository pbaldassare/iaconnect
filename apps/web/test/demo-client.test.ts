import { describe, expect, it } from "vitest";
import { errorMessage, failFromError } from "../src/lib/action";
import {
  DEMO_READ_ONLY,
  DEMO_READ_ONLY_MESSAGE,
  type DemoTables,
  createDemoClient,
  isDemoClient,
  isDemoReadOnly,
  parseOrFilter,
} from "../src/lib/demo/client";

/** Small table with every kind of value the operators meet. Typed loosely on purpose. */
const rows = [
  {
    id: "a",
    name: "Marta Bellandi",
    n: 3,
    at: "2026-10-01T10:00:00.000Z",
    done: true,
    tags: ["x", "y"],
    meta: { k: "v", deep: { a: 1 } },
    parent: null,
  },
  {
    id: "b",
    name: "Luca Ferrarini",
    n: 10,
    at: "2026-10-02T10:00:00.000Z",
    done: false,
    tags: ["y"],
    meta: { k: "w" },
    parent: "a",
  },
  { id: "c", name: "elena sorrentini", n: 7, at: null, done: false, tags: [], meta: {}, parent: "a" },
  {
    id: "d",
    name: "50% di sconto_",
    n: 1,
    at: "2026-09-30T10:00:00.000Z",
    done: true,
    tags: ["+393330000001"],
    meta: null,
    parent: null,
  },
];
const client = createDemoClient({ contacts: rows } as unknown as DemoTables, {
  quota_left: (args) => (args.p_metric === "messages" ? 790 : null),
});
const from = () => client.from("contacts");
const ids = (result: { data: unknown }) => (result.data as { id: string }[]).map((row) => row.id);

describe("demo client: filters", () => {
  it("eq / neq follow SQL: NULL never matches", async () => {
    expect(ids(await from().select("*").eq("parent", "a"))).toEqual(["b", "c"]);
    expect(ids(await from().select("*").neq("parent", "a"))).toEqual([]);
    expect(ids(await from().select("*").eq("done", true))).toEqual(["a", "d"]);
    expect(ids(await from().select("*").eq("n", "10"))).toEqual(["b"]);
  });
  it("in", async () => {
    expect(ids(await from().select("*").in("id", ["a", "c", "zzz"]))).toEqual(["a", "c"]);
    expect(ids(await from().select("*").in("id", []))).toEqual([]);
  });
  it("is null / true / false and not is null", async () => {
    expect(ids(await from().select("*").is("at", null))).toEqual(["c"]);
    expect(ids(await from().select("*").is("done", false))).toEqual(["b", "c"]);
    expect(ids(await from().select("*").not("parent", "is", null))).toEqual(["b", "c"]);
    expect(ids(await from().select("*").not("id", "in", "(a,b)"))).toEqual(["c", "d"]);
  });
  it("gt / gte / lt / lte on numbers and ISO dates, NULL excluded", async () => {
    expect(ids(await from().select("*").gt("n", 3))).toEqual(["b", "c"]);
    expect(ids(await from().select("*").gte("n", 3))).toEqual(["a", "b", "c"]);
    expect(ids(await from().select("*").lt("n", 3))).toEqual(["d"]);
    expect(ids(await from().select("*").lte("n", 3))).toEqual(["a", "d"]);
    expect(
      ids(
        await from().select("*").gte("at", "2026-10-01T00:00:00.000Z").lt("at", "2026-10-02T00:00:00.000Z"),
      ),
    ).toEqual(["a"]);
  });
  it("like / ilike with wildcards and escapes", async () => {
    expect(ids(await from().select("*").ilike("name", "%SORRENT%"))).toEqual(["c"]);
    expect(ids(await from().select("*").like("name", "%Sorrent%"))).toEqual([]);
    expect(ids(await from().select("*").ilike("name", "luca%"))).toEqual(["b"]);
    expect(ids(await from().select("*").ilike("name", "50\\% di sconto\\_"))).toEqual(["d"]);
    expect(ids(await from().select("*").ilike("name", "_arta%"))).toEqual(["a"]);
  });
  it("contains on arrays and JSON objects, overlaps on arrays", async () => {
    expect(ids(await from().select("*").contains("tags", ["y"]))).toEqual(["a", "b"]);
    expect(ids(await from().select("*").contains("tags", ["x", "y"]))).toEqual(["a"]);
    expect(ids(await from().select("*").contains("meta", { k: "v" }))).toEqual(["a"]);
    expect(
      ids(
        await from()
          .select("*")
          .contains("meta", { deep: { a: 1 } }),
      ),
    ).toEqual(["a"]);
    expect(ids(await from().select("*").overlaps("tags", ["x", "zzz"]))).toEqual(["a"]);
  });
  it("or() in the forms the pages use", async () => {
    expect(ids(await from().select("*").or("done.eq.true,parent.eq.a"))).toEqual(["a", "b", "c", "d"]);
    expect(ids(await from().select("*").or('name.ilike."%ferrar%",tags.cs.{+393330000001}'))).toEqual([
      "b",
      "d",
    ]);
    expect(ids(await from().select("*").or('name.ilike."%zzz%",tags.cs.{"x"}'))).toEqual(["a"]);
    expect(ids(await from().select("*").or("at.is.null,and(n.gt.5,done.eq.false)"))).toEqual(["b", "c"]);
    // A comma inside quotes does not split the condition.
    expect(parseOrFilter('name.ilike."%a,b%"')({ name: "xa,by" })).toBe(true);
    expect(() => parseOrFilter("nonsense")).toThrow();
  });
  it("filters combine with AND", async () => {
    expect(ids(await from().select("*").eq("parent", "a").eq("done", false).gt("n", 8))).toEqual(["b"]);
  });
});

describe("demo client: order, limit, range, count", () => {
  it("orders ascending and descending with the Postgres NULL defaults", async () => {
    expect(ids(await from().select("*").order("n"))).toEqual(["d", "a", "c", "b"]);
    expect(ids(await from().select("*").order("n", { ascending: false }))).toEqual(["b", "c", "a", "d"]);
    expect(ids(await from().select("*").order("at"))).toEqual(["d", "a", "b", "c"]);
    expect(ids(await from().select("*").order("at", { ascending: false }))).toEqual(["c", "b", "a", "d"]);
    expect(ids(await from().select("*").order("at", { ascending: false, nullsFirst: false }))).toEqual([
      "b",
      "a",
      "d",
      "c",
    ]);
    expect(ids(await from().select("*").order("done").order("n", { ascending: false }))).toEqual([
      "b",
      "c",
      "a",
      "d",
    ]);
  });
  it("limit and range slice after ordering; count is the total before slicing", async () => {
    expect(ids(await from().select("*").order("n").limit(2))).toEqual(["d", "a"]);
    const page = await from().select("id", { count: "exact" }).order("n").range(1, 2);
    expect(ids(page)).toEqual(["a", "c"]);
    expect(page.count).toBe(4);
    const filtered = await from().select("id", { count: "exact" }).eq("done", true).range(0, 0);
    expect(filtered.count).toBe(2);
    expect(ids(filtered)).toHaveLength(1);
    expect((await from().select("id").order("n")).count).toBeNull();
  });
  it("head returns only the count", async () => {
    const result = await from().select("id", { count: "exact", head: true }).is("at", null);
    expect(result).toMatchObject({ data: null, error: null, count: 1 });
  });
  it("a range past the end is an error when a count is asked, as in PostgREST", async () => {
    const result = await from().select("id", { count: "exact" }).range(50, 59);
    expect(result.error?.code).toBe("PGRST103");
    expect((await from().select("id").range(50, 59)).data).toEqual([]);
  });
});

describe("demo client: columns, single, maybeSingle", () => {
  it("returns only the requested columns", async () => {
    const { data } = await from().select("id, name").eq("id", "a");
    expect(data).toEqual([{ id: "a", name: "Marta Bellandi" }]);
    const all = await from().select("*").eq("id", "a").single();
    expect(Object.keys(all.data as object)).toEqual(Object.keys(rows[0]!));
    expect((await from().select().eq("id", "a").single()).data).toMatchObject({ n: 3 });
  });
  it("supports an alias", async () => {
    expect((await from().select("key:id").eq("id", "b")).data).toEqual([{ key: "b" }]);
  });
  it("single: exactly one row, otherwise PGRST116", async () => {
    expect((await from().select("id").eq("id", "a").single()).data).toEqual({ id: "a" });
    expect((await from().select("id").eq("id", "zzz").single()).error?.code).toBe("PGRST116");
    expect((await from().select("id").single()).error?.code).toBe("PGRST116");
  });
  it("maybeSingle: null for no row, error for several", async () => {
    expect(await from().select("id").eq("id", "zzz").maybeSingle()).toMatchObject({
      data: null,
      error: null,
    });
    expect((await from().select("id").eq("id", "b").maybeSingle()).data).toEqual({ id: "b" });
    expect((await from().select("id").maybeSingle()).error?.code).toBe("PGRST116");
    expect((await from().select("id").order("n").limit(1).maybeSingle()).data).toEqual({ id: "d" });
  });
  it("hands out copies: a page cannot change the fixtures", async () => {
    const first = await from().select("*").eq("id", "a").single();
    (first.data as { name: string; tags: string[] }).name = "changed";
    (first.data as { tags: string[] }).tags.push("z");
    const second = await from().select("*").eq("id", "a").single();
    expect(second.data).toMatchObject({ name: "Marta Bellandi", tags: ["x", "y"] });
  });
  it("an unknown table reads as empty", async () => {
    expect(await client.from("nope").select("*")).toMatchObject({ data: [], error: null });
  });
});

describe("demo client: writes are refused", () => {
  const refused = { data: null, error: { code: DEMO_READ_ONLY } };
  it("insert, update, upsert, delete change nothing and return the code", async () => {
    expect(await from().insert({ id: "z" })).toMatchObject(refused);
    expect(await from().insert({ id: "z" }).select("id").single()).toMatchObject(refused);
    expect(await from().update({ name: "x" }).eq("id", "a")).toMatchObject(refused);
    expect(await from().update({ name: "x" }).eq("id", "a").select("id")).toMatchObject(refused);
    expect(await from().upsert({ id: "a" }, { onConflict: "id" }).select("id").single()).toMatchObject(
      refused,
    );
    expect(await from().delete().eq("id", "a")).toMatchObject(refused);
    const { data, count } = await from().select("*", { count: "exact" });
    expect(count).toBe(4);
    expect(data).toEqual(rows);
  });
  it("rpc: listed functions answer, every other one is a refused write", async () => {
    expect(await client.rpc("quota_left", { p_org: "o", p_metric: "messages" })).toMatchObject({
      data: 790,
      error: null,
    });
    expect((await client.rpc("quota_left", { p_metric: "other" })).data).toBeNull();
    for (const name of [
      "log_action",
      "add_usage",
      "save_connection",
      "store_connection_secret",
      "toString",
    ]) {
      expect(await client.rpc(name, {})).toMatchObject(refused);
    }
  });
  it("the shared error mapping turns the code into the Italian message", () => {
    const error = { code: DEMO_READ_ONLY, message: "whatever" };
    expect(isDemoReadOnly(error)).toBe(true);
    expect(errorMessage(error)).toBe(DEMO_READ_ONLY_MESSAGE);
    expect(failFromError(error)).toEqual({ ok: false, message: DEMO_READ_ONLY_MESSAGE });
    expect(DEMO_READ_ONLY_MESSAGE).toBe(
      "Questa è una demo: le modifiche sono disattivate. Registrati per provarlo con i tuoi dati.",
    );
  });
  it("is recognisable", () => {
    expect(isDemoClient(client)).toBe(true);
    expect(isDemoClient({})).toBe(false);
    expect(isDemoClient(null)).toBe(false);
  });
});
