import { htmlToText } from "./dom";
import { toMarkdown } from "./markdown";
import { ROOT, type Block, type Records } from "./store";
import { childrenOf } from "./tree";

export const pageMarkdown = (records: Records, pageId: string) =>
  `# ${htmlToText(records[pageId].text) || "Untitled"}\n\n${toMarkdown(records, childrenOf(records, pageId)).trimEnd()}\n`;

/** Everything in the workspace as one file. Uploaded files are not included, only the notes that refer to them. */
export const backup = (records: Records) => JSON.stringify({ burrow: 1, blocks: Object.values(records) });

/**
 * The blocks of a backup, given fresh ids so they can be added next to what
 * is already here. Its top-level pages are returned separately, to be placed.
 */
export function readBackup(json: string): { blocks: Block[]; top: string[] } {
  const parsed = JSON.parse(json) as { burrow?: number; blocks?: Block[] };
  if (parsed.burrow !== 1 || !Array.isArray(parsed.blocks)) throw new Error("This is not a Burrow backup file.");
  const ids = new Map(parsed.blocks.map((block) => [block.id, block.id === ROOT ? ROOT : crypto.randomUUID()]));
  const fresh = (id: string) => ids.get(id) ?? id;
  const root = parsed.blocks.find((block) => block.id === ROOT);
  const blocks = parsed.blocks
    .filter((block) => block.id !== ROOT && typeof block.id === "string" && Array.isArray(block.content))
    .map((block) => ({
      ...block,
      id: fresh(block.id),
      parent: block.parent === null ? null : fresh(block.parent),
      content: block.content.map(fresh),
      source: block.source && fresh(block.source),
      text: String(block.text ?? "").replace(/href="#([0-9a-f-]{36})"/g, (_, id: string) => `href="#${fresh(id)}"`),
    }));
  return { blocks, top: (root?.content ?? []).map(fresh).filter((id) => blocks.some((block) => block.id === id)) };
}

/** Hands the browser a file to save. */
export function download(name: string, contents: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = Object.assign(document.createElement("a"), { href: url, download: name });
  link.click();
  URL.revokeObjectURL(url);
}
