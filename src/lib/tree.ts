import { ROOT, type Records } from "./store";

export interface Row {
  id: string;
  depth: number;
}

/** The blocks shown inside a block: its own content, or for a synced block the shared content. */
export const childrenOf = (records: Records, id: string): string[] => {
  const block = records[id];
  return (block?.type === "synced" ? records[block.source ?? ""]?.content : block?.content) ?? [];
};

/**
 * Blocks under `parent` in the order they appear on screen, skipping collapsed
 * toggles' children. Columns are layout only, so a `column` gets no row of its own.
 */
export function visibleRows(records: Records, parent: string, depth = 0, rows: Row[] = []): Row[] {
  for (const id of childrenOf(records, parent)) {
    const block = records[id];
    if (!block || block.trashed) continue;
    if (block.type !== "column") rows.push({ id, depth });
    if (block.type !== "page" && block.type !== "database" && !block.collapsed) visibleRows(records, id, depth + 1, rows);
  }
  return rows;
}

/** Of some rows in screen order, those not shown inside an earlier one of them. */
export function outermost(rows: Row[]): string[] {
  const ids: string[] = [];
  let depth = Infinity;
  for (const row of rows) {
    if (row.depth > depth) continue;
    depth = row.depth;
    ids.push(row.id);
  }
  return ids;
}

/** True when `id` is `ancestor` or sits anywhere inside it. */
export function isWithin(records: Records, id: string, ancestor: string): boolean {
  for (let current: string | null | undefined = id; current; current = records[current]?.parent) {
    if (current === ancestor) return true;
  }
  return false;
}

/** True when the block, or any page it is inside, is in the trash. */
export function isTrashed(records: Records, id: string): boolean {
  for (let current: string | null | undefined = id; current; current = records[current]?.parent) {
    if (records[current]?.trashed) return true;
  }
  return false;
}

/** Pages directly on `page`, including ones nested inside its blocks. Database rows and trashed pages are left out. */
export function childPages(records: Records, page: string): string[] {
  const pages: string[] = [];
  const visit = (id: string) => {
    for (const child of childrenOf(records, id)) {
      if (records[child]?.type === "page") {
        if (!records[child].trashed) pages.push(child);
      } else if (records[child]?.type !== "database") visit(child);
    }
  };
  visit(page);
  return pages;
}

/** The pages from the top of the workspace down to `page`. */
export function pageTrail(records: Records, page: string): string[] {
  const trail: string[] = [];
  for (let id: string | null | undefined = page; id && id !== ROOT; id = records[id]?.parent) {
    if (records[id]?.type === "page") trail.unshift(id);
  }
  return trail;
}
