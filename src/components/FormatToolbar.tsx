"use client";

import { useState } from "react";
import { createTitledPage } from "@/lib/commands";
import { COLORS, htmlToText } from "@/lib/dom";
import { findPageByTitle, linkablePages, pageLinkHtml } from "@/lib/links";
import { store, useRecords } from "@/lib/workspace";

/** Where to pin the toolbar: by its bottom edge above the selection, or by its top edge below it. */
export type Anchor = { left: number } & ({ top: number } | { bottom: number });

/** Above the selection, so opening the palette grows away from the text; below it when there is no room. */
export const anchorFor = (rect: DOMRect): Anchor =>
  rect.top > 130 ? { left: rect.left, bottom: window.innerHeight - rect.top + 8 } : { left: rect.left, top: rect.bottom + 8 };

const selectedRange = () => {
  const selection = window.getSelection();
  return selection?.rangeCount ? { selection, range: selection.getRangeAt(0) } : null;
};

const enclosing = (range: Range, selector: string) => {
  const container = range.commonAncestorContainer;
  const element = (container instanceof Element ? container : container.parentElement)?.closest(selector);
  return element?.closest(".editable") ? element : null;
};

/**
 * Replaces an element with its children and selects them. Removing a node
 * collapses any selection inside it, and the next toolbar press needs one.
 */
function unwrap(element: Element) {
  const nodes = Array.from(element.childNodes);
  element.replaceWith(...nodes);
  const selection = window.getSelection();
  if (!nodes.length || !nodes[0].isConnected || !selection) return;
  const range = document.createRange();
  range.setStartBefore(nodes[0]);
  range.setEndAfter(nodes[nodes.length - 1]);
  selection.removeAllRanges();
  selection.addRange(range);
}

/** Wraps the selection in <code>, or unwraps it when it is already inside one. */
function toggleInlineCode() {
  const current = selectedRange();
  if (!current) return;
  const code = enclosing(current.range, "code");
  if (code) return unwrap(code);
  const wrapper = document.createElement("code");
  wrapper.append(current.range.extractContents());
  current.range.insertNode(wrapper);
  current.selection.selectAllChildren(wrapper);
}

function createLink() {
  const current = selectedRange();
  const range = current?.range.cloneRange();
  const entered = window.prompt("Link to (leave empty to remove the link)", "https://");
  if (entered === null || !current || !range) return;
  // the prompt takes focus away from the block
  range.startContainer.parentElement?.closest<HTMLElement>(".editable")?.focus();
  current.selection.removeAllRanges();
  current.selection.addRange(range);
  const url = entered.trim();
  if (!url || url === "https://") return void document.execCommand("unlink");
  document.execCommand("createLink", false, /^(https?:|mailto:)/i.test(url) ? url : `https://${url}`);
}

/** Sets or clears (`value` null) the text colour or highlight of the selection. */
function applyColor(attribute: "data-color" | "data-bg", value: string | null) {
  const current = selectedRange();
  if (!current) return;
  const { selection, range } = current;
  const clear = (span: Element) => {
    span.removeAttribute(attribute);
    if (span.attributes.length === 0) unwrap(span);
  };

  // A selection inside an already coloured span recolours or clears that whole span.
  const outer = enclosing(range, `span[${attribute}]`);
  if (outer) return value ? outer.setAttribute(attribute, value) : clear(outer);

  const fragment = range.extractContents();
  fragment.querySelectorAll(`span[${attribute}]`).forEach(clear);
  const wrapper = document.createElement("span");
  wrapper.append(fragment);
  range.insertNode(wrapper);
  selection.selectAllChildren(wrapper);
  if (value) wrapper.setAttribute(attribute, value);
  else unwrap(wrapper);
}

const FORMATS: { label: string; title: string; className?: string; run: () => void }[] = [
  { label: "B", title: "Bold", className: "font-bold", run: () => document.execCommand("bold") },
  { label: "I", title: "Italic", className: "italic", run: () => document.execCommand("italic") },
  { label: "U", title: "Underline", className: "underline", run: () => document.execCommand("underline") },
  { label: "S", title: "Strikethrough", className: "line-through", run: () => document.execCommand("strikeThrough") },
  { label: "</>", title: "Inline code", className: "font-mono text-xs", run: toggleInlineCode },
  { label: "Link", title: "Link", run: createLink },
];

const button = "h-7 min-w-7 rounded px-1.5 text-sm hover:bg-muted";

export function FormatToolbar({ at }: { at: Anchor }) {
  const [palette, setPalette] = useState(false);
  // linking the selected words to a page: the selection is kept here while the page's name is typed
  const [linking, setLinking] = useState<Range | null>(null);
  const [query, setQuery] = useState("");
  const records = useRecords();
  const wanted = query.trim().toLowerCase();
  const matches = linking
    ? linkablePages(records)
        .filter((page) => htmlToText(page.text).toLowerCase().includes(wanted))
        .slice(0, 6)
    : [];
  const canCreate = wanted !== "" && !findPageByTitle(records, query);

  const linkTo = (pageId: string) => {
    if (!linking) return;
    const container = linking.startContainer;
    (container instanceof Element ? container : container.parentElement)?.closest<HTMLElement>(".editable")?.focus();
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(linking);
    // the words stay as they are; only where they lead is new
    document.execCommand("insertHTML", false, pageLinkHtml(pageId, linking.toString(), true));
    setLinking(null);
    setQuery("");
  };

  // mousedown, not click: the text selection the format applies to must survive the press
  const press = (run: () => void) => (event: React.MouseEvent) => {
    event.preventDefault();
    // the selection can start on the block element itself, not only on text inside it
    const node = window.getSelection()?.anchorNode;
    const el = (node instanceof Element ? node : node?.parentElement)?.closest<HTMLElement>(".editable");
    run();
    // direct DOM edits (code, colours) fire no input event of their own
    el?.dispatchEvent(new Event("input", { bubbles: true }));
  };

  const swatches = (attribute: "data-color" | "data-bg", label: string) => (
    <div className="flex items-center gap-1">
      <span className="w-16 text-xs text-subtle">{label}</span>
      <button
        type="button"
        aria-label={`${label}: default`}
        className="h-6 w-6 rounded border border-border text-xs hover:bg-muted"
        onMouseDown={press(() => applyColor(attribute, null))}
      >
        ×
      </button>
      {COLORS.map((color) => (
        <button
          key={color}
          type="button"
          aria-label={`${label}: ${color}`}
          className="editable h-6 w-6 rounded border border-border text-sm font-semibold"
          onMouseDown={press(() => applyColor(attribute, color))}
        >
          <span {...{ [attribute]: color }} className="block rounded">
            A
          </span>
        </button>
      ))}
    </div>
  );

  return (
    <div
      role="toolbar"
      aria-label="Text formatting"
      className="fixed z-20 rounded-xl glass p-0.5"
      style={at}
    >
      <div className="flex">
        {FORMATS.map((format) => (
          <button
            key={format.title}
            type="button"
            title={format.title}
            aria-label={format.title}
            className={`${button} ${format.className ?? ""}`}
            onMouseDown={press(format.run)}
          >
            {format.label}
          </button>
        ))}
        <button
          type="button"
          title="Link to a page"
          aria-label="Link to a page"
          aria-expanded={!!linking}
          className={button}
          onMouseDown={(event) => {
            event.preventDefault();
            const current = selectedRange();
            setLinking(linking || !current ? null : current.range.cloneRange());
          }}
        >
          [[ ]]
        </button>
        <button
          type="button"
          title="Colour"
          aria-label="Colour"
          aria-expanded={palette}
          className={`${button} underline decoration-accent decoration-2`}
          onMouseDown={(event) => {
            event.preventDefault();
            setPalette((open) => !open);
          }}
        >
          A
        </button>
      </div>
      {linking && (
        <div className="flex w-64 flex-col gap-1 border-t border-border p-1.5">
          <input
            autoFocus
            aria-label="Page to link to"
            placeholder="Page name…"
            className="rounded border border-border bg-background px-1.5 py-0.5 text-sm outline-none"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setLinking(null);
              if (event.key !== "Enter") return;
              event.preventDefault();
              if (matches[0]) linkTo(matches[0].id);
              else if (canCreate) linkTo(createTitledPage(store, query.trim()));
            }}
          />
          {matches.map((page) => (
            <button key={page.id} type="button" className="truncate rounded px-1.5 py-0.5 text-left text-sm hover:bg-muted" onClick={() => linkTo(page.id)}>
              {page.icon ?? "📄"} {htmlToText(page.text) || "Untitled"}
            </button>
          ))}
          {canCreate && (
            <button type="button" className="truncate rounded px-1.5 py-0.5 text-left text-sm hover:bg-muted" onClick={() => linkTo(createTitledPage(store, query.trim()))}>
              ＋ Create page “{query.trim()}”
            </button>
          )}
        </div>
      )}
      {palette && (
        <div className="flex flex-col gap-1 border-t border-border p-1.5">
          {swatches("data-color", "Text")}
          {swatches("data-bg", "Highlight")}
        </div>
      )}
    </div>
  );
}
