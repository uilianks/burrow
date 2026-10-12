import { describe, expect, it } from "vitest";
import { BLOCK_KINDS } from "./blockKinds";
import { addRow, createTitledPage, createPage, insertBlock, insertKind } from "./commands";
import { buildGraph, GRAPH_DEFAULTS, layoutGraph } from "./graph";
import { pageLinkHtml } from "./links";
import { ROOT, Store } from "./store";

async function sample() {
  const store = new Store();
  await store.load(() => [{ id: ROOT, type: "page", text: "", parent: null, content: [] }]);
  const work = createTitledPage(store, "Work");
  const plan = createPage(store, work);
  const home = createTitledPage(store, "Home");
  const alone = createTitledPage(store, "Alone");
  insertBlock(store, home, null, "text", `${pageLinkHtml(plan, "plan", true)} and again ${pageLinkHtml(plan, "plan", true)}`);
  const database = insertKind(store, work, null, BLOCK_KINDS.find((k) => k.key === "database")!);
  const row = addRow(store, database, {}, "Row");
  return { store, work, plan, home, alone, row };
}

describe("graph", () => {
  it("draws what the options ask for", async () => {
    const { store, work, plan, home, alone, row } = await sample();
    const records = store.getSnapshot();
    const all = buildGraph(records, GRAPH_DEFAULTS);
    expect(all.nodes.map((n) => n.id).sort()).toEqual([work, plan, home, alone].sort());
    expect(all.links).toEqual([{ from: work, to: plan, kind: "child" }, { from: home, to: plan, kind: "mention" }]);
    expect(all.nodes.find((n) => n.id === plan)).toMatchObject({ title: "Untitled", group: work, degree: 2 });

    expect(buildGraph(records, { ...GRAPH_DEFAULTS, orphans: false }).nodes.some((n) => n.id === alone)).toBe(false);
    expect(buildGraph(records, { ...GRAPH_DEFAULTS, mentions: false }).links).toEqual([{ from: work, to: plan, kind: "child" }]);
    expect(buildGraph(records, { ...GRAPH_DEFAULTS, children: false, mentions: false, orphans: false }).nodes).toEqual([]);
    const withRows = buildGraph(records, { ...GRAPH_DEFAULTS, rows: true });
    expect(withRows.nodes.some((n) => n.id === row)).toBe(true);
    expect(withRows.links).toContainEqual({ from: work, to: row, kind: "child" });
  });

  it("lays pages out inside the picture, the same way every time", async () => {
    const { store, plan, home, alone } = await sample();
    const { nodes, links } = buildGraph(store.getSnapshot(), GRAPH_DEFAULTS);
    for (const layout of ["force", "groups", "ring"] as const) {
      const first = layoutGraph(nodes, links, layout, 600);
      expect([...layoutGraph(nodes, links, layout, 600)]).toEqual([...first]);
      expect(first.size).toBe(nodes.length);
      for (const point of first.values()) {
        expect(point.x).toBeGreaterThanOrEqual(0);
        expect(point.x).toBeLessThanOrEqual(600);
        expect(Number.isFinite(point.y)).toBe(true);
      }
    }
    // in the force layout, pages joined by a line end up nearer than pages that are not
    const at = layoutGraph(nodes, links, "force", 600);
    const gap = (a: string, b: string) => Math.hypot(at.get(a)!.x - at.get(b)!.x, at.get(a)!.y - at.get(b)!.y);
    expect(gap(home, plan)).toBeLessThan(gap(alone, plan));
    expect(layoutGraph([], [], "force", 600).size).toBe(0);
    expect(layoutGraph(nodes.slice(0, 1), [], "groups", 600).get(nodes[0].id)).toEqual({ x: 300, y: 300 });
  });
});
