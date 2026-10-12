import { describe, expect, it } from "vitest";
import { deleteBlocks, insertParsed } from "./commands";
import { tokenize } from "./highlight";
import { fromMarkdown, htmlToMarkdown, inlineToHtml, toMarkdown } from "./markdown";
import { ROOT, Store } from "./store";

const SAMPLE = [
  "# Title",
  "Some **bold**, *italic*, ~~gone~~ and `a < b` with a [link](https://example.com/?a=1&b=2)",
  "- parent",
  "  - child",
  "    - grandchild",
  "- [x] done",
  "- [ ] open",
  "1. first",
  "> quoted",
  "---",
  "```python",
  "if x < 1:",
  "    return '<b>'",
  "```",
].join("\n");

async function workspace() {
  const store = new Store();
  await store.load(() => [{ id: ROOT, type: "page", text: "", parent: null, content: [] }]);
  return store;
}

describe("markdown", () => {
  it("reads block types, nesting and inline formatting", () => {
    const blocks = fromMarkdown(SAMPLE);
    expect(blocks.map((b) => `${b.depth}:${b.type}`)).toEqual([
      "0:h1", "0:text", "0:bullet", "1:bullet", "2:bullet", "0:todo", "0:todo", "0:numbered", "0:quote", "0:divider", "0:code",
    ]);
    expect(blocks[1].text).toBe(
      'Some <b>bold</b>, <i>italic</i>, <s>gone</s> and <code>a &lt; b</code> with a <a href="https://example.com/?a=1&amp;b=2">link</a>',
    );
    expect(blocks[5].checked).toBe(true);
    expect(blocks[10]).toMatchObject({ language: "python", text: "if x &lt; 1:\n    return '&lt;b&gt;'" });
  });

  it("never lets pasted markup through as HTML", () => {
    expect(inlineToHtml('<img src=x onerror=alert(1)> [x](javascript:alert(1))')).toBe(
      "&lt;img src=x onerror=alert(1)&gt; [x](javascript:alert(1))",
    );
  });

  it("round-trips through the store", async () => {
    const store = await workspace();
    const ids = insertParsed(store, ROOT, null, fromMarkdown(SAMPLE));
    const records = store.getSnapshot();
    expect(records[ROOT].content).toHaveLength(9);
    expect(records[ids[3]].parent).toBe(ids[2]);
    expect(records[ids[4]].parent).toBe(ids[3]);
    expect(toMarkdown(records, records[ROOT].content)).toBe(SAMPLE);
  });

  it("inserts after a given block and clamps impossible indentation", async () => {
    const store = await workspace();
    const [first] = insertParsed(store, ROOT, null, fromMarkdown("one"));
    const added = insertParsed(store, ROOT, first, fromMarkdown("      deep\ntwo"));
    expect(store.getSnapshot()[ROOT].content).toEqual([first, ...added]);
    deleteBlocks(store, added);
    expect(store.getSnapshot()[ROOT].content).toEqual([first]);
    store.undo();
    expect(store.getSnapshot()[ROOT].content).toEqual([first, ...added]);
  });

  it("drops formatting Markdown cannot express", () => {
    expect(htmlToMarkdown('<u>under</u> <span data-color="red">red</span> a<br>b &amp; c')).toBe("under red a\nb & c");
  });
});

describe("tokenize", () => {
  const kinds = (text: string, language: string) =>
    tokenize(text, language).map((t) => `${t.kind}:${text.slice(t.start, t.end)}`);

  it("finds keywords, strings, numbers and comments", () => {
    expect(kinds('const n = 42; // "not a string"\nreturn `a\nb`', "javascript")).toEqual([
      "keyword:const", "number:42", 'comment:// "not a string"', "keyword:return", "string:`a\nb`",
    ]);
    expect(kinds("SELECT 'it''s' -- done", "sql")).toEqual(["keyword:SELECT", "string:'it'", "string:'s'", "comment:-- done"]);
    expect(kinds("x = 'unterminated\ny", "python")).toEqual(["string:'unterminated\n"]);
  });

  it("returns nothing for plain or unknown languages", () => {
    expect(tokenize("const x = 1", "plain")).toEqual([]);
    expect(tokenize("const x = 1", undefined)).toEqual([]);
  });
});
