export type TokenKind = "keyword" | "string" | "comment" | "number";

export interface Token {
  kind: TokenKind;
  start: number;
  end: number;
}

export const LANGUAGES = [
  { id: "plain", label: "Plain text" },
  { id: "javascript", label: "JavaScript / TypeScript" },
  { id: "python", label: "Python" },
  { id: "rust", label: "Rust" },
  { id: "go", label: "Go" },
  { id: "sql", label: "SQL" },
  { id: "json", label: "JSON" },
  { id: "shell", label: "Shell" },
  { id: "mermaid", label: "Mermaid diagram" },
];

const ALIASES: Record<string, string> = { js: "javascript", ts: "javascript", typescript: "javascript", tsx: "javascript", jsx: "javascript", py: "python", rs: "rust", golang: "go", sh: "shell", bash: "shell", zsh: "shell" };

/** The id of a supported language for a name as written after a Markdown code fence. */
export const languageId = (name: string | undefined) => {
  const id = ALIASES[name?.toLowerCase() ?? ""] ?? name?.toLowerCase();
  return LANGUAGES.some((language) => language.id === id) ? id! : "plain";
};

const words = (list: string) => new Set(list.split(" "));
const KEYWORDS: Record<string, Set<string>> = {
  javascript: words(
    "async await break case catch class const continue default delete do else export extends false finally for from function if import in instanceof interface let new null of return static super switch this throw true try type typeof undefined var void while yield",
  ),
  python: words(
    "and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield",
  ),
  rust: words(
    "as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while",
  ),
  go: words(
    "break case chan const continue default defer else fallthrough false for func go goto if import interface map nil package range return select struct switch true type var",
  ),
  sql: words(
    "select from where and or not null is in like between join inner left right outer on group by order having limit offset insert into values update set delete create table alter drop index primary key foreign references as distinct union all case when then else end true false",
  ),
  json: words("true false null"),
  shell: words("if then else elif fi for in do done while until case esac function return export local echo exit cd"),
};
const LINE_COMMENT: Record<string, string> = { javascript: "//", rust: "//", go: "//", python: "#", shell: "#", sql: "--" };
const BLOCK_COMMENTS = new Set(["javascript", "rust", "go", "sql"]);
const WORD = /[A-Za-z_$][\w$]*/y;
const NUMBER = /\d[\w.]*/y;

/** Splits source text into the spans worth colouring. Unknown languages yield none. */
export function tokenize(text: string, language: string | undefined): Token[] {
  const keywords = KEYWORDS[language ?? ""];
  if (!keywords) return [];
  const lineComment = LINE_COMMENT[language!];
  const tokens: Token[] = [];
  const push = (kind: TokenKind, start: number, end: number) => (tokens.push({ kind, start, end }), end);

  for (let i = 0; i < text.length; ) {
    const char = text[i];
    if (lineComment && text.startsWith(lineComment, i)) {
      const end = text.indexOf("\n", i);
      i = push("comment", i, end < 0 ? text.length : end);
    } else if (BLOCK_COMMENTS.has(language!) && text.startsWith("/*", i)) {
      const end = text.indexOf("*/", i + 2);
      i = push("comment", i, end < 0 ? text.length : end + 2);
    } else if (char === '"' || char === "'" || char === "`") {
      let end = i + 1;
      while (end < text.length && text[end] !== char && (char === "`" || text[end] !== "\n")) {
        end += text[end] === "\\" ? 2 : 1;
      }
      i = push("string", i, Math.min(end + 1, text.length));
    } else if (/\d/.test(char)) {
      NUMBER.lastIndex = i;
      i = push("number", i, i + NUMBER.exec(text)![0].length);
    } else if (/[A-Za-z_$]/.test(char)) {
      WORD.lastIndex = i;
      const word = WORD.exec(text)![0];
      if (keywords.has(language === "sql" ? word.toLowerCase() : word)) push("keyword", i, i + word.length);
      i += word.length;
    } else {
      i++;
    }
  }
  return tokens;
}

const KINDS: TokenKind[] = ["keyword", "string", "comment", "number"];
const byBlock = new Map<string, Record<TokenKind, Range[]>>();
let styled = false;

// The colours are attached here rather than in globals.css because the CSS
// build step does not know the ::highlight() pseudo-element yet and warns on it.
function ensureStyles() {
  if (styled) return;
  styled = true;
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(KINDS.map((kind) => `::highlight(burrow-${kind}) { color: var(--tok-${kind}); }`).join("\n"));
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
}

/**
 * Colours a code block through the CSS Custom Highlight API, which paints
 * ranges without touching the DOM, so the caret is never disturbed. Pass a
 * null element to clear the block's highlights.
 */
export function setHighlights(id: string, el: HTMLElement | null, language?: string) {
  if (typeof CSS === "undefined" || !CSS.highlights) return;
  ensureStyles();
  byBlock.delete(id);
  if (el) {
    const nodes: { node: Node; start: number; end: number }[] = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let position = 0;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const length = node.textContent?.length ?? 0;
      nodes.push({ node, start: position, end: position + length });
      position += length;
    }
    const ranges: Record<TokenKind, Range[]> = { keyword: [], string: [], comment: [], number: [] };
    let first = 0;
    for (const token of tokenize(el.textContent ?? "", language)) {
      while (nodes[first] && nodes[first].end <= token.start) first++;
      let last = first;
      while (nodes[last] && nodes[last].end < token.end) last++;
      if (!nodes[first] || !nodes[last]) break;
      const range = document.createRange();
      range.setStart(nodes[first].node, token.start - nodes[first].start);
      range.setEnd(nodes[last].node, token.end - nodes[last].start);
      ranges[token.kind].push(range);
    }
    byBlock.set(id, ranges);
  }
  for (const kind of KINDS) {
    CSS.highlights.set(`burrow-${kind}`, new Highlight(...[...byBlock.values()].flatMap((ranges) => ranges[kind])));
  }
}
