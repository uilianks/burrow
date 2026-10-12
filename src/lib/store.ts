export type BlockType =
  | "page"
  | "text"
  | "h1"
  | "h2"
  | "h3"
  | "todo"
  | "toggle"
  | "bullet"
  | "numbered"
  | "quote"
  | "callout"
  | "code"
  | "divider"
  | "image"
  | "video"
  | "audio"
  | "file"
  | "bookmark"
  | "embed"
  | "equation"
  | "table"
  | "toc"
  | "columns"
  | "column"
  | "synced"
  | "shared"
  | "database"
  | "plugin"
  | "linkedDatabase"
  | "button";

// Everything is a block. `content` lists the blocks nested inside it (for a
// page, the blocks and sub-pages on it); `text` holds sanitized inline HTML
// (plain LaTeX source for an equation, a plain title for a bookmark).
//
// Two kinds of block only hold other blocks: a `columns` block holds `column`
// blocks, and a `synced` block shows the content of the `shared` block named
// by `source`. A `shared` block sits outside the page tree so that every
// synced copy of it is equal and deleting one copy never deletes the content.
export interface Block {
  id: string;
  type: BlockType;
  text: string;
  checked?: boolean;
  /** Toggles only: children are hidden. */
  collapsed?: boolean;
  /** Headings only: behaves like a toggle. */
  toggleable?: boolean;
  /** Code only: language used for highlighting. */
  language?: string;
  align?: "center" | "right";
  /** Media: id of the stored file (see files.ts) or, failing that, an external address. */
  fileId?: string;
  url?: string;
  name?: string;
  size?: number;
  /** Tables: rows of plain-text cells. The first row is the header. */
  table?: string[][];
  /** Notes to yourself about this block. */
  comments?: { at: number; text: string }[];
  /** When to be reminded of this block, and whether that has happened. */
  remind?: number;
  reminded?: boolean;
  /** Toggles reviewed as flashcards: when the card is next due and the current gap in days. */
  card?: { due: number; interval: number };
  /** Plugin blocks: which plugin block kind draws this ("<plugin id>/<block id>") and the data it saved. */
  plugin?: string;
  data?: unknown;
  /** Synced blocks: the `shared` block whose content is shown. Linked databases: the database whose rows are shown. */
  source?: string;
  /** Images: width as a percentage of the page; unset is full width. */
  width?: number;
  /** Databases: the columns and the saved views. Their `content` is the row pages. */
  schema?: Property[];
  views?: View[];
  /** Databases: rules that fill in one property when another changes, and the row new rows start as a copy of. */
  automations?: Automation[];
  rowTemplate?: string;
  /** Rows: the row this one is a sub-item of. */
  parentRow?: string;
  /** Pages: marked as checked and current, when, and (optionally) until when that holds. */
  verified?: { at: number; until?: number };
  /** Pages: locked against edits until unlocked. */
  locked?: boolean;
  /** Pages only. A page inside a database is a row; `props` holds its values by property id. */
  props?: Record<string, PropValue>;
  /** When the page was moved to the trash. Trashed pages stay in place but are hidden everywhere. */
  trashed?: number;
  favorite?: boolean;
  template?: boolean;
  /** The day (YYYY-MM-DD) this page is the daily note for, or "index" for the page that holds them. */
  daily?: string;
  icon?: string;
  /** File id of the cover image. */
  cover?: string;
  /** Unset means "follow the full-width-by-default preference". */
  fullWidth?: boolean;
  font?: "serif" | "mono";
  smallText?: boolean;
  parent: string | null;
  content: string[];
}

import type { Automation, PropValue, Property, View } from "./database";

export type Records = Readonly<Record<string, Block>>;

export type Op =
  | { op: "set"; id: string; value: Block | null }
  | { op: "update"; id: string; patch: Partial<Omit<Block, "id">> }
  | { op: "insert"; parent: string; id: string; after: string | null }
  | { op: "remove"; parent: string; id: string };

export interface Persistence {
  load(): Promise<Record<string, Block>>;
  save(changed: Record<string, Block | null>): Promise<void>;
}

export const ROOT = "root";
const COALESCE_MS = 1000;

/** Applies one op and returns the new records plus the ops that undo it. */
export function applyOp(records: Records, op: Op): { records: Records; inverse: Op[] } {
  const next: Record<string, Block> = { ...records };
  switch (op.op) {
    case "set": {
      const previous = records[op.id] ?? null;
      if (op.value) next[op.id] = op.value;
      else delete next[op.id];
      return { records: next, inverse: [{ op: "set", id: op.id, value: previous }] };
    }
    case "update": {
      const block = records[op.id];
      if (!block) return { records, inverse: [] };
      const previous: Record<string, unknown> = {};
      for (const key of Object.keys(op.patch)) previous[key] = block[key as keyof Block];
      next[op.id] = { ...block, ...op.patch };
      return { records: next, inverse: [{ op: "update", id: op.id, patch: previous }] };
    }
    case "insert": {
      const parent = records[op.parent];
      if (!parent) return { records, inverse: [] };
      const content = parent.content.filter((id) => id !== op.id);
      const index = op.after === null ? 0 : content.indexOf(op.after) + 1 || content.length;
      content.splice(index, 0, op.id);
      next[op.parent] = { ...parent, content };
      return { records: next, inverse: [{ op: "update", id: op.parent, patch: { content: parent.content } }] };
    }
    case "remove": {
      const parent = records[op.parent];
      const index = parent ? parent.content.indexOf(op.id) : -1;
      if (!parent || index < 0) return { records, inverse: [] };
      next[op.parent] = { ...parent, content: parent.content.filter((id) => id !== op.id) };
      return {
        records: next,
        inverse: [{ op: "insert", parent: op.parent, id: op.id, after: parent.content[index - 1] ?? null }],
      };
    }
  }
}

interface HistoryEntry {
  ops: Op[];
  coalesce?: string;
  at: number;
}

const EMPTY: Records = {};

export class Store {
  private records: Records = EMPTY;
  private listeners = new Set<() => void>();
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  onSaveError: (error: unknown) => void = () => {};

  constructor(private persistence?: Persistence) {}

  getSnapshot = (): Records => this.records;
  getServerSnapshot = (): Records => EMPTY;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Loads saved records, falling back to `seed` when there are none. */
  async load(seed: () => Block[]) {
    let loaded: Record<string, Block> = {};
    try {
      loaded = (await this.persistence?.load()) ?? {};
    } catch (error) {
      this.onSaveError(error);
    }
    if (loaded[ROOT]) {
      this.records = loaded;
    } else {
      this.records = Object.fromEntries(seed().map((block) => [block.id, block]));
      this.persist(this.records);
    }
    this.emit();
  }

  /**
   * Applies ops as one undoable step. Commits sharing a `coalesce` key within
   * a second of each other (typing in one block) merge into a single step.
   */
  commit(ops: Op[], options: { coalesce?: string } = {}) {
    const inverse = this.apply(ops);
    if (inverse.length === 0) return;
    const now = Date.now();
    const top = this.undoStack[this.undoStack.length - 1];
    if (top && options.coalesce && top.coalesce === options.coalesce && now - top.at < COALESCE_MS) {
      top.ops = [...inverse, ...top.ops];
      top.at = now;
    } else {
      this.undoStack.push({ ops: inverse, coalesce: options.coalesce, at: now });
    }
    this.redoStack = [];
  }

  /** Forgets what could be undone, for after changes that must not be reversed (emptying the trash). */
  clearHistory() {
    this.undoStack = [];
    this.redoStack = [];
  }

  /** Runs several commits and folds them into one undo step. */
  batch(run: () => void) {
    const start = this.undoStack.length;
    run();
    const entries = this.undoStack.splice(start);
    if (entries.length) this.undoStack.push({ ops: entries.reverse().flatMap((entry) => entry.ops), at: 0 });
  }

  undo() {
    const entry = this.undoStack.pop();
    if (entry) this.redoStack.push({ ops: this.apply(entry.ops), at: 0 });
  }

  redo() {
    const entry = this.redoStack.pop();
    if (entry) this.undoStack.push({ ops: this.apply(entry.ops), at: 0 });
  }

  private apply(ops: Op[]): Op[] {
    const before = this.records;
    let records = before;
    const inverse: Op[] = [];
    for (const op of ops) {
      const result = applyOp(records, op);
      records = result.records;
      inverse.unshift(...result.inverse);
    }
    if (records === before) return [];
    this.records = records;

    const changed: Record<string, Block | null> = {};
    for (const id of new Set([...Object.keys(before), ...Object.keys(records)])) {
      if (before[id] !== records[id]) changed[id] = records[id] ?? null;
    }
    this.persist(changed);
    this.emit();
    return inverse;
  }

  private persist(changed: Record<string, Block | null>) {
    this.persistence?.save(changed).catch((error) => this.onSaveError(error));
  }

  private emit() {
    for (const listener of this.listeners) listener();
  }
}
