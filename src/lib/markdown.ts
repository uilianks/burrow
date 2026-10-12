import { htmlToText } from "./dom";
import { toTable } from "./database";
import type { BlockType, Records } from "./store";
import { childrenOf } from "./tree";

/** A block read from Markdown, before it has an id or a parent. */
export interface ParsedBlock {
  type: BlockType;
  text: string;
  depth: number;
  checked?: boolean;
  language?: string;
  /** Read from HTML only: a table's cells, or an image's address. */
  table?: string[][];
  url?: string;
}

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Inline Markdown to the inline HTML blocks store. Code spans are left unformatted. */
export function inlineToHtml(markdown: string): string {
  return markdown
    .split(/(`[^`]+`)/)
    .map((part) =>
      /^`[^`]+`$/.test(part)
        ? `<code>${escapeHtml(part.slice(1, -1))}</code>`
        : escapeHtml(part)
            .replace(
              /\[([^\]]+)\]\(((?:https?:|mailto:)[^\s)]+)\)/g,
              (_, label: string, url: string) => `<a href="${url.replace(/"/g, "%22")}">${label}</a>`,
            )
            .replace(/\$\$([^$]+)\$\$/g, (_, latex: string) => `<span data-math="${latex.replace(/"/g, "&quot;")}">${latex}</span>`)
            .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
            .replace(/~~([^~]+)~~/g, "<s>$1</s>")
            .replace(/(^|[^*\w])\*([^*\s][^*]*)\*/g, "$1<i>$2</i>"),
    )
    .join("");
}

/** Stored inline HTML to Markdown. Underline and colours have no Markdown form and are dropped. */
export function htmlToMarkdown(html: string): string {
  return htmlToText(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<span data-math="[^"]*">([^<]*)<\/span>/gi, "$$$$$1$$$$")
      .replace(/<(b|strong)>([\s\S]*?)<\/\1>/gi, "**$2**")
      .replace(/<(i|em)>([\s\S]*?)<\/\1>/gi, "*$2*")
      .replace(/<(s|strike)>([\s\S]*?)<\/\1>/gi, "~~$2~~")
      .replace(/<code>([\s\S]*?)<\/code>/gi, "`$1`")
      .replace(/<a href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)"),
  );
}

const PREFIX: Partial<Record<BlockType, string>> = {
  h1: "# ",
  h2: "## ",
  h3: "### ",
  bullet: "- ",
  toggle: "- ",
  numbered: "1. ",
  quote: "> ",
  callout: "> ",
};

/** The given blocks, and everything nested in them, as Markdown indented two spaces per level. */
export function toMarkdown(records: Records, ids: string[], depth = 0): string {
  const indent = "  ".repeat(depth);
  const lines: string[] = [];
  for (const id of ids) {
    const block = records[id];
    if (!block) continue;
    if (block.trashed) continue;
    const children = block.type === "page" ? [] : childrenOf(records, id);
    if (block.type === "columns" || block.type === "column" || block.type === "synced") {
      // layout only: their blocks read as if they were written in place
      if (children.length) lines.push(toMarkdown(records, children, depth));
      continue;
    }
    if (block.type === "toc") continue;
    if (block.type === "database") {
      const rows = block.content.map((row) => records[row]).filter((row) => row && !row.trashed);
      const table = toTable(rows, block.schema ?? []).map((cells) => `${indent}| ${cells.map((cell) => cell.replace(/\|/g, "\\|")).join(" | ")} |`);
      table.splice(1, 0, `${indent}|${(block.schema ?? []).map(() => " --- |").join("")} --- |`);
      lines.push(`${indent}**${htmlToText(block.text) || "Untitled database"}**`, ...table);
      continue;
    }
    if (block.type === "divider") lines.push(`${indent}---`);
    else if (block.type === "image") lines.push(`${indent}![${block.name ?? ""}](${block.url ?? ""})`);
    else if (block.type === "video" || block.type === "audio" || block.type === "file" || block.type === "embed") {
      lines.push(`${indent}[${block.name ?? block.url ?? block.type}](${block.url ?? ""})`);
    } else if (block.type === "bookmark") lines.push(`${indent}[${htmlToText(block.text) || block.url}](${block.url ?? ""})`);
    else if (block.type === "equation") lines.push(`${indent}$$ ${block.text} $$`);
    else if (block.type === "table") {
      const table = block.table ?? [];
      const row = (cells: string[]) => `${indent}| ${cells.join(" | ")} |`;
      lines.push(...table.map((cells) => row(cells.map((cell) => cell.replace(/\|/g, "\\|")))));
      if (table.length) lines.splice(lines.length - table.length + 1, 0, row(table[0].map(() => "---")));
    } else if (block.type === "page") lines.push(`${indent}[${htmlToText(block.text) || "Untitled"}](#${id})`);
    else if (block.type === "code") {
      const code = htmlToText(block.text.replace(/<br\s*\/?>/gi, "\n"));
      lines.push(...["```" + (block.language ?? ""), ...code.split("\n"), "```"].map((line) => indent + line));
    } else {
      const prefix = block.type === "todo" ? (block.checked ? "- [x] " : "- [ ] ") : (PREFIX[block.type] ?? "");
      lines.push(indent + prefix + htmlToMarkdown(block.text).replace(/\n/g, " "));
    }
    if (children.length) lines.push(toMarkdown(records, children, depth + 1));
  }
  return lines.join("\n");
}

const LINE_KINDS: [RegExp, (match: RegExpExecArray) => Omit<ParsedBlock, "depth">][] = [
  [/^(#{1,3})\s+(.*)$/, (m) => ({ type: `h${m[1].length}` as BlockType, text: inlineToHtml(m[2]) })],
  [/^[-*+]\s+\[([ xX])\]\s+(.*)$/, (m) => ({ type: "todo", text: inlineToHtml(m[2]), checked: m[1] !== " " })],
  [/^(?:-{3,}|\*{3,})$/, () => ({ type: "divider", text: "" })],
  [/^[-*+]\s+(.*)$/, (m) => ({ type: "bullet", text: inlineToHtml(m[1]) })],
  [/^\d+[.)]\s+(.*)$/, (m) => ({ type: "numbered", text: inlineToHtml(m[1]) })],
  [/^>\s?(.*)$/, (m) => ({ type: "quote", text: inlineToHtml(m[1]) })],
];

/** Reads Markdown (or plain multi-line text) into blocks. Two spaces or a tab of indent is one level. */
export function fromMarkdown(markdown: string): ParsedBlock[] {
  const blocks: ParsedBlock[] = [];
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const indent = /^[ \t]*/.exec(lines[i])![0];
    const depth = Math.floor(indent.replace(/\t/g, "  ").length / 2);
    const line = lines[i].slice(indent.length).trimEnd();
    if (!line) continue;

    const fence = /^```\s*([\w+-]*)$/.exec(line);
    if (fence) {
      const code: string[] = [];
      for (i++; i < lines.length && lines[i].trim() !== "```"; i++) {
        code.push(lines[i].startsWith(indent) ? lines[i].slice(indent.length) : lines[i]);
      }
      blocks.push({ type: "code", text: escapeHtml(code.join("\n")), depth, language: fence[1] || undefined });
      continue;
    }

    let parsed: Omit<ParsedBlock, "depth"> = { type: "text", text: inlineToHtml(line) };
    for (const [pattern, build] of LINE_KINDS) {
      const match = pattern.exec(line);
      if (match) {
        parsed = build(match);
        break;
      }
    }
    blocks.push({ ...parsed, depth });
  }
  return blocks;
}
