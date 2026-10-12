import type { Block, BlockType } from "./store";

/** One entry in the slash and "turn into" menus. */
export interface BlockKind {
  key: string;
  type: BlockType;
  toggleable?: true;
  /** For a block kind added by a plugin: its key ("<plugin id>/<block id>"). */
  plugin?: string;
  /** For a columns kind, how many columns to start with. */
  columns?: number;
  label: string;
  hint: string;
}

export const BLOCK_KINDS: BlockKind[] = [
  { key: "text", type: "text", label: "Text", hint: "Plain paragraph" },
  { key: "h1", type: "h1", label: "Heading 1", hint: "Large section heading" },
  { key: "h2", type: "h2", label: "Heading 2", hint: "Medium section heading" },
  { key: "h3", type: "h3", label: "Heading 3", hint: "Small section heading" },
  { key: "todo", type: "todo", label: "To-do list", hint: "Checkbox item" },
  { key: "bullet", type: "bullet", label: "Bulleted list", hint: "Simple bullet" },
  { key: "numbered", type: "numbered", label: "Numbered list", hint: "Ordered item" },
  { key: "toggle", type: "toggle", label: "Toggle list", hint: "Hide and show nested blocks" },
  { key: "th1", type: "h1", toggleable: true, label: "Toggle heading 1", hint: "Large heading that folds" },
  { key: "th2", type: "h2", toggleable: true, label: "Toggle heading 2", hint: "Medium heading that folds" },
  { key: "th3", type: "h3", toggleable: true, label: "Toggle heading 3", hint: "Small heading that folds" },
  { key: "button", type: "button", label: "Template button", hint: "Adds a copy of the blocks inside it" },
  { key: "quote", type: "quote", label: "Quote", hint: "Quoted text" },
  { key: "callout", type: "callout", label: "Callout", hint: "Highlighted note" },
  { key: "code", type: "code", label: "Code", hint: "Monospaced block with highlighting" },
  { key: "divider", type: "divider", label: "Divider", hint: "Horizontal line" },
  { key: "page", type: "page", label: "Page", hint: "Sub-page inside this page" },
  { key: "image", type: "image", label: "Image", hint: "Upload or link a picture" },
  { key: "video", type: "video", label: "Video", hint: "Upload or link a video" },
  { key: "audio", type: "audio", label: "Audio", hint: "Upload or link a sound file" },
  { key: "file", type: "file", label: "File", hint: "Attach any file" },
  { key: "bookmark", type: "bookmark", label: "Web bookmark", hint: "Link shown as a card" },
  { key: "embed", type: "embed", label: "Embed", hint: "YouTube, Vimeo, maps and other pages" },
  { key: "equation", type: "equation", label: "Equation", hint: "Math written in LaTeX" },
  { key: "table", type: "table", label: "Table", hint: "Simple rows and columns" },
  { key: "toc", type: "toc", label: "Table of contents", hint: "Links to this page's headings" },
  { key: "columns2", type: "columns", columns: 2, label: "2 columns", hint: "Blocks side by side" },
  { key: "columns3", type: "columns", columns: 3, label: "3 columns", hint: "Blocks side by side" },
  { key: "synced", type: "synced", label: "Synced block", hint: "Same content on several pages" },
  { key: "database", type: "database", label: "Database", hint: "Rows with properties, as table, board, calendar…" },
];

const TEXT_TYPES = new Set<BlockType>(["text", "h1", "h2", "h3", "todo", "toggle", "button", "bullet", "numbered", "quote", "callout", "code"]);

/** Blocks that are a line of text: you can type in them, nest under them and turn them into each other. */
export const isEditable = (block: Block) => TEXT_TYPES.has(block.type);
export const isTextKind = (kind: BlockKind) => TEXT_TYPES.has(kind.type);
/** Blocks whose children sit at the top level of a writing area, rather than nested under a line. */
export const isContainer = (block: Block | undefined) =>
  block?.type === "page" || block?.type === "column" || block?.type === "shared";
/** Blocks that fold: what is nested in them can be hidden, and Enter inside an open one writes into it. */
export const isToggle = (block: Block) => block.type === "toggle" || block.type === "button" || !!block.toggleable;

/** Fields that only make sense for one kind of block, cleared whenever the kind changes. */
const RESET = { checked: undefined, collapsed: undefined, toggleable: undefined, language: undefined };

export const kindPatch = (kind: BlockKind): Partial<Block> => ({ ...RESET, type: kind.type, toggleable: kind.toggleable });
export const AS_TEXT: Partial<Block> = { ...RESET, type: "text" };
