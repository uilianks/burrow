import { describe, expect, it } from "vitest";
import { BLOCK_KINDS } from "./blockKinds";
import { addRow, createPage, insertKind, trashPage } from "./commands";
import { fileName, mirrorFiles } from "./mirror";
import { ROOT, Store } from "./store";

describe("markdown copy", () => {
  it("makes names every system accepts", () => {
    expect(fileName('What? A "plan": v1/v2 ')).toBe("What A plan v1 v2");
    expect(fileName("  ")).toBe("Untitled");
    expect(fileName("CON")).toBe("_CON");
    expect(fileName("ends with dots...")).toBe("ends with dots");
    expect(fileName("x".repeat(200))).toHaveLength(80);
  });

  it("lays pages out as folders, numbering names that collide and skipping the trash", async () => {
    const store = new Store();
    await store.load(() => [{ id: ROOT, type: "page", text: "", parent: null, content: [] }]);
    const name = (id: string, text: string) => store.commit([{ op: "update", id, patch: { text } }]);
    const work = createPage(store);
    name(work, "Work");
    const twin = createPage(store);
    name(twin, "work");
    const sub = createPage(store, work);
    name(sub, "Plan");
    const gone = createPage(store, work);
    name(gone, "Old");
    trashPage(store, gone);
    const database = insertKind(store, sub, null, BLOCK_KINDS.find((k) => k.key === "database")!);
    addRow(store, database, {}, "Row one");

    const files = mirrorFiles(store.getSnapshot());
    expect(Object.keys(files).sort()).toEqual(["Work.md", "Work/Plan.md", "Work/Plan/Row one.md", "work 2.md"]);
    expect(files["Work/Plan.md"]).toContain("| Row one |");
    expect(files["Work.md"]).toContain("# Work");
    expect(files["Work.md"]).not.toContain("Old");
  });
});
