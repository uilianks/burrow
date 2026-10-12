import type { Block, Op, Records } from "./store";

/**
 * A page and the blocks on it, for keeping as a version. Pages inside it
 * (sub-pages, database rows) are separate documents with their own history,
 * so they are referred to but not copied.
 */
export function subtree(records: Records, pageId: string): Block[] {
  const blocks: Block[] = [];
  const visit = (id: string) => {
    const block = records[id];
    if (!block) return;
    blocks.push(block);
    if (block.type !== "page" || id === pageId) block.content.forEach(visit);
  };
  visit(pageId);
  return blocks.filter((block) => block.type !== "page" || block.id === pageId);
}

/**
 * The changes that put a page back to a saved version. Blocks added since are
 * removed; pages added since are never lost: they stay where they were if that
 * block still exists, otherwise they move to the end of the page.
 */
export function restoreOps(records: Records, pageId: string, saved: Block[]): Op[] {
  const snapshot = new Map(saved.map((block) => [block.id, block]));
  const livePages: string[] = [];
  const current: Block[] = [];
  const visit = (id: string) => {
    const block = records[id];
    if (!block) return;
    if (block.type === "page" && id !== pageId) return void livePages.push(id);
    current.push(block);
    block.content.forEach(visit);
  };
  visit(pageId);

  const ops: Op[] = current.filter((block) => !snapshot.has(block.id)).map((block) => ({ op: "set", id: block.id, value: null }));
  const content = new Map(saved.map((block) => [block.id, block.content.filter((id) => snapshot.has(id) || livePages.includes(id))]));
  const placed = new Set([...content.values()].flat());
  for (const id of livePages) {
    if (placed.has(id)) continue;
    const home = records[id].parent && content.has(records[id].parent!) ? records[id].parent! : pageId;
    content.get(home)!.push(id);
  }
  for (const block of saved) {
    const parent = block.id === pageId ? records[pageId].parent : block.parent;
    ops.push({ op: "set", id: block.id, value: { ...block, parent, content: content.get(block.id)! } });
    for (const id of content.get(block.id)!) {
      if (livePages.includes(id) && records[id].parent !== block.id) ops.push({ op: "update", id, patch: { parent: block.id } });
    }
  }
  return ops;
}
