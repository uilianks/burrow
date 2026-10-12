import { describe, expect, it } from "vitest";
import { BLOCK_KINDS } from "./blockKinds";
import { deleteBlock, duplicateBlock, indent, insertBlock, insertFiles, insertKind, insertSyncedCopy, outdent } from "./commands";
import { embedUrl, webUrl } from "./embed";
import { findEmoji } from "./emoji";
import { toMarkdown } from "./markdown";
import { ROOT, Store } from "./store";
import { childPages, outermost, visibleRows } from "./tree";

const kind = (key: string) => BLOCK_KINDS.find((k) => k.key === key)!;

async function workspace() {
  const store = new Store();
  await store.load(() => [
    { id: ROOT, type: "page", text: "", parent: null, content: ["p"] },
    { id: "p", type: "page", text: "Page", parent: ROOT, content: [] },
  ]);
  return store;
}

describe("columns", () => {
  it("start with a text block each and keep blocks from escaping", async () => {
    const store = await workspace();
    const columns = insertKind(store, "p", null, kind("columns3"));
    const records = store.getSnapshot();
    expect(records[columns].content).toHaveLength(3);
    const [first] = records[records[columns].content[0]].content;
    expect(records[first].type).toBe("text");
    expect(outdent(store, first)).toBe(false);

    // a column is not a row: the rows are the columns block and the three texts, one level in
    expect(visibleRows(store.getSnapshot(), "p").map((r) => r.depth)).toEqual([0, 2, 2, 2]);
    const after = insertBlock(store, "p", columns, "text", "below");
    expect(indent(store, after)).toBe(false);
  });

  it("are deleted and restored whole", async () => {
    const store = await workspace();
    const before = store.getSnapshot();
    const columns = insertKind(store, "p", null, kind("columns2"));
    const created = store.getSnapshot();
    deleteBlock(store, columns);
    expect(store.getSnapshot()).toEqual(before);
    store.undo();
    expect(store.getSnapshot()).toEqual(created);
  });
});

describe("synced blocks", () => {
  it("show the same content from every copy and survive losing one", async () => {
    const store = await workspace();
    const original = insertKind(store, "p", null, kind("synced"));
    const shared = store.getSnapshot()[original].source!;
    const [line] = store.getSnapshot()[shared].content;
    store.commit([{ op: "update", id: line, patch: { text: "same everywhere" } }]);

    const copy = insertSyncedCopy(store, "p", original, shared)!;
    const again = duplicateBlock(store, copy)!;
    expect(store.getSnapshot()[again].source).toBe(shared);
    expect(visibleRows(store.getSnapshot(), "p").map((r) => r.id)).toEqual([original, line, copy, line, again, line]);
    expect(toMarkdown(store.getSnapshot(), [original, copy])).toBe("same everywhere\nsame everywhere");

    deleteBlock(store, original);
    expect(store.getSnapshot()[line].text).toBe("same everywhere");
    expect(visibleRows(store.getSnapshot(), "p").map((r) => r.id)).toEqual([copy, line, again, line]);
    expect(insertSyncedCopy(store, "p", null, "p")).toBeNull();
  });

  it("list their sub-pages under the page they are on", async () => {
    const store = await workspace();
    const synced = insertKind(store, "p", null, kind("synced"));
    const sub = insertKind(store, store.getSnapshot()[synced].source!, null, kind("page"));
    expect(childPages(store.getSnapshot(), "p")).toEqual([sub]);
  });
});

describe("outermost", () => {
  it("drops rows shown inside an earlier selected row", () => {
    const rows = [
      { id: "child", depth: 2 }, { id: "next", depth: 1 }, { id: "inner", depth: 2 }, { id: "deep", depth: 3 }, { id: "top", depth: 0 },
    ];
    expect(outermost(rows)).toEqual(["child", "next", "top"]);
  });
});

describe("files and media", () => {
  it("adds one block per file, typed by what the file is", async () => {
    const store = await workspace();
    const saved: Blob[] = [];
    const files = { put: async (file: Blob) => `f${saved.push(file)}`, get: async () => undefined, keys: async () => [], delete: async () => {} };
    const uploads = [
      new File(["a"], "a.png", { type: "image/png" }),
      new File(["b"], "b.mp4", { type: "video/mp4" }),
      new File(["c"], "c.zip", { type: "application/zip" }),
    ];
    const ids = await insertFiles(store, files, "p", null, uploads);
    const records = store.getSnapshot();
    expect(records.p.content).toEqual(ids);
    expect(ids.map((id) => records[id].type)).toEqual(["image", "video", "file"]);
    expect(records[ids[0]]).toMatchObject({ fileId: "f1", name: "a.png", size: 1 });
    store.undo();
    expect(store.getSnapshot().p.content).toEqual([]);
  });

  it("exports rich blocks to Markdown", async () => {
    const store = await workspace();
    const table = insertKind(store, "p", null, kind("table"));
    store.commit([{ op: "update", id: table, patch: { table: [["a", "b|c"], ["1", "2"]] } }]);
    const equation = insertBlock(store, "p", table, "equation", "E = mc^2");
    expect(toMarkdown(store.getSnapshot(), [table, equation])).toBe("| a | b\\|c |\n| --- | --- |\n| 1 | 2 |\n$$ E = mc^2 $$");
  });
});

describe("links", () => {
  it("accepts only web addresses", () => {
    expect(webUrl("example.com/a b")).toBe("https://example.com/a%20b");
    expect(webUrl("http://example.com")).toBe("http://example.com/");
    expect(webUrl("javascript:alert(1)")).toBeNull();
    expect(webUrl("data:text/html,<script>")).toBeNull();
    expect(webUrl("not a link")).toBeNull();
  });

  it("turns video pages into their players", () => {
    expect(embedUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(embedUrl("youtu.be/dQw4w9WgXcQ")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ");
    expect(embedUrl("https://vimeo.com/12345")).toBe("https://player.vimeo.com/video/12345");
    expect(embedUrl("https://example.com/map")).toBe("https://example.com/map");
    expect(embedUrl("http://example.com/insecure")).toBeNull();
  });
});

describe("emoji", () => {
  it("prefers names that start with the query", () => {
    expect(findEmoji("he").map((e) => e.name).slice(0, 2)).toEqual(["heart_eyes", "heart"]);
    expect(findEmoji("rocket")[0].emoji).toBe("🚀");
    expect(findEmoji("qqqq")).toEqual([]);
  });
});
