import { htmlToText } from "./dom";
import { ROOT, type Records } from "./store";
import { isTrashed, pageTrail } from "./tree";

export interface SearchResult {
  page: string;
  /** The matching block, when the match is in the page's text rather than its title. */
  block?: string;
  title: string;
  snippet?: string;
}

/** Pages whose title matches, then pages with a matching block, skipping anything in the trash. */
export function search(records: Records, query: string, limit = 20): SearchResult[] {
  const wanted = query.trim().toLowerCase();
  if (!wanted) return [];
  const titles: SearchResult[] = [];
  const texts: SearchResult[] = [];
  const title = (id: string) => htmlToText(records[id]?.text ?? "") || "Untitled";
  for (const block of Object.values(records)) {
    if (block.id === ROOT || block.type === "shared" || !block.text) continue;
    const text = htmlToText(block.text);
    const at = text.toLowerCase().indexOf(wanted);
    if (at < 0 || isTrashed(records, block.id)) continue;
    if (block.type === "page") titles.push({ page: block.id, title: text });
    else {
      const page = pageTrail(records, block.id).at(-1);
      if (page) texts.push({ page, block: block.id, title: title(page), snippet: text.slice(Math.max(0, at - 30), at + wanted.length + 50) });
    }
  }
  return [...titles, ...texts].slice(0, limit);
}

/**
 * Inline HTML with each mention showing the mentioned page's current title.
 * What is stored keeps the title from when the mention was typed, so this is
 * applied wherever text is shown.
 */
export function liveMentions(html: string, records: Records): string {
  if (!html.includes('href="#')) return html;
  return html.replace(/(<a href="#([0-9a-f-]{36})">)([^<]*)(<\/a>)/g, (whole, open: string, id: string, _old: string, close: string) => {
    const page = records[id];
    if (page?.type !== "page") return whole;
    const title = (htmlToText(page.text) || "Untitled").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return open + title + close;
  });
}

/** Blocks whose reminder time has come and that haven't been announced yet. */
export function dueReminders(records: Records, now: number) {
  return Object.values(records).filter((block) => block.remind !== undefined && block.remind <= now && !block.reminded && !isTrashed(records, block.id));
}

/** Pages with a link or mention pointing at `pageId`. */
export function backlinks(records: Records, pageId: string): string[] {
  const needle = `href="#${pageId}"`;
  const pages = new Set<string>();
  for (const block of Object.values(records)) {
    if (!block.text.includes(needle) || isTrashed(records, block.id)) continue;
    const page = pageTrail(records, block.id).at(-1);
    if (page && page !== pageId) pages.add(page);
  }
  return [...pages];
}

/** Every link between two live pages, for the graph: sub-page relations and mentions. */
export function pageLinks(records: Records): { from: string; to: string; kind: "child" | "mention" }[] {
  const links: { from: string; to: string; kind: "child" | "mention" }[] = [];
  for (const block of Object.values(records)) {
    if (block.id === ROOT || isTrashed(records, block.id)) continue;
    const from = pageTrail(records, block.id).at(-1);
    if (!from) continue;
    if (block.type === "page") {
      const parent = pageTrail(records, block.id).at(-2);
      if (parent) links.push({ from: parent, to: block.id, kind: "child" });
    }
    for (const match of block.text.matchAll(/href="#([0-9a-f-]{36})"/g)) {
      const to = match[1];
      if (records[to]?.type === "page" && !isTrashed(records, to) && to !== from) links.push({ from, to, kind: "mention" });
    }
  }
  return links;
}
