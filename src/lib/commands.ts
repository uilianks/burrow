import { ROOT, type Block, type BlockType, type Op, type Records, type Store } from "./store";
import { isContainer, isEditable, type BlockKind } from "./blockKinds";
import type { FileStore } from "./files";
import type { ParsedBlock } from "./markdown";
import { isWithin } from "./tree";

const newId = () => crypto.randomUUID();

const block = (id: string, type: BlockType, parent: string | null, text = "", content: string[] = []): Block => ({
  id,
  type,
  text,
  parent,
  content,
});

const last = (records: Records, parent: string) => records[parent]?.content.at(-1) ?? null;

/** Creates a page with one empty text block. `after` defaults to the end of the parent. */
export function createPage(store: Store, parent: string = ROOT, after?: string | null): string {
  const id = newId();
  const firstBlock = newId();
  store.commit([
    { op: "set", id, value: block(id, "page", parent, "", [firstBlock]) },
    { op: "set", id: firstBlock, value: block(firstBlock, "text", id) },
    { op: "insert", parent, id, after: after === undefined ? last(store.getSnapshot(), parent) : after },
  ]);
  return id;
}

/** A new top-level page with the given title, as made by linking to a page that doesn't exist yet. */
export function createTitledPage(store: Store, title: string): string {
  let id = "";
  store.batch(() => {
    id = createPage(store);
    store.commit([{ op: "update", id, patch: { text: title.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") } }]);
  });
  return id;
}

export function insertBlock(store: Store, parent: string, after: string | null, type: BlockType, text = ""): string {
  const id = newId();
  store.commit([
    { op: "set", id, value: block(id, type, parent, text) },
    { op: "insert", parent, id, after },
  ]);
  return id;
}

/**
 * Inserts a block of a non-text kind (divider, media, table, columns, synced
 * block…) with whatever it needs inside it. Returns the id of the new block.
 */
export function insertKind(store: Store, parent: string, after: string | null, kind: BlockKind): string {
  if (kind.type === "page") return createPage(store, parent, after);
  const id = newId();
  const ops: Op[] = [];
  const added = block(id, kind.type, parent);
  if (kind.type === "plugin") added.plugin = kind.plugin;
  if (kind.type === "table") added.table = [["", ""], ["", ""], ["", ""]];
  if (kind.type === "database") {
    added.schema = [
      { id: newId(), name: "Status", type: "select", options: ["To do", "Doing", "Done"] },
      { id: newId(), name: "Date", type: "date" },
    ];
    added.views = [{ id: newId(), name: "Table", type: "table" }];
  }
  if (kind.type === "columns") {
    for (let i = 0; i < (kind.columns ?? 2); i++) {
      const column = newId();
      const first = newId();
      added.content.push(column);
      ops.push({ op: "set", id: column, value: block(column, "column", id, "", [first]) });
      ops.push({ op: "set", id: first, value: block(first, "text", column) });
    }
  }
  if (kind.type === "synced") {
    const shared = newId();
    const first = newId();
    added.source = shared;
    ops.push({ op: "set", id: shared, value: block(shared, "shared", null, "", [first]) });
    ops.push({ op: "set", id: first, value: block(first, "text", shared) });
  }
  store.commit([...ops, { op: "set", id, value: added }, { op: "insert", parent, id, after }]);
  return id;
}

/** Another copy of the same synced content. */
export function insertSyncedCopy(store: Store, parent: string, after: string | null, source: string): string | null {
  if (store.getSnapshot()[source]?.type !== "shared") return null;
  const id = newId();
  store.commit([
    { op: "set", id, value: { ...block(id, "synced", parent), source } },
    { op: "insert", parent, id, after },
  ]);
  return id;
}

const mediaType = (file: File): BlockType =>
  file.type.startsWith("image/")
    ? "image"
    : file.type.startsWith("video/")
      ? "video"
      : file.type.startsWith("audio/")
        ? "audio"
        : "file";

/** Stores files and adds one media block per file after `after`. Returns the new ids. */
export async function insertFiles(
  store: Store,
  files: FileStore,
  parent: string,
  after: string | null,
  uploads: File[],
): Promise<string[]> {
  const stored = await Promise.all(uploads.map((file) => files.put(file)));
  const ops: Op[] = [];
  const ids = uploads.map((file, index) => {
    const id = newId();
    const value = { ...block(id, mediaType(file), parent), fileId: stored[index], name: file.name, size: file.size };
    ops.push({ op: "set", id, value }, { op: "insert", parent, id, after });
    after = id;
    return id;
  });
  // the page may have been deleted while the files were being stored
  if (!store.getSnapshot()[parent]) return [];
  store.commit(ops);
  return ids;
}

/**
 * Keeps `head` in the block and moves `tail` into a new block: its first
 * child when `asChild`, otherwise the next sibling.
 */
export function splitBlock(
  store: Store,
  id: string,
  head: string,
  tail: string,
  tailType: BlockType,
  asChild = false,
): string {
  const parent = asChild ? id : store.getSnapshot()[id].parent!;
  const tailId = newId();
  store.commit([
    { op: "update", id, patch: { text: head } },
    { op: "set", id: tailId, value: block(tailId, tailType, parent, tail) },
    { op: "insert", parent, id: tailId, after: asChild ? null : id },
  ]);
  return tailId;
}

/** Appends a block's text to `previous` and removes it; its children take its place. */
export function mergeIntoPrevious(store: Store, previous: string, id: string) {
  const records = store.getSnapshot();
  const merged = records[id];
  const parent = merged.parent!;
  const ops: Op[] = [{ op: "update", id: previous, patch: { text: records[previous].text + merged.text } }];
  let after = id;
  for (const child of merged.content) {
    ops.push(
      { op: "remove", parent: id, id: child },
      { op: "update", id: child, patch: { parent } },
      { op: "insert", parent, id: child, after },
    );
    after = child;
  }
  ops.push({ op: "remove", parent, id }, { op: "set", id, value: null });
  store.commit(ops);
}

/** Moves a block (with everything inside it) under `parent`, after `after` or first when null. */
export function moveTo(store: Store, id: string, parent: string, after: string | null) {
  const records = store.getSnapshot();
  const from = records[id]?.parent;
  if (!from || !records[parent] || after === id || isWithin(records, parent, id)) return;
  store.commit([
    { op: "remove", parent: from, id },
    { op: "update", id, patch: { parent } },
    { op: "insert", parent, id, after },
  ]);
}

/** Nests a block under the sibling above it. Returns false when there is nothing to nest under. */
export function indent(store: Store, id: string): boolean {
  const records = store.getSnapshot();
  const siblings = records[records[id].parent!].content;
  const above = records[siblings[siblings.indexOf(id) - 1]];
  if (!above || !isEditable(above)) return false;
  store.commit([
    { op: "remove", parent: above.parent!, id },
    { op: "update", id, patch: { parent: above.id } },
    { op: "insert", parent: above.id, id, after: above.content.at(-1) ?? null },
    ...(above.collapsed ? [{ op: "update", id: above.id, patch: { collapsed: false } } as Op] : []),
  ]);
  return true;
}

/** Moves a nested block out one level, to just after its parent. */
export function outdent(store: Store, id: string): boolean {
  const records = store.getSnapshot();
  const parent = records[records[id].parent!];
  if (isContainer(parent)) return false;
  moveTo(store, id, parent.parent!, parent.id);
  return true;
}

/** Adds to `ops` a copy of a block and the blocks nested in it (sub-pages are not copied). Returns the copy's id. */
function cloneBlock(records: Records, sourceId: string, parent: string, ops: Op[]): string {
  const copy = newId();
  const content = records[sourceId].content
    .filter((child) => records[child] && records[child].type !== "page")
    .map((child) => cloneBlock(records, child, copy, ops));
  // notes, reminders and review progress belong to the original, not to its copies
  const fields = { ...records[sourceId], id: copy, parent, content };
  delete fields.comments;
  delete fields.remind;
  delete fields.reminded;
  delete fields.card;
  ops.push({ op: "set", id: copy, value: fields });
  return copy;
}

/** Copies a block and the blocks nested in it (sub-pages are not copied). */
export function duplicateBlock(store: Store, id: string): string | null {
  const records = store.getSnapshot();
  const source = records[id];
  if (!source?.parent || source.type === "page") return null;
  const ops: Op[] = [];
  const copy = cloneBlock(records, id, source.parent, ops);
  store.commit([...ops, { op: "insert", parent: source.parent, id: copy, after: id }]);
  return copy;
}

/** Presses a template button: copies of the blocks inside it are added right after it. Returns the new ids. */
export function stampTemplate(store: Store, id: string): string[] {
  const records = store.getSnapshot();
  const button = records[id];
  if (!button?.parent) return [];
  const ops: Op[] = [];
  let after = id;
  const copies = button.content
    .filter((child) => records[child] && records[child].type !== "page")
    .map((child) => {
      const copy = cloneBlock(records, child, button.parent!, ops);
      ops.push({ op: "insert", parent: button.parent!, id: copy, after });
      return (after = copy);
    });
  store.commit(ops);
  return copies;
}

/**
 * Puts blocks beside `target`: in a new column next to the one target is in,
 * or, when target isn't in columns yet, in a new two-column layout holding
 * target on the left and the blocks on the right.
 */
export function makeColumns(store: Store, target: string, ids: string[]) {
  const records = store.getSnapshot();
  const beside = records[target];
  if (!beside?.parent || ids.some((id) => isWithin(records, target, id))) return;
  const holder = records[beside.parent];
  const column = newId();
  store.batch(() => {
    if (holder.type === "column") {
      store.commit([
        { op: "set", id: column, value: block(column, "column", holder.parent) },
        { op: "insert", parent: holder.parent!, id: column, after: holder.id },
      ]);
    } else {
      const columns = newId();
      const left = newId();
      store.commit([
        { op: "set", id: columns, value: block(columns, "columns", holder.id, "", [left, column]) },
        { op: "set", id: left, value: block(left, "column", columns) },
        { op: "set", id: column, value: block(column, "column", columns) },
        { op: "insert", parent: holder.id, id: columns, after: target },
      ]);
      moveTo(store, target, left, null);
    }
    let after: string | null = null;
    for (const id of ids) {
      moveTo(store, id, column, after);
      after = id;
    }
  });
}

/** A second window onto a database: the same rows and properties, with its own views. */
export function insertLinkedDatabase(store: Store, parent: string, after: string | null, source: string): string | null {
  if (store.getSnapshot()[source]?.type !== "database") return null;
  const id = newId();
  store.commit([
    { op: "set", id, value: { ...block(id, "linkedDatabase", parent), source, views: [{ id: newId(), name: "Table", type: "table" }] } },
    { op: "insert", parent, id, after },
  ]);
  return id;
}

/**
 * Adds a row (a page) to a database, optionally with some property values and
 * as a sub-item of another row. If the database has a row template, the new
 * row starts with a copy of that row's contents and values. Returns its id.
 */
export function addRow(store: Store, database: string, props: Block["props"] = {}, title = "", parentRow?: string): string {
  const records = store.getSnapshot();
  const chosen = records[records[database]?.rowTemplate ?? ""];
  const template = chosen && !chosen.trashed && chosen.parent === database ? chosen : undefined;
  const id = newId();
  const ops: Op[] = [];
  let content: string[];
  if (template) {
    content = template.content.filter((child) => records[child] && records[child].type !== "page").map((child) => cloneBlock(records, child, id, ops));
  } else {
    content = [newId()];
    ops.push({ op: "set", id: content[0], value: block(content[0], "text", id) });
  }
  const row = { ...block(id, "page", database, title, content), props: { ...template?.props, ...props }, icon: template?.icon, parentRow };
  store.commit([...ops, { op: "set", id, value: row }, { op: "insert", parent: database, id, after: last(records, database) }]);
  return id;
}

/**
 * Adds rows from a grid of text whose first row names the columns. A "Name"
 * column (or else the first) becomes the row title; columns the database
 * doesn't have yet are added as text properties.
 */
export function importRows(store: Store, database: string, table: string[][]) {
  const [header = [], ...lines] = table;
  const titleColumn = Math.max(0, header.findIndex((name) => name.trim().toLowerCase() === "name"));
  const schema = [...(store.getSnapshot()[database].schema ?? [])];
  const columns = header.map((name, index) => {
    if (index === titleColumn) return null;
    let found = schema.find((property) => property.name.toLowerCase() === name.trim().toLowerCase());
    if (!found) schema.push((found = { id: newId(), name: name.trim() || `Column ${index + 1}`, type: "text" }));
    return found;
  });
  store.batch(() => {
    store.commit([{ op: "update", id: database, patch: { schema } }]);
    for (const line of lines) {
      const props: NonNullable<Block["props"]> = {};
      columns.forEach((property, index) => {
        const value = line[index] ?? "";
        if (!property || value === "" || property.type === "formula") return;
        props[property.id] =
          property.type === "number" ? Number(value) || 0 : property.type === "checkbox" ? /^(✓|true|yes|1)$/i.test(value) : property.type === "multiSelect" ? value.split(/,\s*/) : value;
      });
      addRow(store, database, props, line[titleColumn] ?? "");
    }
  });
}

export const trashPage = (store: Store, id: string) => store.commit([{ op: "update", id, patch: { trashed: Date.now() } }]);
export const restorePage = (store: Store, id: string) => store.commit([{ op: "update", id, patch: { trashed: undefined } }]);

/** Removes blocks the way the editor's Delete does: pages go to the trash, everything else is deleted. */
export function removeBlocks(store: Store, ids: string[]) {
  const records = store.getSnapshot();
  const pages = ids.filter((id) => records[id]?.type === "page");
  store.batch(() => {
    deleteBlocks(store, ids.filter((id) => !pages.includes(id)));
    pages.forEach((id) => trashPage(store, id));
  });
}

/**
 * Deletes pages for good, then clears out what only they were using: stored
 * files no block refers to and synced content no synced block shows. This
 * cannot be undone, so the undo history is dropped.
 */
export async function purgePages(store: Store, files: FileStore, ids: string[]) {
  deleteBlocks(store, ids);
  const records = Object.values(store.getSnapshot());
  const shown = new Set(records.map((record) => record.source));
  deleteBlocks(store, records.filter((record) => record.type === "shared" && !shown.has(record.id)).map((record) => record.id));
  store.clearHistory();
  const used = new Set(
    Object.values(store.getSnapshot()).flatMap((record) => [
      record.fileId,
      record.cover,
      // files kept in database properties
      ...Object.values(record.props ?? {}).flatMap((value) => (Array.isArray(value) ? value.map((entry) => entry.slice(0, 36)) : [])),
    ]),
  );
  await Promise.all((await files.keys()).filter((key) => !used.has(key)).map((key) => files.delete(key)));
}

/** A full copy of a page, sub-pages included, added to the end of `parent`. Used to start a page from a template. */
export function copyPage(store: Store, id: string, parent: string = ROOT): string {
  const records = store.getSnapshot();
  const ops: Op[] = [];
  const clone = (sourceId: string, owner: string): string => {
    const copy = newId();
    const content = records[sourceId].content.filter((child) => records[child]).map((child) => clone(child, copy));
    ops.push({ op: "set", id: copy, value: { ...records[sourceId], id: copy, parent: owner, content } });
    return copy;
  };
  const copy = clone(id, parent);
  store.commit([
    ...ops,
    { op: "update", id: copy, patch: { template: undefined, favorite: undefined, trashed: undefined, daily: undefined } },
    { op: "insert", parent, id: copy, after: last(records, parent) },
  ]);
  return copy;
}

/** The daily note for a day (YYYY-MM-DD), created on first use inside a "Daily notes" page. */
export function dailyPage(store: Store, day: string): string {
  const pages = Object.values(store.getSnapshot()).filter((record) => record.type === "page" && !record.trashed);
  const existing = pages.find((record) => record.daily === day);
  if (existing) return existing.id;
  let id = "";
  store.batch(() => {
    let index = pages.find((record) => record.daily === "index")?.id;
    if (!index) {
      index = createPage(store);
      store.commit([{ op: "update", id: index, patch: { text: "Daily notes", icon: "📅", daily: "index" } }]);
    }
    id = createPage(store, index, null);
    store.commit([{ op: "update", id, patch: { text: day, daily: day } }]);
  });
  return id;
}

/** Adds blocks from a backup (already given fresh ids) under a new page. Returns that page. */
export function importBlocks(store: Store, title: string, blocks: Block[], top: string[]): string {
  let id = "";
  store.batch(() => {
    id = createPage(store);
    const [placeholder] = store.getSnapshot()[id].content;
    store.commit([
      ...blocks.map((value): Op => ({ op: "set", id: value.id, value: top.includes(value.id) ? { ...value, parent: id } : value })),
      { op: "set", id: placeholder, value: null },
      { op: "update", id, patch: { text: title, content: top } },
    ]);
  });
  return id;
}

/** Deletes a block and everything inside it. */
export function deleteBlock(store: Store, id: string) {
  store.commit(deleteOps(store.getSnapshot(), id));
}

/** Deletes several separate blocks (none inside another) as one step. */
export function deleteBlocks(store: Store, ids: string[]) {
  const records = store.getSnapshot();
  store.commit(ids.flatMap((id) => deleteOps(records, id)));
}

/**
 * Inserts parsed blocks under `parent` after `after`, nesting each one under
 * the nearest earlier block of lower depth. Returns the new ids in order.
 */
export function insertParsed(store: Store, parent: string, after: string | null, parsed: ParsedBlock[]): string[] {
  const ops: Op[] = [];
  const ids: string[] = [];
  const path: string[] = [];
  const lastChild = new Map<string, string | null>([[parent, after]]);
  for (const { depth: wanted, ...fields } of parsed) {
    const depth = Math.min(wanted, path.length);
    const owner = depth === 0 ? parent : path[depth - 1];
    const id = newId();
    ops.push(
      { op: "set", id, value: { ...fields, id, parent: owner, content: [] } },
      { op: "insert", parent: owner, id, after: lastChild.get(owner) ?? null },
    );
    lastChild.set(owner, id);
    path.length = depth;
    path.push(id);
    ids.push(id);
  }
  store.commit(ops);
  return ids;
}

function deleteOps(records: Records, id: string): Op[] {
  const target = records[id];
  if (!target) return [];
  const ops: Op[] = target.parent ? [{ op: "remove", parent: target.parent, id }] : [];
  const visit = (blockId: string) => {
    for (const child of records[blockId]?.content ?? []) visit(child);
    ops.push({ op: "set", id: blockId, value: null });
  };
  visit(id);
  return ops;
}

export function seed(): Block[] {
  const page = newId();
  const lines: [BlockType, string][] = [
    ["text", "Burrow is a block-based notes workspace. Everything is saved in this browser."],
    ["h2", "Try it"],
    ["todo", "Type <code>/</code> to open the block menu"],
    ["todo", "Start a line with <code>#</code>, <code>-</code>, <code>1.</code>, <code>[]</code> or <code>&gt;</code> then space"],
    ["todo", "Drag the handle on the left to reorder blocks"],
    ["todo", "Add a page inside this one from the sidebar"],
    ["callout", "Undo with Ctrl+Z, redo with Ctrl+Shift+Z."],
  ];
  const blocks = lines.map(([type, text]) => block(newId(), type, page, text));
  return [
    block(ROOT, "page", null, "", [page]),
    block(page, "page", ROOT, "Getting started", blocks.map((b) => b.id)),
    ...blocks,
  ];
}
