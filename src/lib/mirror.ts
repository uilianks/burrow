import { htmlToText } from "./dom";
import { ROOT, type Records } from "./store";
import { pageMarkdown } from "./transfer";
import { childrenOf } from "./tree";

const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

/** A page title as a file name that is valid on both Windows and Linux. */
export function fileName(title: string): string {
  const name = title
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
    .replace(/[. ]+$/, "");
  return !name ? "Untitled" : RESERVED.test(name) ? `_${name}` : name;
}

/**
 * Every live page as a Markdown file, keyed by its path inside the notes
 * folder's Markdown/ directory. A page's sub-pages and database rows go in a
 * folder named after it. Names that would collide (Windows ignores case) get
 * a number.
 */
export function mirrorFiles(records: Records): Record<string, string> {
  const files: Record<string, string> = {};
  const taken = new Set<string>();

  /** Pages shown on `id`: sub-pages anywhere in its blocks, and the rows of its databases. */
  const pagesOn = (id: string): string[] =>
    childrenOf(records, id).flatMap((child) => {
      const block = records[child];
      if (!block || block.trashed) return [];
      return block.type === "page" ? [child] : pagesOn(child);
    });

  const visit = (id: string, directory: string) => {
    const base = fileName(htmlToText(records[id].text));
    let name = base;
    for (let n = 2; taken.has(`${directory}${name}`.toLowerCase()); n++) name = `${base} ${n}`;
    taken.add(`${directory}${name}`.toLowerCase());
    files[`${directory}${name}.md`] = pageMarkdown(records, id);
    for (const child of pagesOn(id)) visit(child, `${directory}${name}/`);
  };
  for (const page of pagesOn(ROOT)) visit(page, "");
  return files;
}
