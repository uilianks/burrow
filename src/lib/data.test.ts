import { describe, expect, it } from "vitest";
import { BLOCK_KINDS } from "./blockKinds";
import { addRow, copyPage, createPage, dailyPage, importBlocks, importRows, insertBlock, insertKind, purgePages, removeBlocks, restorePage, trashPage } from "./commands";
import { parseCsv, toCsv } from "./csv";
import { formulaError, groupRows, queryRows, toTable, valueOf, TITLE, type Property } from "./database";
import { evaluate } from "./formula";
import { toMarkdown } from "./markdown";
import { backlinks, pageLinks, search } from "./search";
import { restoreOps, subtree } from "./snapshot";
import { ROOT, Store, type Block } from "./store";
import { backup, pageMarkdown, readBackup } from "./transfer";
import { childPages, visibleRows } from "./tree";

const kind = (key: string) => BLOCK_KINDS.find((k) => k.key === key)!;

async function workspace() {
  const store = new Store();
  await store.load(() => [
    { id: ROOT, type: "page", text: "", parent: null, content: ["p"] },
    { id: "p", type: "page", text: "Projects", parent: ROOT, content: [] },
  ]);
  return store;
}

describe("formula", () => {
  const props: Record<string, string | number | boolean> = { Qty: 12, Price: 2.5, Name: "Apples", Done: true, Blank: "" };
  const run = (source: string) => evaluate(source, (name) => props[name]);

  it("does arithmetic with the usual precedence", () => {
    expect(run("1 + 2 * 3")).toEqual({ value: 7 });
    expect(run("(1 + 2) * -3")).toEqual({ value: -9 });
    expect(run('round(prop("Qty") * prop("Price") / 7, 2)')).toEqual({ value: 4.29 });
  });

  it("works with text, comparisons and conditions", () => {
    expect(run('prop("Name") + " x" + prop("Qty")')).toEqual({ value: "Apples x12" });
    expect(run('if(prop("Qty") >= 10, "bulk", "single")')).toEqual({ value: "bulk" });
    expect(run('if(and(prop("Done"), not(empty(prop("Name")))), upper(prop("Name")), "")')).toEqual({ value: "APPLES" });
    expect(run('"b" > "a"')).toEqual({ value: true });
  });

  it("explains what is wrong instead of throwing", () => {
    expect(run('prop("Missing")')).toEqual({ error: 'There is no property called "Missing"' });
    expect(run("1 +")).toEqual({ error: "The formula is incomplete" });
    expect(run("nope(1)")).toEqual({ error: 'There is no function called "nope"' });
    expect(run('prop("Name") * 2')).toEqual({ error: '"Apples" is not a number' });
    expect(run("1 / 0")).toEqual({ error: "The result is not a number" });
    expect(run("1 $ 2")).toEqual({ error: 'Unexpected "$"' });
    expect(run('prop("Blank") + 1')).toEqual({ value: "1" });
  });
});

describe("database", () => {
  const schema: Property[] = [
    { id: "status", name: "Status", type: "select", options: ["To do", "Done"] },
    { id: "qty", name: "Qty", type: "number" },
    { id: "tags", name: "Tags", type: "multiSelect", options: ["a", "b"] },
    { id: "done", name: "Finished", type: "checkbox" },
    { id: "total", name: "Total", type: "formula", formula: 'prop("Qty") * 2' },
    { id: "label", name: "Label", type: "formula", formula: 'prop("Name") + ": " + prop("Total")' },
  ];
  const row = (id: string, text: string, props: Block["props"]): Block => ({ id, type: "page", text, parent: "db", content: [], props });
  const rows = [
    row("r1", "Pears", { status: "Done", qty: 5, tags: ["a", "b"], done: true }),
    row("r2", "Apples", { status: "To do", qty: 20, tags: ["b"] }),
    row("r3", "Kiwis", { qty: 3 }),
    row("r4", "Limes", { status: "Gone" }),
  ];
  const names = (list: Block[]) => list.map((r) => r.text);

  it("computes formulas, including ones built on other formulas", () => {
    expect(valueOf(rows[0], schema[4], schema)).toBe(10);
    expect(valueOf(rows[0], schema[5], schema)).toBe("Pears: 10");
    // a row with no quantity counts as zero rather than failing
    expect(valueOf(rows[3], schema[4], schema)).toBe(0);
    const loop: Property[] = [{ id: "x", name: "X", type: "formula", formula: 'prop("X")' }];
    expect(valueOf(rows[0], loop[0], loop)).toBe("#ERROR");
    expect(formulaError(loop[0], loop)).toBe("This formula refers back to itself");
    expect(formulaError({ ...schema[4], formula: 'prop("Name") * 2' }, schema, rows[0])).toBe('"Pears" is not a number');
    expect(formulaError({ ...schema[4], formula: 'prop("Qty") *' }, schema)).toBe("The formula is incomplete");
    expect(formulaError(schema[5], schema)).toBeNull();
  });

  it("filters", () => {
    const where = (property: string, op: Parameters<typeof queryRows>[2]["filters"] extends (infer F)[] | undefined ? F extends { op: infer O } ? O : never : never, value?: string) =>
      names(queryRows(rows, schema, { filters: [{ property, op, value }] }));
    expect(where(TITLE, "contains", "pp")).toEqual(["Apples"]);
    expect(where("status", "is", "done")).toEqual(["Pears"]);
    expect(where("status", "isNot", "Done")).toEqual(["Apples", "Kiwis", "Limes"]);
    expect(where("tags", "is", "a")).toEqual(["Pears"]);
    expect(where("qty", "gt", "4")).toEqual(["Pears", "Apples"]);
    expect(where("qty", "lt", "10")).toEqual(["Pears", "Kiwis"]);
    expect(where("status", "empty")).toEqual(["Kiwis"]);
    expect(where("done", "checked")).toEqual(["Pears"]);
    expect(where("done", "unchecked")).toHaveLength(3);
    expect(where("total", "gt", "8")).toEqual(["Pears", "Apples"]);
    expect(where("qty", "gt", "")).toHaveLength(4);
    expect(where("deleted-property", "is", "x")).toHaveLength(4);
  });

  it("sorts numbers as numbers, with empty values last either way", () => {
    expect(names(queryRows(rows, schema, { sorts: [{ property: "qty" }] }))).toEqual(["Kiwis", "Pears", "Apples", "Limes"]);
    expect(names(queryRows(rows, schema, { sorts: [{ property: "qty", descending: true }] }))).toEqual(["Apples", "Pears", "Kiwis", "Limes"]);
    expect(names(queryRows(rows, schema, { sorts: [{ property: TITLE }] }))).toEqual(["Apples", "Kiwis", "Limes", "Pears"]);
  });

  it("groups by option, keeping unknown values with the unset ones", () => {
    const groups = groupRows(rows, schema[0]);
    expect(groups.map((g) => [g.key, names(g.rows)])).toEqual([["", ["Kiwis", "Limes"]], ["To do", ["Apples"]], ["Done", ["Pears"]]]);
  });

  it("goes out to CSV and comes back in", async () => {
    const table = toTable(rows.slice(0, 2), schema.slice(0, 4));
    expect(table).toEqual([["Name", "Status", "Qty", "Tags", "Finished"], ["Pears", "Done", "5", "a, b", "✓"], ["Apples", "To do", "20", "b", ""]]);
    const csv = toCsv(table);
    expect(csv.split("\n")[1]).toBe('Pears,Done,5,"a, b",✓');
    expect(parseCsv(csv)).toEqual(table);
    expect(parseCsv('a,"line\nbreak, ""quoted"""\r\n\r\nb,')).toEqual([["a", 'line\nbreak, "quoted"'], ["b", ""]]);

    const store = await workspace();
    const db = insertKind(store, "p", null, kind("database"));
    const before = store.getSnapshot()[db].schema!;
    importRows(store, db, [["Status", "Name", "Notes"], ["Done", "From CSV", "hello"], ["", "Second", ""]]);
    const after = store.getSnapshot()[db];
    expect(after.schema!.map((p) => p.name)).toEqual([...before.map((p) => p.name), "Notes"]);
    const [first, second] = after.content.map((id) => store.getSnapshot()[id]);
    expect(first).toMatchObject({ type: "page", text: "From CSV", props: { [before[0].id]: "Done", [after.schema![2].id]: "hello" } });
    expect(second.props).toEqual({});
    store.undo();
    expect(store.getSnapshot()[db].content).toEqual([]);
  });

  it("keeps rows out of the sidebar and the page's own blocks, and exports as a table", async () => {
    const store = await workspace();
    const db = insertKind(store, "p", null, kind("database"));
    addRow(store, db, {}, "Row one");
    expect(childPages(store.getSnapshot(), "p")).toEqual([]);
    expect(visibleRows(store.getSnapshot(), "p").map((r) => r.id)).toEqual([db]);
    expect(toMarkdown(store.getSnapshot(), [db])).toBe("**Untitled database**\n| Name | Status | Date |\n| --- | --- | --- |\n| Row one |  |  |");
  });
});

describe("trash", () => {
  it("hides a page everywhere until it is restored", async () => {
    const store = await workspace();
    const sub = createPage(store, "p");
    store.commit([{ op: "update", id: sub, patch: { text: "Secret plan" } }]);
    removeBlocks(store, [sub, insertBlock(store, "p", null, "text", "gone for good")]);
    expect(store.getSnapshot()[sub].trashed).toBeGreaterThan(0);
    expect(childPages(store.getSnapshot(), "p")).toEqual([]);
    expect(visibleRows(store.getSnapshot(), "p")).toEqual([]);
    expect(search(store.getSnapshot(), "secret")).toEqual([]);
    restorePage(store, sub);
    expect(childPages(store.getSnapshot(), "p")).toEqual([sub]);
    expect(search(store.getSnapshot(), "secret")).toEqual([{ page: sub, title: "Secret plan" }]);
  });

  it("purging removes the page and only the files and synced content nothing else uses", async () => {
    const store = await workspace();
    const doomed = createPage(store, "p");
    store.commit([{ op: "update", id: doomed, patch: { cover: "cover-file" } }]);
    insertBlock(store, "p", null, "image");
    store.commit([{ op: "update", id: store.getSnapshot().p.content[0], patch: { fileId: "kept-file" } }]);
    const synced = insertKind(store, doomed, null, kind("synced"));
    const shared = store.getSnapshot()[synced].source!;
    const deleted: string[] = [];
    const files = { put: async () => "", get: async () => undefined, keys: async () => ["cover-file", "kept-file", "stray"], delete: async (id: string) => void deleted.push(id) };
    trashPage(store, doomed);
    await purgePages(store, files, [doomed]);
    expect(store.getSnapshot()[doomed]).toBeUndefined();
    expect(store.getSnapshot()[shared]).toBeUndefined();
    expect(deleted.sort()).toEqual(["cover-file", "stray"]);
    store.undo();
    expect(store.getSnapshot()[doomed]).toBeUndefined();
  });
});

describe("search and links", () => {
  it("finds titles first, then text, and knows who links where", async () => {
    const store = await workspace();
    const other = createPage(store);
    store.commit([{ op: "update", id: other, patch: { text: "Meeting notes" } }]);
    insertBlock(store, "p", null, "text", `Agenda for the <b>meeting</b>, see <a href="#${other}">Meeting notes</a>`);
    const results = search(store.getSnapshot(), "MEETING");
    expect(results.map((r) => [r.page, !!r.block])).toEqual([[other, false], ["p", true]]);
    expect(results[1].snippet).toContain("Agenda for the meeting");
    expect(backlinks(store.getSnapshot(), other)).toEqual(["p"]);
    expect(backlinks(store.getSnapshot(), "p")).toEqual([]);
    expect(pageLinks(store.getSnapshot())).toContainEqual({ from: "p", to: other, kind: "mention" });
    const sub = createPage(store, "p");
    expect(pageLinks(store.getSnapshot())).toContainEqual({ from: "p", to: sub, kind: "child" });
  });
});

describe("versions", () => {
  it("restores a page's blocks without losing pages added since", async () => {
    const store = await workspace();
    const a = insertBlock(store, "p", null, "toggle", "keep me");
    const inner = insertBlock(store, a, null, "text", "inner");
    const saved = subtree(store.getSnapshot(), "p");
    expect(saved.map((b) => b.id)).toEqual(["p", a, inner]);
    const then = store.getSnapshot();

    store.commit([{ op: "update", id: a, patch: { text: "changed" } }]);
    store.commit([{ op: "set", id: inner, value: null }, { op: "remove", parent: a, id: inner }]);
    const added = insertBlock(store, "p", a, "text", "added later");
    const insideToggle = createPage(store, a);
    const insideAdded = createPage(store, added);

    store.commit(restoreOps(store.getSnapshot(), "p", saved));
    const now = store.getSnapshot();
    expect(now[a].text).toBe("keep me");
    expect(now[inner]).toEqual(then[inner]);
    expect(now[added]).toBeUndefined();
    expect(now[a].content).toEqual([inner, insideToggle]);
    expect(now.p.content).toEqual([a, insideAdded]);
    expect(now[insideAdded].parent).toBe("p");
    expect(now.p.parent).toBe(ROOT);
    store.undo();
    expect(store.getSnapshot()[added].text).toBe("added later");
  });
});

describe("templates, daily notes and backup", () => {
  it("copies a template page with its sub-pages", async () => {
    const store = await workspace();
    store.commit([{ op: "update", id: "p", patch: { template: true, favorite: true } }]);
    const line = insertBlock(store, "p", null, "todo", "step one");
    const sub = createPage(store, "p");
    const copy = copyPage(store, "p");
    const records = store.getSnapshot();
    expect(records[ROOT].content).toEqual(["p", copy]);
    expect(records[copy]).toMatchObject({ text: "Projects", template: undefined, favorite: undefined });
    const [copiedLine, copiedSub] = records[copy].content;
    expect(copiedLine).not.toBe(line);
    expect(records[copiedLine]).toMatchObject({ text: "step one", parent: copy });
    expect(records[copiedSub].type).toBe("page");
    expect(copiedSub).not.toBe(sub);
    expect(records[records[copiedSub].content[0]].parent).toBe(copiedSub);
  });

  it("makes one daily note per day", async () => {
    const store = await workspace();
    const monday = dailyPage(store, "2026-10-12");
    expect(dailyPage(store, "2026-10-12")).toBe(monday);
    const tuesday = dailyPage(store, "2026-10-13");
    const index = store.getSnapshot()[monday].parent!;
    expect(store.getSnapshot()[index]).toMatchObject({ text: "Daily notes", daily: "index" });
    // newest first, above the empty line every new page starts with
    expect(store.getSnapshot()[index].content.slice(0, 2)).toEqual([tuesday, monday]);
    trashPage(store, monday);
    expect(dailyPage(store, "2026-10-12")).not.toBe(monday);
  });

  it("exports a page and brings a backup back in beside what is there", async () => {
    const store = await workspace();
    const sub = createPage(store, "p");
    insertBlock(store, "p", null, "text", `see <a href="#${sub}">sub</a>`);
    expect(pageMarkdown(store.getSnapshot(), "p")).toBe(`# Projects\n\nsee [sub](#${sub})\n[Untitled](#${sub})\n`);

    const { blocks, top } = readBackup(backup(store.getSnapshot()));
    expect(top).toHaveLength(1);
    expect(blocks.some((b) => b.id === "p" || b.id === sub)).toBe(false);
    const home = importBlocks(store, "Imported", blocks, top);
    const records = store.getSnapshot();
    expect(records[ROOT].content).toEqual(["p", home]);
    const imported = records[records[home].content[0]];
    expect(imported).toMatchObject({ text: "Projects", parent: home });
    const [text, importedSub] = imported.content.map((id) => records[id]);
    expect(importedSub.type).toBe("page");
    expect(text.text).toBe(`see <a href="#${importedSub.id}">sub</a>`);
    expect(() => readBackup('{"blocks":[]}')).toThrow("not a Burrow backup");
  });
});
