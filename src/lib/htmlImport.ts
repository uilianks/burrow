import { sanitize } from "./dom";
import type { ParsedBlock } from "./markdown";
import type { BlockType } from "./store";

const HEADINGS: Record<string, BlockType> = { H1: "h1", H2: "h2", H3: "h3", H4: "h3", H5: "h3", H6: "h3" };
const SKIPPED = new Set(["SCRIPT", "STYLE", "NAV", "HEADER", "FOOTER", "NOSCRIPT", "HEAD", "IFRAME", "FORM"]);

/** The element's inline content as the editor stores it, with nested lists left out (they become their own blocks). */
function inline(element: Element): string {
  const copy = element.cloneNode(true) as Element;
  copy.querySelectorAll("ul, ol, script, style").forEach((nested) => nested.remove());
  return sanitize(copy.innerHTML).replace(/\s+/g, " ").trim();
}

/**
 * A web page as blocks: headings, paragraphs, lists (with nesting), quotes,
 * code, rules, tables and pictures. Anything else is read through to the
 * text inside it. The page's <title> or first <h1> becomes the title.
 */
export function fromHtml(html: string): { title: string; blocks: ParsedBlock[] } {
  const document = new DOMParser().parseFromString(html, "text/html");
  const blocks: ParsedBlock[] = [];
  const push = (type: BlockType, text: string, depth: number, extra: Partial<ParsedBlock> = {}) => {
    if (text || type === "divider" || extra.table || extra.url) blocks.push({ type, text, depth, ...extra });
  };

  const list = (element: Element, depth: number) => {
    for (const item of Array.from(element.children).filter((child) => child.tagName === "LI")) {
      const box = item.querySelector(":scope > input[type=checkbox]") as HTMLInputElement | null;
      push(box ? "todo" : element.tagName === "OL" ? "numbered" : "bullet", inline(item), depth, box ? { checked: box.checked } : {});
      for (const nested of Array.from(item.children).filter((child) => child.tagName === "UL" || child.tagName === "OL")) list(nested, depth + 1);
    }
  };

  const walk = (parent: Element) => {
    for (const element of Array.from(parent.children)) {
      const tag = element.tagName;
      if (SKIPPED.has(tag)) continue;
      if (HEADINGS[tag]) push(HEADINGS[tag], inline(element), 0);
      else if (tag === "P") push("text", inline(element), 0);
      else if (tag === "UL" || tag === "OL") list(element, 0);
      else if (tag === "BLOCKQUOTE") push("quote", inline(element), 0);
      else if (tag === "PRE") push("code", (element.textContent ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").trimEnd(), 0);
      else if (tag === "HR") push("divider", "", 0);
      else if (tag === "TABLE") {
        const table = Array.from(element.querySelectorAll("tr")).map((row) => Array.from(row.children).map((cell) => (cell.textContent ?? "").trim()));
        const width = Math.max(0, ...table.map((row) => row.length));
        if (width) push("table", "", 0, { table: table.map((row) => [...row, ...Array(width - row.length).fill("")]) });
      } else if (tag === "IMG" || tag === "FIGURE") {
        const image = tag === "IMG" ? element : element.querySelector("img");
        const source = image?.getAttribute("src") ?? "";
        if (/^https?:\/\//i.test(source)) push("image", (element.querySelector("figcaption")?.textContent ?? image?.getAttribute("alt") ?? "").trim(), 0, { url: source });
      } else if (element.children.length && Array.from(element.children).some((child) => !["A", "B", "I", "EM", "STRONG", "SPAN", "CODE", "BR", "U", "S"].includes(child.tagName))) walk(element);
      else push("text", inline(element), 0);
    }
  };
  walk(document.body);

  const heading = blocks[0]?.type === "h1" ? blocks.shift()!.text.replace(/<[^>]*>/g, "") : "";
  return { title: heading || document.title.trim(), blocks };
}
