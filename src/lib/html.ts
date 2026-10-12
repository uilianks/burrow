import { display, toTable } from "./database";
import { htmlToText } from "./dom";
import { liveMentions } from "./search";
import type { Block, Records } from "./store";
import { childrenOf } from "./tree";

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const LIST = { bullet: "ul", numbered: "ol", todo: "ul" } as const;

const table = (rows: string[][]) =>
  `<table>${rows.map((cells, r) => `<tr>${cells.map((cell) => `<${r ? "td" : "th"}>${escape(cell)}</${r ? "td" : "th"}>`).join("")}</tr>`).join("")}</table>`;

function blocksHtml(records: Records, ids: string[]): string {
  const out: string[] = [];
  // the kind of list currently open; a run of bullets and a run of to-dos are separate lists
  let open: keyof typeof LIST | null = null;
  const close = () => {
    if (open) out.push(`</${LIST[open]}>`);
    open = null;
  };
  for (const id of ids) {
    const block = records[id];
    if (!block || block.trashed) continue;
    // Block text is already the small, sanitized set of inline tags the editor allows.
    const text = liveMentions(block.text, records);
    const inside = block.type === "page" || block.type === "database" ? "" : blocksHtml(records, childrenOf(records, id));
    const wanted = block.type in LIST ? (block.type as keyof typeof LIST) : null;
    if (wanted !== open) close();
    if (wanted) {
      if (!open) out.push(`<${LIST[(open = wanted)]}${wanted === "todo" ? ' class="todo"' : ""}>`);
      out.push(`<li>${wanted === "todo" ? (block.checked ? "☑ " : "☐ ") : ""}${text}${inside}</li>`);
      continue;
    }
    out.push(one(records, block, text, inside));
  }
  close();
  return out.join("\n");
}

function one(records: Records, block: Block, text: string, inside: string): string {
  switch (block.type) {
    case "h1":
    case "h2":
    case "h3": {
      // the page title is the document's h1, so headings step down one level
      const tag = `h${Number(block.type[1]) + 1}`;
      return block.toggleable ? `<details open><summary><${tag}>${text}</${tag}></summary>${inside}</details>` : `<${tag}>${text}</${tag}>${inside}`;
    }
    case "toggle":
    case "button":
      return `<details><summary>${text}</summary>${inside}</details>`;
    case "quote":
      return `<blockquote>${text}${inside}</blockquote>`;
    case "callout":
      return `<aside>${text}${inside}</aside>`;
    case "code":
      return `<pre><code>${text}</code></pre>`;
    case "divider":
      return "<hr>";
    case "equation":
      return `<pre class="equation">${escape(block.text)}</pre>`;
    case "table":
      return table(block.table ?? []);
    case "database":
      return `<h3>${escape(htmlToText(block.text) || "Untitled database")}</h3>${table(
        toTable(block.content.map((row) => records[row]).filter((row) => row && !row.trashed), block.schema ?? [], records),
      )}`;
    case "columns":
      return `<div class="columns">${block.content.map((column) => `<div>${blocksHtml(records, childrenOf(records, column))}</div>`).join("")}</div>`;
    case "synced":
      return inside;
    case "image":
      return block.url ? `<figure><img src="${escape(block.url)}" alt="${escape(block.text)}"><figcaption>${escape(block.text)}</figcaption></figure>` : `<p><em>[Image: ${escape(block.name ?? "")}]</em></p>`;
    case "video":
    case "audio":
    case "file":
    case "embed":
    case "bookmark":
      return block.url ? `<p><a href="${escape(block.url)}">${escape(htmlToText(block.text) || block.name || block.url)}</a></p>` : `<p><em>[${escape(block.name ?? block.type)}]</em></p>`;
    case "page":
      return `<p>📄 ${escape(htmlToText(block.text) || "Untitled")}</p>`;
    case "text":
      return `<p>${text}</p>${inside}`;
    default:
      // layout-only and plugin blocks have nothing of their own to print
      return inside;
  }
}

const STYLE =
  "body{font:16px/1.6 system-ui,sans-serif;max-width:46rem;margin:3rem auto;padding:0 1rem;color:#1f1f1f}" +
  "ul.todo{list-style:none;padding-left:0}blockquote{border-left:3px solid #1f1f1f;margin:0;padding-left:1rem}" +
  "aside,pre{background:#f6f5f3;border-radius:6px;padding:.75rem}pre{overflow:auto}table{border-collapse:collapse}" +
  "td,th{border:1px solid #e4e2dd;padding:.25rem .5rem;text-align:left}.columns{display:flex;gap:2rem}.columns>div{flex:1;min-width:0}" +
  "img{max-width:100%}hr{border:0;border-top:1px solid #e4e2dd}a{color:#2f7de1}";

/** A page as one self-contained web page: open it in any browser, or print it to PDF from there. */
export function pageHtml(records: Records, pageId: string): string {
  const title = escape(htmlToText(records[pageId].text) || "Untitled");
  const props = records[records[pageId].parent ?? ""]?.schema?.map((property) => [property.name, display(records[pageId].props?.[property.id] as never)]).filter(([, value]) => value) ?? [];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${STYLE}</style>
</head>
<body>
<h1>${title}</h1>
${props.length ? table(props) : ""}
${blocksHtml(records, childrenOf(records, pageId))}
</body>
</html>
`;
}
