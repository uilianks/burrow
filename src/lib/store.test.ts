import { describe, expect, it } from "vitest";
import {
  createPage,
  deleteBlock,
  insertBlock,
  mergeIntoPrevious,
  indent,
  moveTo,
  outdent,
  duplicateBlock,
  seed,
  splitBlock,
} from "./commands";
import { ROOT, Store, type Block, type Persistence } from "./store";

const memory = (initial: Record<string, Block> = {}) => {
  const saved = { ...initial };
  const persistence: Persistence = {
    load: async () => ({ ...saved }),
    save: async (changed) => {
      for (const [id, value] of Object.entries(changed)) {
        if (value) saved[id] = value;
        else delete saved[id];
      }
    },
  };
  return { saved, persistence };
};

const emptyWorkspace = (): Block[] => [{ id: ROOT, type: "page", text: "", parent: null, content: [] }];

async function setup() {
  const { saved, persistence } = memory();
  const store = new Store(persistence);
  await store.load(emptyWorkspace);
  const page = createPage(store);
  const first = store.getSnapshot()[page].content[0];
  return { store, saved, page, first };
}

describe("store", () => {
  it("seeds an empty workspace and persists it", async () => {
    const { saved, persistence } = memory();
    const store = new Store(persistence);
    await store.load(seed);
    const [page] = store.getSnapshot()[ROOT].content;
    expect(store.getSnapshot()[page].text).toBe("Getting started");
    expect(saved[page]).toEqual(store.getSnapshot()[page]);
  });

  it("loads saved records instead of seeding", async () => {
    const first = await setup();
    const reloaded = new Store(memory(first.saved).persistence);
    await reloaded.load(seed);
    expect(reloaded.getSnapshot()).toEqual(first.store.getSnapshot());
  });

  it("splits, merges and reorders blocks", async () => {
    const { store, page, first } = await setup();
    const tail = splitBlock(store, first, "Hello", " world", "text");
    expect(store.getSnapshot()[page].content).toEqual([first, tail]);

    const third = insertBlock(store, page, tail, "todo", "x");
    moveTo(store, third, page, null);
    expect(store.getSnapshot()[page].content).toEqual([third, first, tail]);

    mergeIntoPrevious(store, first, tail);
    expect(store.getSnapshot()[first].text).toBe("Hello world");
    expect(store.getSnapshot()[tail]).toBeUndefined();
    expect(store.getSnapshot()[page].content).toEqual([third, first]);
  });

  it("undoes and redoes each command as one step", async () => {
    const { store, page, first } = await setup();
    const before = store.getSnapshot();
    const tail = splitBlock(store, first, "a", "b", "text");
    const after = store.getSnapshot();

    store.undo();
    expect(store.getSnapshot()).toEqual(before);
    store.redo();
    expect(store.getSnapshot()).toEqual(after);

    mergeIntoPrevious(store, first, tail);
    store.undo();
    expect(store.getSnapshot()).toEqual(after);
    expect(store.getSnapshot()[page].content).toEqual([first, tail]);
  });

  it("merges rapid edits to one block into a single undo step", async () => {
    const { store, first } = await setup();
    for (const text of ["h", "he", "hey"]) {
      store.commit([{ op: "update", id: first, patch: { text } }], { coalesce: first });
    }
    store.undo();
    expect(store.getSnapshot()[first].text).toBe("");
  });

  it("deletes a page with everything inside it, and restores it on undo", async () => {
    const { store, saved, page } = await setup();
    const child = createPage(store, page);
    const before = store.getSnapshot();

    deleteBlock(store, page);
    expect(Object.keys(store.getSnapshot())).toEqual([ROOT]);
    expect(Object.keys(saved)).toEqual([ROOT]);

    store.undo();
    expect(store.getSnapshot()).toEqual(before);
    expect(saved[child]).toEqual(before[child]);
  });

  it("indents under the block above and outdents back", async () => {
    const { store, page, first } = await setup();
    const second = insertBlock(store, page, first, "text", "child");
    const third = insertBlock(store, page, second, "text", "grandchild");

    expect(indent(store, first)).toBe(false);
    indent(store, second);
    indent(store, third);
    indent(store, third);
    expect(store.getSnapshot()[page].content).toEqual([first]);
    expect(store.getSnapshot()[first].content).toEqual([second]);
    expect(store.getSnapshot()[second].content).toEqual([third]);
    expect(store.getSnapshot()[third].parent).toBe(second);

    outdent(store, third);
    expect(store.getSnapshot()[first].content).toEqual([second, third]);
    outdent(store, third);
    expect(store.getSnapshot()[page].content).toEqual([first, third]);
    expect(outdent(store, third)).toBe(false);
  });

  it("refuses to move a block inside itself", async () => {
    const { store, page, first } = await setup();
    const child = insertBlock(store, first, null, "text");
    const before = store.getSnapshot();
    moveTo(store, first, child, null);
    expect(store.getSnapshot()).toBe(before);
    expect(store.getSnapshot()[page].content).toEqual([first]);
  });

  it("keeps a merged block's children in its place", async () => {
    const { store, page, first } = await setup();
    const second = insertBlock(store, page, first, "text", "b");
    const child = insertBlock(store, second, null, "text", "c");
    mergeIntoPrevious(store, first, second);
    expect(store.getSnapshot()[page].content).toEqual([first, child]);
    expect(store.getSnapshot()[child].parent).toBe(page);
    expect(store.getSnapshot()[second]).toBeUndefined();
  });

  it("duplicates and deletes nested blocks with their parent", async () => {
    const { store, page, first } = await setup();
    const child = insertBlock(store, first, null, "todo", "inner");
    const copy = duplicateBlock(store, first)!;
    const [copiedChild] = store.getSnapshot()[copy].content;
    expect(copiedChild).not.toBe(child);
    expect(store.getSnapshot()[copiedChild]).toMatchObject({ text: "inner", parent: copy });

    deleteBlock(store, first);
    expect(store.getSnapshot()[child]).toBeUndefined();
    expect(store.getSnapshot()[page].content).toEqual([copy]);
  });
});

describe("batch", () => {
  it("folds several commits into one undo step", async () => {
    const { store, page, first } = await setup();
    const before = store.getSnapshot();
    store.batch(() => {
      const second = insertBlock(store, page, first, "text", "two");
      indent(store, second);
      deleteBlock(store, first);
    });
    expect(store.getSnapshot()[page].content).toEqual([]);
    store.undo();
    expect(store.getSnapshot()).toEqual(before);
  });
});
