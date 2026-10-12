import { describe, expect, it } from "vitest";
import { BLOCK_KINDS } from "./blockKinds";
import { dueCards, review } from "./cards";
import { addRow, createPage, insertBlock, insertKind, insertLinkedDatabase, makeColumns, stampTemplate } from "./commands";
import { chartData, groupByValue, queryRows, toTable, valueOf, TITLE, type Property } from "./database";
import { pageHtml } from "./html";
import { dueReminders, liveMentions } from "./search";
import { ROOT, Store } from "./store";

const kind = (key: string) => BLOCK_KINDS.find((k) => k.key === key)!;
async function workspace() {
  const store = new Store();
  await store.load(() => [
    { id: ROOT, type: "page", text: "", parent: null, content: ["p"] },
    { id: "p", type: "page", text: "Home", parent: ROOT, content: [] },
  ]);
  return store;
}

describe("relations and rollups", () => {
  it("links rows across databases and summarises what they link to", async () => {
    const store = await workspace();
    const items = insertKind(store, "p", null, kind("database"));
    const orders = insertKind(store, "p", items, kind("database"));
    const price: Property = { id: "price", name: "Price", type: "number" };
    store.commit([{ op: "update", id: items, patch: { schema: [price] } }]);
    const apple = addRow(store, items, { price: 2 }, "Apple");
    const pear = addRow(store, items, { price: 3.5 }, "Pear");
    const gone = addRow(store, items, { price: 100 }, "Deleted");
    store.commit([{ op: "update", id: gone, patch: { trashed: 1 } }]);

    const schema: Property[] = [
      { id: "items", name: "Items", type: "relation", database: items },
      { id: "count", name: "How many", type: "rollup", relation: "items" },
      { id: "total", name: "Total", type: "rollup", relation: "items", target: "price", aggregate: "sum" },
      { id: "dearest", name: "Dearest", type: "rollup", relation: "items", target: "price", aggregate: "max" },
      { id: "names", name: "Names", type: "rollup", relation: "items", target: TITLE, aggregate: "list" },
      { id: "withTax", name: "With tax", type: "formula", formula: 'prop("Total") * 2' },
    ];
    store.commit([{ op: "update", id: orders, patch: { schema } }]);
    const full = addRow(store, orders, { items: [apple, pear, gone, "not-a-row"] }, "Order 1");
    const empty = addRow(store, orders, {}, "Order 2");
    const records = store.getSnapshot();
    const value = (row: string, property: number) => valueOf(records[row], schema[property], schema, records);

    expect(value(full, 0)).toEqual(["Apple", "Pear"]);
    expect([value(full, 1), value(full, 2), value(full, 3), value(full, 4), value(full, 5)]).toEqual([2, 5.5, 3.5, ["Apple", "Pear"], 11]);
    expect([value(empty, 1), value(empty, 2), value(empty, 4)]).toEqual([0, undefined, []]);
    const rows = [records[full], records[empty]];
    expect(queryRows(rows, schema, { filters: [{ property: "items", op: "is", value: "pear" }] }, records).map((r) => r.text)).toEqual(["Order 1"]);
    expect(queryRows(rows, schema, { sorts: [{ property: "count" }] }, records).map((r) => r.text)).toEqual(["Order 2", "Order 1"]);
    expect(toTable(rows, schema, records)[1]).toEqual(["Order 1", "Apple, Pear", "2", "5.5", "3.5", "Apple, Pear", "11"]);
  });

  it("groups by any property and totals a chart", async () => {
    const store = await workspace();
    const db = insertKind(store, "p", null, kind("database"));
    const schema: Property[] = [
      { id: "status", name: "Status", type: "select", options: ["To do", "Done"] },
      { id: "qty", name: "Qty", type: "number" },
      { id: "who", name: "Who", type: "text" },
    ];
    store.commit([{ op: "update", id: db, patch: { schema } }]);
    for (const [name, status, qty, who] of [["a", "Done", 2, "zed"], ["b", "Done", 3, "amy"], ["c", "To do", 10, "amy"], ["d", undefined, 1, undefined]] as const) {
      addRow(store, db, { status, qty, who }, name);
    }
    const records = store.getSnapshot();
    const rows = records[db].content.map((id) => records[id]);
    const keys = (property: Property) => groupByValue(rows, property, schema, records).map((g) => `${g.key}:${g.rows.map((r) => r.text).join("")}`);
    expect(keys(schema[0])).toEqual([":d", "To do:c", "Done:ab"]);
    expect(keys(schema[2])).toEqual([":d", "amy:bc", "zed:a"]);
    expect(chartData(rows, schema[0], undefined, schema, records)).toEqual([{ key: "", value: 1 }, { key: "To do", value: 1 }, { key: "Done", value: 2 }]);
    expect(chartData(rows, schema[2], schema[1], schema, records)).toEqual([{ key: "", value: 1 }, { key: "amy", value: 13 }, { key: "zed", value: 2 }]);
  });

  it("makes a linked view only of a real database", async () => {
    const store = await workspace();
    const db = insertKind(store, "p", null, kind("database"));
    const link = insertLinkedDatabase(store, "p", db, db)!;
    expect(store.getSnapshot()[link]).toMatchObject({ type: "linkedDatabase", source: db, content: [] });
    expect(store.getSnapshot()[link].views).toHaveLength(1);
    expect(insertLinkedDatabase(store, "p", null, "p")).toBeNull();
  });
});

describe("template buttons and columns", () => {
  it("stamps a copy of what is inside a button after it, every time", async () => {
    const store = await workspace();
    const button = insertBlock(store, "p", null, "button", "New task");
    const todo = insertBlock(store, button, null, "todo", "Task");
    insertBlock(store, todo, null, "text", "details");
    store.commit([{ op: "update", id: todo, patch: { comments: [{ at: 1, text: "note" }], remind: 5 } }]);
    const [first] = stampTemplate(store, button);
    const [second] = stampTemplate(store, button);
    const records = store.getSnapshot();
    expect(records.p.content).toEqual([button, second, first]);
    expect(records[first]).toMatchObject({ type: "todo", text: "Task", parent: "p" });
    expect(records[first].comments).toBeUndefined();
    expect(records[first].remind).toBeUndefined();
    expect(records[records[first].content[0]]).toMatchObject({ text: "details", parent: first });
    expect(records[button].content).toEqual([todo]);
    store.undo();
    expect(store.getSnapshot().p.content).toEqual([button, first]);
  });

  it("puts a block beside another, then adds a third column", async () => {
    const store = await workspace();
    const a = insertBlock(store, "p", null, "text", "a");
    const b = insertBlock(store, "p", a, "text", "b");
    const c = insertBlock(store, "p", b, "text", "c");
    makeColumns(store, a, [b]);
    let records = store.getSnapshot();
    const columns = records.p.content[0];
    expect(records.p.content).toEqual([columns, c]);
    expect(records[columns].content.map((column) => records[column].content)).toEqual([[a], [b]]);
    makeColumns(store, a, [c]);
    records = store.getSnapshot();
    expect(records.p.content).toEqual([columns]);
    expect(records[columns].content.map((column) => records[column].content)).toEqual([[a], [c], [b]]);
    // a block can't be put beside something inside itself
    const before = store.getSnapshot();
    makeColumns(store, a, [columns]);
    expect(store.getSnapshot()).toBe(before);
    store.undo();
    store.undo();
    expect(store.getSnapshot().p.content).toEqual([a, b, c]);
  });
});

describe("mentions, reminders, cards, web pages", () => {
  it("shows a mention with the page's current title", async () => {
    const store = await workspace();
    const other = createPage(store);
    store.commit([{ op: "update", id: other, patch: { text: "New <name> & co" } }]);
    const html = `see <a href="#${other}">Old name</a> and <a href="https://x.test">Old name</a> and <a href="#00000000-0000-0000-0000-000000000000">Gone</a>`;
    expect(liveMentions(html, store.getSnapshot())).toBe(
      `see <a href="#${other}">New  &amp; co</a> and <a href="https://x.test">Old name</a> and <a href="#00000000-0000-0000-0000-000000000000">Gone</a>`,
    );
  });

  it("finds reminders that are due and not yet announced", async () => {
    const store = await workspace();
    const due = insertBlock(store, "p", null, "todo", "call");
    const later = insertBlock(store, "p", null, "todo", "later");
    const told = insertBlock(store, "p", null, "todo", "told");
    store.commit([
      { op: "update", id: due, patch: { remind: 100 } },
      { op: "update", id: later, patch: { remind: 900 } },
      { op: "update", id: told, patch: { remind: 50, reminded: true } },
    ]);
    expect(dueReminders(store.getSnapshot(), 500).map((b) => b.text)).toEqual(["call"]);
  });

  it("schedules flashcards further out each time they are known", async () => {
    const DAY = 86400000;
    const good = review(undefined, "good", 0);
    expect(good).toEqual({ interval: 1, due: DAY });
    expect(review(good, "good", 0).interval).toBe(2);
    expect(review({ interval: 10, due: 0 }, "good", 0).interval).toBe(22);
    expect(review(undefined, "easy", 0).interval).toBe(4);
    expect(review({ interval: 10, due: 0 }, "again", 1000)).toEqual({ interval: 0, due: 601000 });

    const store = await workspace();
    const card = insertBlock(store, "p", null, "toggle", "Capital of Portugal?");
    insertBlock(store, card, null, "text", "Lisbon");
    insertBlock(store, "p", null, "toggle", "No answer yet");
    const done = insertBlock(store, "p", null, "toggle", "Known");
    insertBlock(store, done, null, "text", "yes");
    store.commit([{ op: "update", id: done, patch: { card: { interval: 5, due: 9999 } } }]);
    expect(dueCards(store.getSnapshot(), 1000).map((b) => b.text)).toEqual(["Capital of Portugal?"]);
    expect(dueCards(store.getSnapshot(), 10000).map((b) => b.text)).toEqual(["Capital of Portugal?", "Known"]);
  });

  it("exports a page as a web page", async () => {
    const store = await workspace();
    let after: string | null = null;
    const add = (type: Parameters<typeof insertBlock>[3], text: string) => (after = insertBlock(store, "p", after, type, text));
    add("h1", "Plan <b>B</b>");
    add("bullet", "one");
    add("bullet", "two");
    const todo = add("todo", "done");
    store.commit([{ op: "update", id: todo, patch: { checked: true } }]);
    const toggle = add("toggle", "more");
    insertBlock(store, toggle, null, "text", "hidden");
    add("code", "a &lt; b");
    const html = pageHtml(store.getSnapshot(), "p");
    expect(html).toContain("<title>Home</title>");
    expect(html).toContain("<h1>Home</h1>");
    expect(html).toContain("<h2>Plan <b>B</b></h2>\n<ul>\n<li>one</li>\n<li>two</li>\n</ul>\n<ul class=\"todo\">\n<li>☑ done</li>\n</ul>");
    expect(html).toContain("<details><summary>more</summary><p>hidden</p></details>");
    expect(html).toContain("<pre><code>a &lt; b</code></pre>");
    store.commit([{ op: "update", id: "p", patch: { text: "<script>x</script>" } }]);
    expect(pageHtml(store.getSnapshot(), "p")).not.toContain("<script>");
  });
});

import { addRow as addRowTo } from "./commands";
import { automationChanges, fileEntry } from "./database";
import { EMOJI, findEmoji } from "./emoji";
import { htmlToMarkdown, inlineToHtml } from "./markdown";

describe("row templates, sub-items, files and automations", () => {
  it("starts new rows as a copy of the template row", async () => {
    const store = await workspace();
    const db = insertKind(store, "p", null, kind("database"));
    const template = addRowTo(store, db, { a: "from template", b: "kept" }, "Template");
    const [line] = store.getSnapshot()[template].content;
    store.commit([
      { op: "update", id: line, patch: { type: "todo", text: "Checklist item" } },
      { op: "update", id: template, patch: { icon: "📌" } },
      { op: "update", id: db, patch: { rowTemplate: template } },
    ]);
    const row = addRowTo(store, db, { a: "mine" }, "New", template);
    const records = store.getSnapshot();
    expect(records[row]).toMatchObject({ text: "New", icon: "📌", props: { a: "mine", b: "kept" }, parentRow: template });
    const [copied] = records[row].content;
    expect(copied).not.toBe(line);
    expect(records[copied]).toMatchObject({ type: "todo", text: "Checklist item", parent: row });
    // a template that has been trashed is ignored
    store.commit([{ op: "update", id: template, patch: { trashed: 1 } }]);
    const plain = addRowTo(store, db);
    expect(store.getSnapshot()[plain].props).toEqual({});
    expect(store.getSnapshot()[store.getSnapshot()[plain].content[0]].type).toBe("text");
  });

  it("shows file properties by name", () => {
    const schema: Property[] = [{ id: "f", name: "Files", type: "files" }];
    const id = "11111111-2222-3333-4444-555555555555";
    const row = { id: "r", type: "page" as const, text: "", parent: "db", content: [], props: { f: [fileEntry(id, "report|final.pdf")] } };
    expect(valueOf(row, schema[0], schema)).toEqual(["report|final.pdf"]);
  });

  it("fires automations only for the matching change", () => {
    const database = {
      id: "db", type: "database" as const, text: "", parent: "p", content: [],
      schema: [
        { id: "status", name: "Status", type: "select" as const, options: ["To do", "Done"] },
        { id: "when", name: "Finished on", type: "date" as const },
        { id: "ok", name: "Closed", type: "checkbox" as const },
        { id: "n", name: "Points", type: "number" as const },
      ],
      automations: [
        { id: "1", when: { property: "status", value: "done" }, set: { property: "when", value: "@today" } },
        { id: "2", when: { property: "status", value: "Done" }, set: { property: "ok", value: "yes" } },
        { id: "3", when: { property: "status", value: "To do" }, set: { property: "n", value: "3" } },
        { id: "4", when: { property: "status", value: "Done" }, set: { property: "deleted", value: "x" } },
      ],
    };
    expect(automationChanges(database, "status", "Done", "2026-10-12")).toEqual({ when: "2026-10-12", ok: true });
    expect(automationChanges(database, "status", "To do", "2026-10-12")).toEqual({ n: 3 });
    expect(automationChanges(database, "n", "Done", "2026-10-12")).toEqual({});
  });
});

describe("inline math and emoji", () => {
  it("round-trips inline math through Markdown", () => {
    const html = inlineToHtml('area is $$\\pi r^2$$ and "q" is $$a"b$$');
    expect(html).toBe('area is <span data-math="\\pi r^2">\\pi r^2</span> and "q" is <span data-math="a&quot;b">a"b</span>');
    expect(htmlToMarkdown('x <span data-math="\\pi r^2">\\pi r^2</span> y')).toBe("x $$\\pi r^2$$ y");
    expect(inlineToHtml("costs $5 and $6")).toBe("costs $5 and $6");
  });

  it("has a few hundred emoji with unique names", () => {
    expect(EMOJI.length).toBeGreaterThan(350);
    expect(new Set(EMOJI.map((e) => e.name)).size).toBe(EMOJI.length);
    expect(EMOJI.every((e) => /^[a-z0-9_]+$/.test(e.name) && e.emoji)).toBe(true);
    expect(findEmoji("unicorn")[0].emoji).toBe("🦄");
  });
});

import { createTitledPage } from "./commands";
import { findPageByTitle, pageLinkHtml, parseWikiLink } from "./links";

describe("page links", () => {
  it("reads what was typed between the brackets", () => {
    expect(parseWikiLink("Getting started")).toEqual({ name: "Getting started", words: undefined });
    expect(parseWikiLink(" Plan | the plan | v2 ")).toEqual({ name: "Plan", words: "the plan | v2" });
    expect(parseWikiLink("Plan|")).toEqual({ name: "Plan", words: undefined });
  });

  it("finds pages by title whatever the capitals, skipping the trash", async () => {
    const store = await workspace();
    const made = createTitledPage(store, "R&D <notes>");
    expect(store.getSnapshot()[made].text).toBe("R&amp;D &lt;notes&gt;");
    expect(findPageByTitle(store.getSnapshot(), "  r&d <NOTES> ")).toBe(made);
    expect(findPageByTitle(store.getSnapshot(), "home")).toBe("p");
    store.commit([{ op: "update", id: made, patch: { trashed: 1 } }]);
    expect(findPageByTitle(store.getSnapshot(), "R&D <notes>")).toBeUndefined();
    store.undo();
    store.undo();
    expect(store.getSnapshot()[made]).toBeUndefined();
  });

  it("keeps a link's own words when the page is renamed, and exports both kinds", async () => {
    const store = await workspace();
    const other = createTitledPage(store, "Old title");
    const plain = pageLinkHtml(other, "Old title", false);
    const worded = pageLinkHtml(other, "see <this>", true);
    expect(worded).toBe(`<a href="#${other}" data-alias="1">see &lt;this&gt;</a>`);
    store.commit([{ op: "update", id: other, patch: { text: "New title" } }]);
    expect(liveMentions(`${plain} and ${worded}`, store.getSnapshot())).toBe(`<a href="#${other}">New title</a> and ${worded}`);
    expect(htmlToMarkdown(`${plain} and ${worded}`)).toBe(`[Old title](#${other}) and [see <this>](#${other})`);
  });
});
