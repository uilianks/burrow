"use client";

import { useEffect, useLayoutEffect, useRef, type ClipboardEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { BLOCK_KINDS, isEditable, isTextKind, isToggle, kindPatch } from "@/lib/blockKinds";
import { duplicateBlock, removeBlocks, stampTemplate } from "@/lib/commands";
import { htmlToText, sanitize, setCaret, textLength } from "@/lib/dom";
import { LANGUAGES, languageId, setHighlights } from "@/lib/highlight";
import { drawMath, renderMath } from "@/lib/math";
import type { Block, BlockType, Op } from "@/lib/store";
import { guarded, usePlugins } from "@/lib/plugins";
import { usePrefs } from "@/lib/prefs";
import { openPage, store, useRecords } from "@/lib/workspace";
import { DatabaseBlock } from "./Database";
import { BookmarkBlock, EmbedBlock, EquationBlock, MediaBlock, MermaidPreview, TableBlock, TocBlock } from "./richBlocks";

const TEXT_STYLE: Partial<Record<BlockType, string>> = {
  h1: "text-3xl font-bold mt-6",
  h2: "text-2xl font-semibold mt-4",
  h3: "text-xl font-semibold mt-2",
  quote: "border-l-2 border-foreground pl-3",
  code: "font-mono text-sm rounded bg-muted p-3 pt-7",
};
const ALIGN = { center: "text-center", right: "text-right" };
// lines the fold arrow of a toggle heading up with the heading's first line
const HEADING_ARROW_OFFSET: Partial<Record<BlockType, string>> = { h1: "mt-8", h2: "mt-5", h3: "mt-2.5" };

export type EditableProps = {
  id: string;
  html: string;
  className?: string;
  placeholder?: string;
  placeholderAlways?: boolean;
  onInput: (el: HTMLElement) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  onPaste: (event: ClipboardEvent<HTMLElement>) => void;
  onFocus: () => void;
  onBlur: () => void;
  /** The page is locked: the text can be read and selected, not changed. */
  locked?: boolean;
};

const openLink = (event: MouseEvent<HTMLElement>) => {
  const link = (event.target as HTMLElement).closest("a");
  const href = link?.getAttribute("href");
  const math = (event.target as HTMLElement).closest<HTMLElement>("[data-math]");
  if (math && event.currentTarget.isContentEditable) {
    // inline math is one unit in the text: clicking it edits its LaTeX
    const latex = window.prompt("LaTeX (leave empty to remove)", math.getAttribute("data-math") ?? "");
    if (latex === null) return;
    if (latex.trim()) {
      math.setAttribute("data-math", latex.trim());
      math.innerHTML = drawMath(latex.trim());
    } else math.remove();
    return void event.currentTarget.dispatchEvent(new Event("input", { bubbles: true }));
  }
  if (!link || !href) return;
  // "#<id>" is a mention of another page; anything else leaves the app
  if (href.startsWith("#")) window.location.hash = href.slice(1);
  else window.open(link.href, "_blank", "noopener,noreferrer");
};

/** An uncontrolled contentEditable: the DOM is only rewritten when the store disagrees with it. */
export function Editable({ id, html, className = "", placeholder, placeholderAlways, ...handlers }: EditableProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { spellcheck } = usePrefs();

  useLayoutEffect(() => {
    const el = ref.current!;
    // rewrite when the store disagrees with the DOM, or when it holds inline math not yet drawn
    if (sanitize(el.innerHTML) === html && !el.querySelector("[data-math]:not([contenteditable])")) return;
    el.innerHTML = renderMath(html);
    if (document.activeElement === el) setCaret(el, textLength(el));
  }, [html]);

  return (
    <div
      ref={ref}
      id={`block-${id}`}
      contentEditable={!handlers.locked}
      suppressContentEditableWarning
      spellCheck={spellcheck}
      data-placeholder={placeholder}
      data-placeholder-always={placeholderAlways || undefined}
      className={`editable min-w-0 break-words outline-none ${className}`}
      onInput={(event) => handlers.onInput(event.currentTarget)}
      onKeyDown={handlers.onKeyDown}
      onPaste={handlers.onPaste}
      onFocus={handlers.onFocus}
      onBlur={handlers.onBlur}
      onClick={openLink}
    />
  );
}

export function BlockBody({
  block,
  number,
  editable,
}: {
  block: Block;
  number: number;
  editable: Omit<EditableProps, "className" | "placeholder">;
}) {
  const records = useRecords();
  const language = block.type === "code" ? languageId(block.language) : undefined;

  useEffect(() => {
    if (!language) return;
    setHighlights(block.id, document.getElementById(`block-${block.id}`), language);
    return () => setHighlights(block.id, null);
  }, [block.id, block.text, language]);

  if (block.type === "divider") return <hr className="my-2 border-border" />;
  if (block.type === "page") {
    const target = records[block.id];
    return (
      <button
        type="button"
        data-nav
        className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left font-medium underline decoration-border underline-offset-4 hover:bg-muted"
        onClick={() => openPage(block.id)}
      >
        <span aria-hidden>{target?.icon ?? "📄"}</span>
        {htmlToText(target?.text ?? "") || "Untitled"}
      </button>
    );
  }

  if (block.type === "image" || block.type === "video" || block.type === "audio" || block.type === "file") {
    return <MediaBlock block={block} />;
  }
  if (block.type === "bookmark") return <BookmarkBlock block={block} />;
  if (block.type === "embed") return <EmbedBlock block={block} />;
  if (block.type === "equation") return <EquationBlock block={block} />;
  if (block.type === "table") return <TableBlock block={block} />;
  if (block.type === "toc") return <TocBlock block={block} />;
  if (block.type === "database" || block.type === "linkedDatabase") return <DatabaseBlock block={block} />;
  if (block.type === "plugin") return <PluginBlockView block={block} />;
  if (block.type === "columns" || block.type === "synced") {
    // their content is drawn below this row by the editor; the row itself is only a grip
    return (
      <div className="h-4 text-xs leading-4 text-subtle opacity-0 group-hover:opacity-100">
        {block.type === "columns" ? "Columns" : "Synced block"}
      </div>
    );
  }

  const update = (patch: Partial<Block>) => store.commit([{ op: "update", id: block.id, patch }]);

  let prefix: ReactNode = null;
  if (block.type === "bullet") prefix = "•";
  if (block.type === "numbered") prefix = `${number}.`;
  if (block.type === "callout") prefix = "💡";
  if (block.type === "todo") {
    prefix = (
      <input
        type="checkbox"
        aria-label="Done"
        className="mt-1.5 h-4 w-4"
        checked={!!block.checked}
        onChange={(event) => update({ checked: event.target.checked })}
      />
    );
  }
  if (block.type === "button") {
    // a template button: the arrow shows the blocks it will copy, the plus adds a copy of them below
    prefix = (
      <span className="flex">
        <button
          type="button"
          aria-label={block.collapsed ? "Show the template" : "Hide the template"}
          aria-expanded={!block.collapsed}
          className="h-6 w-5 rounded text-xs hover:bg-muted"
          onClick={() => update({ collapsed: !block.collapsed })}
        >
          {block.collapsed ? "▸" : "▾"}
        </button>
        <button
          type="button"
          aria-label={`Add ${htmlToText(block.text) || "a copy of the template"}`}
          className="h-6 rounded border border-border px-1.5 text-xs hover:bg-muted"
          onClick={() => stampTemplate(store, block.id)}
        >
          ＋
        </button>
      </span>
    );
  } else if (isToggle(block)) {
    prefix = (
      <button
        type="button"
        data-nav
        aria-label={block.collapsed ? "Expand" : "Collapse"}
        aria-expanded={!block.collapsed}
        className="h-6 w-5 rounded text-xs hover:bg-muted"
        onClick={() => update({ collapsed: !block.collapsed })}
      >
        {block.collapsed ? "▸" : "▾"}
      </button>
    );
  }

  const done = block.type === "todo" && block.checked ? "text-subtle line-through" : "";
  const align = block.align ? ALIGN[block.align] : "";
  const kind = BLOCK_KINDS.find((k) => k.type === block.type && !!k.toggleable === !!block.toggleable);
  return (
    <div className={`flex items-start gap-2 ${block.type === "callout" ? "rounded bg-muted p-3" : ""}`}>
      {prefix && (
        <span
          key="prefix"
          className={`min-w-5 select-none text-center ${block.toggleable ? HEADING_ARROW_OFFSET[block.type] : ""}`}
          contentEditable={false}
        >
          {prefix}
        </span>
      )}
      <div key="text" className="relative min-w-0 flex-1">
        {language && (
          <select
            key="language"
            aria-label="Language"
            className="absolute right-1 top-1 rounded bg-muted text-xs text-subtle"
            value={language}
            onChange={(event) => update({ language: event.target.value })}
          >
            {LANGUAGES.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        )}
        <Editable
          key="editable"
          {...editable}
          className={`${TEXT_STYLE[block.type] ?? ""} ${done} ${align}`}
          placeholder={block.type === "text" ? "Type '/' for commands" : kind?.label}
        />
        {language === "mermaid" && (
          <MermaidPreview key="diagram" source={htmlToText(block.text.replace(/<br\s*\/?>/gi, "\n"))} />
        )}
      </div>
    </div>
  );
}

const moment = (time: number) => new Date(time).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

function addComment(block: Block) {
  const text = window.prompt("Comment on this block")?.trim();
  if (text) store.commit([{ op: "update", id: block.id, patch: { comments: [...(block.comments ?? []), { at: Date.now(), text }] } }]);
}

/** A block's reminder and comments, listed under it. */
export function BlockNotes({ block }: { block: Block }) {
  if (block.remind === undefined && !block.comments?.length) return null;
  const set = (patch: Partial<Block>) => store.commit([{ op: "update", id: block.id, patch }]);
  const remove = "rounded px-1 text-subtle hover:bg-muted";
  return (
    <div className="flex flex-col gap-0.5 pb-1 pl-7 text-xs text-subtle" data-keep-selection>
      {block.remind !== undefined && (
        <span>
          ⏰ {block.reminded ? "Reminded" : "Reminder"} {moment(block.remind)}
          <button type="button" aria-label="Remove reminder" className={remove} onClick={() => set({ remind: undefined, reminded: undefined })}>
            ×
          </button>
        </span>
      )}
      {block.comments?.map((comment, index) => (
        <span key={index}>
          💬 <span className="text-foreground">{comment.text}</span> · {moment(comment.at)}
          <button
            type="button"
            aria-label="Remove comment"
            className={remove}
            onClick={() => set({ comments: block.comments!.filter((_, other) => other !== index) })}
          >
            ×
          </button>
        </span>
      ))}
    </div>
  );
}

/** A block drawn by a plugin: the plugin fills the element and saves its own data on the block. */
function PluginBlockView({ block }: { block: Block }) {
  const { blocks } = usePlugins();
  const ref = useRef<HTMLDivElement>(null);
  const kind = blocks.find((candidate) => candidate.key === block.plugin);

  useEffect(() => {
    const el = ref.current;
    if (!el || !kind) return;
    el.replaceChildren();
    const cleanup = guarded(kind.plugin, `drawing the block “${kind.label}”`, () =>
      kind.render(el, { data: block.data, update: (data) => store.commit([{ op: "update", id: block.id, patch: { data } }]) }),
    );
    return () => {
      if (typeof cleanup === "function") guarded(kind.plugin, `cleaning up the block “${kind.label}”`, cleanup);
    };
  }, [kind, block.id, block.data]);

  if (!kind) {
    return (
      <div className="rounded border border-border bg-muted p-3 text-sm text-subtle">
        This block comes from the plugin “{block.plugin?.split("/")[0]}”, which isn’t turned on. Its contents are kept.
      </div>
    );
  }
  return <div ref={ref} data-plugin-block={kind.key} />;
}

/** Pasting this text into a block adds another copy of the synced content. */
export const SYNC_LINK = /^folio-sync:([0-9a-f-]{36})$/;

function copySyncLink(source: string) {
  const link = `folio-sync:${source}`;
  // the clipboard can be refused (no permission, insecure page); show the text to copy by hand instead
  navigator.clipboard.writeText(link).catch(() => window.prompt("Copy this, then paste it where the copy should go", link));
}

/** Options for one block, or for every selected block when the block is part of the selection. */
export function BlockMenu({ block, targets, onClose }: { block: Block; targets: Block[]; onClose: () => void }) {
  const item = "block w-full rounded px-2 py-1 text-left text-sm hover:bg-muted";
  const run = (action: () => void) => () => {
    action();
    onClose();
  };
  const editable = targets.filter(isEditable);
  const update = (patch: Partial<Block>) =>
    run(() => store.commit(editable.map((target): Op => ({ op: "update", id: target.id, patch }))));
  const copies = targets.filter((target) => target.type !== "page");
  return (
    <div data-keep-selection>
      <div className="fixed inset-0 z-10" onClick={onClose} />
      <div className="absolute -left-13 top-8 z-20 max-h-80 w-52 overflow-auto rounded-xl glass p-1">
        {targets.length > 1 && <div className="px-2 py-1 text-xs text-subtle">{targets.length} blocks</div>}
        <button type="button" className={item} onClick={run(() => removeBlocks(store, targets.map((t) => t.id)))}>
          Delete
        </button>
        {targets.length === 1 && block.type === "synced" && block.source && (
          <button type="button" className={item} onClick={run(() => copySyncLink(block.source!))}>
            Copy to paste on another page
          </button>
        )}
        {targets.length === 1 && (
          <>
            <button
              type="button"
              className={item}
              onClick={run(() => addComment(block))}
            >
              Comment…
            </button>
            <label className={`${item} flex flex-col gap-1`}>
              Remind me at
              <input
                type="datetime-local"
                aria-label="Remind me at"
                className="rounded border border-border bg-background px-1"
                onChange={(event) => {
                  const at = Date.parse(event.target.value);
                  if (!Number.isNaN(at)) store.commit([{ op: "update", id: block.id, patch: { remind: at, reminded: undefined } }]);
                }}
              />
            </label>
          </>
        )}
        {copies.length > 0 && (
          <button
            type="button"
            className={item}
            // last first, so each copy lands right after its original
            onClick={run(() => store.batch(() => [...copies].reverse().forEach((t) => duplicateBlock(store, t.id))))}
          >
            Duplicate
          </button>
        )}
        {editable.length > 0 && (
          <>
            <div className="px-2 pb-1 pt-2 text-xs text-subtle">Align</div>
            <div className="flex gap-1 px-1">
              {([undefined, "center", "right"] as const).map((align) => (
                <button
                  key={align ?? "left"}
                  type="button"
                  aria-pressed={block.align === align}
                  className={`flex-1 rounded px-2 py-1 text-sm hover:bg-muted ${block.align === align ? "bg-muted" : ""}`}
                  onClick={update({ align })}
                >
                  {align ? align[0].toUpperCase() + align.slice(1) : "Left"}
                </button>
              ))}
            </div>
            <div className="px-2 pb-1 pt-2 text-xs text-subtle">Turn into</div>
            {BLOCK_KINDS.filter(isTextKind).map((kind) => (
              <button key={kind.key} type="button" className={item} onClick={update(kindPatch(kind))}>
                {kind.label}
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
