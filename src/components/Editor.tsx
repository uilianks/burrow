"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { AS_TEXT, BLOCK_KINDS, isContainer, isEditable, isTextKind, isToggle, kindPatch, type BlockKind } from "@/lib/blockKinds";
import {
  createTitledPage,
  deleteBlock,
  duplicateBlock,
  indent,
  insertBlock,
  insertFiles,
  insertKind,
  insertLinkedDatabase,
  insertParsed,
  makeColumns,
  insertSyncedCopy,
  mergeIntoPrevious,
  moveTo,
  outdent,
  removeBlocks,
  splitBlock,
} from "@/lib/commands";
import { caretOffset, caretRect, htmlToText, rangeFor, sanitize, setCaret, textLength } from "@/lib/dom";
import { findEmoji } from "@/lib/emoji";
import { files, useFileUrl } from "@/lib/files";
import { fromMarkdown, toMarkdown } from "@/lib/markdown";
import { day } from "@/lib/actions";
import { findPageByTitle, linkablePages, pageLinkHtml, parseWikiLink } from "@/lib/links";
import { usePlugins } from "@/lib/plugins";
import { usePrefs } from "@/lib/prefs";
import { backlinks, liveMentions } from "@/lib/search";
import type { Block, BlockType } from "@/lib/store";
import { childrenOf, outermost, visibleRows } from "@/lib/tree";
import { openPage, store, useRecords } from "@/lib/workspace";
import { BlockBody, BlockMenu, BlockNotes, Editable, SYNC_LINK } from "./blocks";
import { DATABASE_LINK, RowProperties } from "./Database";
import { pageTitle } from "./Sidebar";
import { anchorFor, FormatToolbar, type Anchor } from "./FormatToolbar";

const SHORTCUTS: Record<string, string> = {
  "#": "h1",
  "##": "h2",
  "###": "h3",
  "-": "bullet",
  "*": "bullet",
  "1.": "numbered",
  "[]": "todo",
  ">": "quote",
  "```": "code",
};

const ICONS = "📄 📝 📚 📌 💡 ✅ ⭐ 🔥 🎯 🚀 🧠 💼 🏠 🎨 🎵 🍀 🌍 ❤️ 🛠️ 📅 💰 🧪 🎮 ✈️".split(" ");
const FONT = { serif: "font-serif", mono: "font-mono" };
const CONTINUES: BlockType[] = ["bullet", "numbered", "todo", "toggle"];
const DRAG_TYPE = "application/x-burrow-block";
const kind = (key: string) => BLOCK_KINDS.find((candidate) => candidate.key === key)!;
const matching = (kinds: BlockKind[], query: string) => kinds.filter((item) => item.label.toLowerCase().includes(query.toLowerCase()));

const BOX_SELECT_IGNORES = ".editable, input, textarea, select, button, a, label, table, iframe, video, audio, img, [data-database], [data-keep-selection], [role=listbox], [role=toolbar]";
let boxSelected = false;

type Focus = { id: string; at: number | "end" };
/** The list that opens while typing "/kind" or ":emoji" in a block. */
type Slash = {
  kind: "slash" | "emoji" | "mention";
  id: string;
  query: string;
  /** How many characters open the list: 1 for "/", ":" and "@", 2 for "[[". */
  prefix: number;
  top: number;
  left: number;
  index: number;
};
type PickerItem = { key: string; label: string; hint?: string; blockKind?: BlockKind; emoji?: string; page?: string; create?: string };
/** A run of whole blocks picked on screen, from where the selection started to where it reaches. */
type BlockSelection = { anchor: string; focus: string };

const blockElement = (id: string) => document.getElementById(`block-${id}`);

function focusBlock(focus: Focus) {
  const el = blockElement(focus.id);
  if (!el) return;
  el.focus();
  setCaret(el, focus.at === "end" ? textLength(el) : focus.at);
}

export function Editor({ pageId }: { pageId: string }) {
  const records = useRecords();
  const prefs = usePrefs();
  const page = records[pageId];
  const root = useRef<HTMLDivElement>(null);
  const [focusRequest, setFocusRequest] = useState<Focus | null>(null);
  const [slash, setSlash] = useState<Slash | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; before: boolean; beside: boolean } | null>(null);
  const [toolbar, setToolbar] = useState<Anchor | null>(null);
  const [pickingIcon, setPickingIcon] = useState(false);
  const [blockSelection, setBlockSelection] = useState<BlockSelection | null>(null);

  // Blocks created or moved by a command only exist in the DOM after the
  // next render, so commands request focus through state instead of focusing directly.
  useLayoutEffect(() => {
    if (focusRequest) focusBlock(focusRequest);
  }, [focusRequest]);

  // The formatting toolbar follows any non-empty text selection inside a block.
  useEffect(() => {
    const onSelectionChange = () => {
      const selection = window.getSelection();
      const anchor = selection?.anchorNode;
      const el = anchor instanceof Element ? anchor : anchor?.parentElement;
      const inBlock = el?.closest(".group .editable") && root.current?.contains(el);
      // typing a page name into the toolbar's own field moves the selection there; the toolbar must stay
      if (document.activeElement?.closest("[role=toolbar]")) return;
      if (!selection || selection.isCollapsed || !inBlock) return setToolbar(null);
      setToolbar(anchorFor(selection.getRangeAt(0).getBoundingClientRect()));
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, []);

  // the slash menu offers the built-in kinds plus any block kinds added by enabled plugins
  const pluginBlocks = usePlugins().blocks;
  const matchingKinds = (query: string) =>
    matching(
      [...BLOCK_KINDS, ...pluginBlocks.map((b): BlockKind => ({ key: `plugin:${b.key}`, type: "plugin", plugin: b.key, label: b.label, hint: b.hint }))],
      query,
    );

  const rows = visibleRows(records, pageId);
  const rowIndex = (id: string) => rows.findIndex((row) => row.id === id);
  /** What "@name" or "[[name" offers: matching pages, then (for @) dates or (for [[) making the page. */
  const mentionItems = (query: string, wiki = false): PickerItem[] => {
    const { name } = parseWikiLink(query);
    const wanted = name.toLowerCase();
    const pages: PickerItem[] = linkablePages(records)
      .filter((block) => block.id !== pageId && pageTitle(records, block.id).toLowerCase().includes(wanted))
      .slice(0, 6)
      .map((block) => ({ key: block.id, label: `${block.icon ?? "📄"} ${pageTitle(records, block.id)}`, page: block.id }));
    if (wiki) return name && !findPageByTitle(records, name) ? [...pages, { key: "create", label: `＋ Create page “${name}”`, create: name }] : pages;
    const dates = [
      { key: "today", label: `Today — ${day()}`, emoji: day() },
      { key: "tomorrow", label: `Tomorrow — ${day(1)}`, emoji: day(1) },
    ].filter((item) => item.key.startsWith(wanted));
    return [...pages, ...dates];
  };

  /**
   * Replaces the `typed` characters before the caret with a link to a page:
   * the given one, else the page called `name`, else a new page with that name.
   */
  const insertPageLink = (el: HTMLElement, typed: number, name: string, words?: string, target?: string) => {
    const page = target ?? findPageByTitle(records, name) ?? createTitledPage(store, name);
    const offset = caretOffset(el) ?? 0;
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(rangeFor(el, offset - typed, offset));
    const title = htmlToText(store.getSnapshot()[page].text) || "Untitled";
    // through the browser, so the caret ends up after the link; this fires the input event that saves it
    document.execCommand("insertHTML", false, `${pageLinkHtml(page, words ?? title, !!words)}&nbsp;`);
  };
  const slashItems: PickerItem[] = !slash
    ? []
    : slash.kind === "mention"
      ? mentionItems(slash.query, slash.prefix === 2)
      : slash.kind === "emoji"
      ? findEmoji(slash.query).map((e) => ({ key: e.name, label: `${e.emoji}  :${e.name}:`, emoji: e.emoji }))
      : matchingKinds(slash.query).map((k) => ({ key: k.key, label: k.label, hint: k.hint, blockKind: k }));
  const coverUrl = useFileUrl(page.cover);
  const coverInput = useRef<HTMLInputElement>(null);

  const selectedIds = (() => {
    if (!blockSelection) return [];
    const from = rowIndex(blockSelection.anchor);
    const to = rowIndex(blockSelection.focus);
    if (from < 0 || to < 0) return [];
    return rows.slice(Math.min(from, to), Math.max(from, to) + 1).map((row) => row.id);
  })();
  const selected = new Set(selectedIds);
  // Acting on a block acts on everything shown inside it, so only the outermost selected blocks matter.
  const selectedRoots = outermost(rows.filter((row) => selected.has(row.id)));

  const selectBlocks = (anchor: string, focus: string) => {
    if (page.locked) return;
    (document.activeElement as HTMLElement | null)?.blur();
    window.getSelection()?.removeAllRanges();
    setSlash(null);
    setBlockSelection({ anchor, focus });
    document.querySelector(`[data-block-id="${focus}"]`)?.scrollIntoView({ block: "nearest" });
  };

  /** The nearest block you can type in, above or below `id` on screen. */
  const neighbor = (id: string, direction: 1 | -1) => {
    for (let i = rowIndex(id) + direction; i >= 0 && i < rows.length; i += direction) {
      const candidate = records[rows[i].id];
      if (candidate && isEditable(candidate)) return candidate.id;
    }
    return direction === -1 ? pageId : null;
  };

  const addBlockAfter = (parent: string, after: string | null) => {
    setFocusRequest({ id: insertBlock(store, parent, after, "text"), at: 0 });
  };

  const removeSelected = () => {
    const above = selectedIds.length ? neighbor(selectedIds[0], -1) : null;
    removeBlocks(store, selectedRoots);
    setBlockSelection(null);
    if (above) setFocusRequest({ id: above, at: "end" });
  };

  // While blocks are selected nothing has focus, so their shortcuts are handled at the window.
  useEffect(() => {
    if (!blockSelection) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.target as HTMLElement).closest?.("input, select, textarea, [contenteditable]")) return;
      const command = event.metaKey || event.ctrlKey;
      const key = event.key;

      if (key === "ArrowUp" || key === "ArrowDown") {
        event.preventDefault();
        const next = rows[rowIndex(blockSelection.focus) + (key === "ArrowUp" ? -1 : 1)]?.id;
        if (next) selectBlocks(event.shiftKey ? blockSelection.anchor : next, next);
      } else if (key === "Escape") {
        setBlockSelection(null);
      } else if (key === "Backspace" || key === "Delete") {
        event.preventDefault();
        removeSelected();
      } else if (key === "Enter") {
        event.preventDefault();
        const first = selectedIds.find((id) => isEditable(records[id]));
        setBlockSelection(null);
        if (first) setFocusRequest({ id: first, at: "end" });
      } else if (key === "Tab") {
        event.preventDefault();
        // outdent last first so the blocks keep their order after their old parent
        store.batch(() =>
          event.shiftKey
            ? [...selectedRoots].reverse().forEach((id) => outdent(store, id))
            : selectedRoots.forEach((id) => indent(store, id)),
        );
      } else if (command && key.toLowerCase() === "d") {
        event.preventDefault();
        store.batch(() => [...selectedRoots].reverse().forEach((id) => duplicateBlock(store, id)));
      } else if (command && key.toLowerCase() === "a" && rows.length) {
        event.preventDefault();
        selectBlocks(rows[0].id, rows[rows.length - 1].id);
      }
    };
    const onCopy = (event: globalThis.ClipboardEvent) => {
      if (!selectedRoots.length) return;
      event.preventDefault();
      event.clipboardData?.setData("text/plain", toMarkdown(records, selectedRoots));
      if (event.type === "cut") removeSelected();
    };
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("copy", onCopy);
    document.addEventListener("cut", onCopy);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("cut", onCopy);
    };
  });

  const saveText = (id: string, el: HTMLElement) => {
    if (el.innerHTML === "<br>") el.innerHTML = "";
    const text = sanitize(el.innerHTML);
    if (text !== records[id]?.text) store.commit([{ op: "update", id, patch: { text } }], { coalesce: id });
  };

  const onInput = (block: Block, el: HTMLElement) => {
    // typing $$x^2$$ turns what is between the dollar signs into inline math
    const typed = /\$\$([^$]+)\$\$$/.exec((el.textContent ?? "").slice(0, caretOffset(el) ?? 0));
    if (typed && block.type !== "code") {
      const end = caretOffset(el) ?? 0;
      const range = rangeFor(el, end - typed[0].length, end);
      window.getSelection()?.removeAllRanges();
      window.getSelection()?.addRange(range);
      const latex = typed[1].trim().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
      // insertHTML fires its own input event, which brings us back here to save
      return void document.execCommand("insertHTML", false, `<span data-math="${latex}">${latex}</span>&nbsp;`);
    }
    // typing [[Page name]] (or [[Page name|other words]]) in full makes the link, creating the page if need be
    const closed = /\[\[([^\[\]]+)\]\]$/.exec((el.textContent ?? "").slice(0, caretOffset(el) ?? 0));
    if (closed && block.type !== "code" && block.id !== pageId && parseWikiLink(closed[1]).name) {
      const { name, words } = parseWikiLink(closed[1]);
      setSlash(null);
      return insertPageLink(el, closed[0].length, name, words);
    }
    saveText(block.id, el);
    if (block.id === pageId) return;
    const offset = caretOffset(el);
    // The query may contain spaces ("toggle heading"), but only while it still matches something,
    // so a slash in ordinary prose doesn't leave the menu open.
    const match = offset === null ? null : /(?:^|\s)\/((?:[^\s/][^/]*)?)$/.exec((el.textContent ?? "").slice(0, offset));
    const emoji = offset === null ? null : /(?:^|\s):([a-z0-9_]{2,})$/.exec((el.textContent ?? "").slice(0, offset));
    const mention = offset === null ? null : /(?:^|\s)@([^\s@]{0,30})$/.exec((el.textContent ?? "").slice(0, offset));
    const wiki = offset === null || block.type === "code" ? null : /\[\[([^\[\]]{0,60})$/.exec((el.textContent ?? "").slice(0, offset));
    const found =
      wiki && mentionItems(wiki[1], true).length
        ? wiki
        : match && matchingKinds(match[1]).length
        ? match
        : emoji && findEmoji(emoji[1]).length
          ? emoji
          : mention && mentionItems(mention[1]).length
            ? mention
            : null;
    if (!found) return setSlash(null);
    const rect = caretRect(el);
    setSlash({
      kind: found === match ? "slash" : found === emoji ? "emoji" : "mention",
      prefix: found === wiki ? 2 : 1,
      id: block.id,
      query: found[1],
      top: rect.bottom + 4,
      left: rect.left,
      index: 0,
    });
  };

  /** Removes `count` characters before the caret and returns the remaining text. */
  const eraseBeforeCaret = (el: HTMLElement, count: number) => {
    const offset = caretOffset(el) ?? 0;
    rangeFor(el, offset - count, offset).deleteContents();
    return sanitize(el.innerHTML);
  };

  const applyKind = (block: Block, chosen: BlockKind, text: string) => {
    if (!isTextKind(chosen)) {
      // A block that isn't a line of text goes in after this one, or in its place if this one is empty.
      const parent = block.parent!;
      const empty = text === "" && block.content.length === 0;
      store.batch(() => {
        if (text !== block.text) store.commit([{ op: "update", id: block.id, patch: { text } }]);
        const inserted = insertKind(store, parent, block.id, chosen);
        if (empty) deleteBlock(store, block.id);
        const now = store.getSnapshot();
        const inside = visibleRows(now, inserted).find((row) => isEditable(now[row.id]));
        const siblings = now[parent].content;
        const next = now[siblings[siblings.indexOf(inserted) + 1]];
        if (chosen.type !== "page" && inside) setFocusRequest({ id: inside.id, at: 0 });
        else if (next && isEditable(next)) setFocusRequest({ id: next.id, at: 0 });
        else addBlockAfter(parent, inserted);
      });
      return;
    }
    store.commit([{ op: "update", id: block.id, patch: { ...kindPatch(chosen), text } }]);
    setFocusRequest({ id: block.id, at: caretOffset(blockElement(block.id)!) ?? "end" });
  };

  const pickSlash = (chosen: PickerItem) => {
    if (!slash) return;
    const el = blockElement(slash.id);
    const block = records[slash.id];
    setSlash(null);
    if (!el || !block) return;
    const typed = slash.query.length + slash.prefix;
    if (chosen.blockKind) return applyKind(block, chosen.blockKind, eraseBeforeCaret(el, typed));
    if (chosen.page || chosen.create) {
      // after [[ the query may carry "|words to show"; after @ it never does
      const { words } = slash.prefix === 2 ? parseWikiLink(slash.query) : { words: undefined };
      return insertPageLink(el, typed, chosen.create ?? "", words, chosen.page);
    }
    // replace what was typed (":name", "@today") through the browser, so the caret ends up after it
    const offset = caretOffset(el) ?? 0;
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(rangeFor(el, offset - typed, offset));
    document.execCommand("insertText", false, chosen.emoji);
  };

  const onKeyDown = (block: Block, event: KeyboardEvent<HTMLElement>) => {
    const el = event.currentTarget;
    if (event.nativeEvent.isComposing) return;
    const inTitle = block.id === pageId;

    if (slash?.id === block.id && slashItems.length > 0) {
      const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
      if (step) {
        event.preventDefault();
        return setSlash({ ...slash, index: (slash.index + step + slashItems.length) % slashItems.length });
      }
      if (event.key === "Enter") {
        event.preventDefault();
        return pickSlash(slashItems[slash.index]);
      }
    }
    if (event.key === "Escape") {
      if (slash) return setSlash(null);
      if (!inTitle) selectBlocks(block.id, block.id);
      return;
    }

    const offset = caretOffset(el) ?? 0;
    const end = caretOffset(el, "end") ?? 0;
    const collapsed = window.getSelection()?.isCollapsed ?? true;
    const length = textLength(el);

    // Extending a text selection past the edge of a block starts selecting whole blocks.
    if (!inTitle && event.shiftKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      const up = event.key === "ArrowUp";
      if (up ? offset === 0 : end === length) {
        event.preventDefault();
        selectBlocks(block.id, rows[rowIndex(block.id) + (up ? -1 : 1)]?.id ?? block.id);
      }
      return;
    }
    // Select-all a second time, once the block's own text is fully selected, takes every block.
    if (!inTitle && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
      if (offset === 0 && end === length && rows.length) {
        event.preventDefault();
        selectBlocks(rows[0].id, rows[rows.length - 1].id);
      }
      return;
    }

    if (event.key === "ArrowUp" && collapsed && offset === 0) {
      const previous = inTitle ? null : neighbor(block.id, -1);
      if (previous) {
        event.preventDefault();
        focusBlock({ id: previous, at: "end" });
      }
      return;
    }
    if (event.key === "ArrowDown" && collapsed && offset === length) {
      const next = inTitle ? rows.find((row) => isEditable(records[row.id]))?.id : neighbor(block.id, 1);
      if (next) {
        event.preventDefault();
        focusBlock({ id: next, at: 0 });
      }
      return;
    }

    if (inTitle) {
      if (event.key === "Enter") {
        event.preventDefault();
        addBlockAfter(pageId, null);
      }
      return;
    }

    const nested = !isContainer(records[block.parent!]);

    if (event.key === "Tab") {
      event.preventDefault();
      if (event.shiftKey ? outdent(store, block.id) : indent(store, block.id)) {
        setFocusRequest({ id: block.id, at: offset });
      }
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (block.type === "code") return void document.execCommand("insertLineBreak");
      if (length === 0 && (block.type !== "text" || block.toggleable)) {
        return store.commit([{ op: "update", id: block.id, patch: AS_TEXT }]);
      }
      if (length === 0 && nested && block.content.length === 0) {
        outdent(store, block.id);
        return setFocusRequest({ id: block.id, at: 0 });
      }
      const selection = window.getSelection();
      if (!selection?.rangeCount) return;
      const range = selection.getRangeAt(0);
      range.deleteContents();
      const holder = document.createElement("div");
      if (el.lastChild) {
        range.setEndAfter(el.lastChild);
        holder.append(range.extractContents());
      }
      // New lines go inside an open toggle or a block that already has children.
      const asChild = isToggle(block) ? !block.collapsed : block.content.length > 0;
      const tailType = !asChild && CONTINUES.includes(block.type) ? block.type : "text";
      const tail = splitBlock(store, block.id, sanitize(el.innerHTML), sanitize(holder.innerHTML), tailType, asChild);
      return setFocusRequest({ id: tail, at: 0 });
    }

    if (event.key === "Backspace" && collapsed && offset === 0) {
      event.preventDefault();
      if (block.type !== "text") return store.commit([{ op: "update", id: block.id, patch: AS_TEXT }]);
      const siblings = records[block.parent!].content;
      if (nested && siblings.at(-1) === block.id) {
        outdent(store, block.id);
        return setFocusRequest({ id: block.id, at: 0 });
      }
      const previous = records[rows[rowIndex(block.id) - 1]?.id];
      if (previous?.type === "divider") return deleteBlock(store, previous.id);
      if (!previous || !isEditable(previous)) return;
      setFocusRequest({ id: previous.id, at: htmlToText(previous.text).length });
      return mergeIntoPrevious(store, previous.id, block.id);
    }

    if (event.key === " " && collapsed && block.type === "text") {
      const key = SHORTCUTS[(el.textContent ?? "").slice(0, offset)];
      if (key) {
        event.preventDefault();
        applyKind(block, kind(key), eraseBeforeCaret(el, offset));
      }
    }
  };

  const onPaste = (block: Block, event: ClipboardEvent<HTMLElement>) => {
    event.preventDefault();
    const text = event.clipboardData.getData("text/plain");
    const inTitle = block.id === pageId;
    const parent = inTitle ? pageId : block.parent!;
    const after = inTitle ? null : block.id;
    const pasted = Array.from(event.clipboardData.files);
    if (pasted.length) return void addFiles(parent, after, pasted);
    const sync = SYNC_LINK.exec(text.trim());
    if (sync && insertSyncedCopy(store, parent, after, sync[1])) return;
    const database = DATABASE_LINK.exec(text.trim());
    if (database && insertLinkedDatabase(store, parent, after, database[1])) return;
    if (block.type === "code") return void document.execCommand("insertText", false, text);
    const parsed = text.includes("\n") && block.id !== pageId ? fromMarkdown(text) : [];
    // One line goes in as plain text at the caret; several lines become blocks, read as Markdown.
    if (parsed.length < 2) return void document.execCommand("insertText", false, text.replace(/\s*\n\s*/g, " ").trim());
    const replaces = textLength(event.currentTarget) === 0 && block.content.length === 0;
    store.batch(() => {
      const ids = insertParsed(store, block.parent!, block.id, parsed);
      if (replaces) deleteBlock(store, block.id);
      const last = [...ids].reverse().find((id) => isEditable(store.getSnapshot()[id]));
      if (last) setFocusRequest({ id: last, at: "end" });
    });
  };

  const addFiles = (parent: string, after: string | null, uploads: File[]) =>
    insertFiles(store, files, parent, after, uploads).catch(() =>
      window.alert("The files couldn’t be saved in this browser. They may be too large for the space available."),
    );

  // Files dragged in from the computer land after the block they are dropped on, or at the end of the page.
  const onFileDrop = (event: DragEvent<HTMLElement>) => {
    const dropped = Array.from(event.dataTransfer.files);
    if (!dropped.length) return;
    event.preventDefault();
    const target = records[(event.target as HTMLElement).closest<HTMLElement>("[data-block-id]")?.dataset.blockId ?? ""];
    if (target?.parent) addFiles(target.parent, target.id, dropped);
    else addFiles(pageId, page.content.at(-1) ?? null, dropped);
  };

  const setCover = (file: File | undefined) =>
    file?.type.startsWith("image/") &&
    files.put(file).then(
      (cover) => store.commit([{ op: "update", id: pageId, patch: { cover } }]),
      () => window.alert("The cover couldn’t be saved in this browser."),
    );

  const onDragOver = (block: Block, event: DragEvent<HTMLElement>) => {
    if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const before = event.clientY < rect.top + rect.height / 2;
    // the right-hand edge of a block is the place to drop something beside it, as a new column
    const beside = event.clientX > rect.right - Math.min(64, rect.width / 5);
    if (drop?.id !== block.id || drop.before !== before || drop.beside !== beside) setDrop({ id: block.id, before, beside });
  };

  const onDrop = (block: Block, event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    const dragged = event.dataTransfer.getData(DRAG_TYPE);
    // Dragging one of the selected blocks moves the whole selection.
    const moving = selected.has(dragged) ? selectedRoots : [dragged];
    if (drop?.beside && dragged && !moving.includes(block.id)) makeColumns(store, block.id, moving);
    else if (drop && dragged && !moving.includes(block.id)) {
      const order = records[block.parent!].content.filter((id) => !moving.includes(id));
      let after = drop.before ? (order[order.indexOf(block.id) - 1] ?? null) : block.id;
      store.batch(() => {
        for (const id of moving) {
          moveTo(store, id, block.parent!, after);
          after = id;
        }
      });
    }
    setDrop(null);
  };

  const onMouseDown = (event: MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    // Shift-click extends from the block being edited (or the current selection) to the clicked block.
    if (event.shiftKey) {
      const clicked = target.closest<HTMLElement>("[data-block-id]")?.dataset.blockId;
      const active = document.activeElement?.id.replace(/^block-/, "");
      const anchor = blockSelection?.anchor ?? (active && active !== pageId && records[active] ? active : null);
      if (clicked && anchor && clicked !== anchor) {
        event.preventDefault();
        return selectBlocks(anchor, clicked);
      }
    }
    if (blockSelection && !target.closest("[data-keep-selection]")) setBlockSelection(null);

    // Dragging from the blank space around the blocks draws a selection over the blocks it passes.
    if (event.button !== 0 || page.locked || target.closest(BOX_SELECT_IGNORES)) return;
    const startY = event.clientY;
    let dragging = false;
    const move = (moved: globalThis.MouseEvent) => {
      if (!dragging && Math.abs(moved.clientY - startY) < 8) return;
      dragging = true;
      moved.preventDefault();
      window.getSelection()?.removeAllRanges();
      const [top, bottom] = [Math.min(startY, moved.clientY), Math.max(startY, moved.clientY)];
      const hit = rows.filter((row) => {
        const rect = document.querySelector(`[data-block-id="${row.id}"]`)?.getBoundingClientRect();
        return rect && rect.bottom > top && rect.top < bottom;
      });
      if (hit.length) setBlockSelection({ anchor: hit[0].id, focus: hit[hit.length - 1].id });
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      // the click that ends a drag over the empty space below the page must not add a block there
      boxSelected = dragging;
      setTimeout(() => (boxSelected = false));
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const editableProps = (block: Block) => ({
    id: block.id,
    html: liveMentions(block.text, records),
    onInput: (el: HTMLElement) => onInput(block, el),
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => onKeyDown(block, event),
    onPaste: (event: ClipboardEvent<HTMLElement>) => onPaste(block, event),
    onFocus: () => setBlockSelection(null),
    locked: page.locked,
    onBlur: () => setSlash((current) => (current?.id === block.id ? null : current)),
  });

  const renderBlocks = (parent: string): ReactNode => {
    const siblings = childrenOf(records, parent)
      .map((id) => records[id])
      .filter(Boolean);
    const numbers: number[] = [];
    for (const block of siblings) numbers.push(block.type === "numbered" ? (numbers.at(-1) ?? 0) + 1 : 0);

    return siblings.map((block, index) => (
      <div key={block.id}>
        <div
          data-block-id={block.id}
          aria-selected={selected.has(block.id) || undefined}
          className={`group relative rounded py-0.5 ${selected.has(block.id) ? "bg-accent/15" : ""}`}
          onDragOver={(event) => onDragOver(block, event)}
          onDrop={(event) => onDrop(block, event)}
        >
          {drop?.id === block.id && (
            <div
              className={`absolute bg-accent ${drop.beside ? "inset-y-0 right-0 w-0.5" : `inset-x-0 h-0.5 ${drop.before ? "top-0" : "bottom-0"}`}`}
            />
          )}
          <div
            data-keep-selection
            data-row-controls
            className="absolute -left-13 top-1 flex opacity-0 focus-within:opacity-100 group-hover:opacity-100"
          >
            <button
              type="button"
              aria-label="Add block below"
              className="h-6 w-6 rounded text-subtle hover:bg-muted"
              onClick={() => addBlockAfter(block.parent!, block.id)}
            >
              +
            </button>
            <button
              type="button"
              draggable
              aria-label="Drag to move, click for options"
              className="h-6 w-6 cursor-grab rounded text-xs text-subtle hover:bg-muted"
              onDragStart={(event) => {
                event.dataTransfer.setData(DRAG_TYPE, block.id);
                event.dataTransfer.effectAllowed = "move";
                const row = event.currentTarget.closest(".group");
                if (row) event.dataTransfer.setDragImage(row, 0, 0);
              }}
              onClick={() => setMenuFor(block.id)}
            >
              ⋮⋮
            </button>
          </div>

          <BlockBody block={block} number={numbers[index]} editable={editableProps(block)} />
          <BlockNotes block={block} />

          {menuFor === block.id && (
            <BlockMenu
              block={block}
              targets={(selected.has(block.id) ? selectedRoots : [block.id]).map((id) => records[id])}
              onClose={() => setMenuFor(null)}
            />
          )}
        </div>
        {block.type === "columns" ? (
          <div className="flex gap-14">
            {block.content.map((column) => (
              <div key={column} className="min-w-0 flex-1">
                {renderArea(column)}
              </div>
            ))}
          </div>
        ) : block.type === "synced" ? (
          <div className="rounded border border-accent/40 pl-14 pr-2">
            {records[block.source ?? ""] ? (
              renderArea(block.source!)
            ) : (
              <div className="py-1 text-sm text-subtle">The content of this synced block no longer exists.</div>
            )}
          </div>
        ) : (
          isEditable(block) && !block.collapsed && block.content.length > 0 && <div className="pl-7">{renderBlocks(block.id)}</div>
        )}
      </div>
    ));
  };

  /** A column or synced block's own writing area: its blocks, or a way to start writing when it has none. */
  const renderArea = (container: string): ReactNode =>
    records[container].content.length ? (
      renderBlocks(container)
    ) : (
      <button
        type="button"
        className="w-full rounded py-1 text-left text-sm text-subtle hover:bg-muted"
        onClick={() => addBlockAfter(container, null)}
      >
        Empty. Click to write here.
      </button>
    );

  const linkedFrom = backlinks(records, pageId);
  const wide = page.fullWidth ?? prefs.fullWidthDefault;
  return (
    <div
      ref={root}
      className={`mx-auto flex min-h-full w-full flex-col px-4 pb-8 pl-14 pt-12 sm:pr-14 ${wide ? "" : "max-w-3xl"} ${
        page.font ? FONT[page.font] : ""
      } ${page.smallText ? "text-sm" : ""} ${prefs.focusMode ? "focus-mode" : ""}`}
      data-locked={page.locked || undefined}
      onMouseDown={onMouseDown}
      onDragEnd={() => setDrop(null)}
      onDragOver={(event) => event.dataTransfer.types.includes("Files") && event.preventDefault()}
      onDrop={onFileDrop}
    >
      <input
        ref={coverInput}
        type="file"
        accept="image/*"
        aria-label="Cover image"
        className="sr-only"
        onChange={(event) => setCover(event.target.files?.[0])}
      />
      {page.cover && (
        <div className="group/cover relative mb-4 h-44 overflow-hidden rounded bg-muted">
          {/* eslint-disable-next-line @next/next/no-img-element -- a file from this browser's own storage */}
          {coverUrl && <img src={coverUrl} alt="" className="h-full w-full object-cover" />}
          <div className="absolute bottom-2 right-2 flex gap-1 text-xs opacity-0 focus-within:opacity-100 group-hover/cover:opacity-100">
            <button type="button" className="rounded bg-background px-2 py-1 shadow" onClick={() => coverInput.current?.click()}>
              Change cover
            </button>
            <button
              type="button"
              className="rounded bg-background px-2 py-1 shadow"
              onClick={() => store.commit([{ op: "update", id: pageId, patch: { cover: undefined } }])}
            >
              Remove
            </button>
          </div>
        </div>
      )}
      <div className="group/title relative">
        <button
          type="button"
          aria-label={page.icon ? "Change icon" : "Add icon"}
          className={
            page.icon
              ? "mb-2 rounded text-6xl leading-none hover:bg-muted"
              : "mb-1 rounded px-1 text-sm text-subtle opacity-0 hover:bg-muted focus:opacity-100 group-hover/title:opacity-100"
          }
          onClick={() => setPickingIcon(true)}
        >
          {page.icon ?? "☺ Add icon"}
        </button>
        {!page.cover && (
          <button
            type="button"
            className="mb-1 ml-1 rounded px-1 text-sm text-subtle opacity-0 hover:bg-muted focus:opacity-100 group-hover/title:opacity-100"
            onClick={() => coverInput.current?.click()}
          >
            🖼 Add cover
          </button>
        )}
        {pickingIcon && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setPickingIcon(false)} />
            <div className="absolute z-20 grid w-64 grid-cols-6 gap-1 rounded-xl glass p-2">
              {ICONS.map((icon) => (
                <button
                  key={icon}
                  type="button"
                  className="rounded p-1 text-xl hover:bg-muted"
                  onClick={() => {
                    store.commit([{ op: "update", id: pageId, patch: { icon } }]);
                    setPickingIcon(false);
                  }}
                >
                  {icon}
                </button>
              ))}
              {page.icon && (
                <button
                  type="button"
                  className="col-span-6 rounded p-1 text-sm text-subtle hover:bg-muted"
                  onClick={() => {
                    store.commit([{ op: "update", id: pageId, patch: { icon: undefined } }]);
                    setPickingIcon(false);
                  }}
                >
                  Remove icon
                </button>
              )}
            </div>
          </>
        )}
        <Editable
          {...editableProps(page)}
          className="mb-4 text-4xl font-bold"
          placeholder="Untitled"
          placeholderAlways
        />
      </div>

      {records[page.parent ?? ""]?.type === "database" && <RowProperties row={page} database={records[page.parent!]} />}

      {renderBlocks(pageId)}

      {linkedFrom.length > 0 && (
        <aside aria-label="Linked from" className="mt-8 border-t border-border pt-2 text-sm text-subtle">
          Linked from
          {linkedFrom.map((id) => (
            <button key={id} type="button" className="ml-2 rounded px-1 underline hover:bg-muted" onClick={() => openPage(id)}>
              {pageTitle(records, id)}
            </button>
          ))}
        </aside>
      )}

      <div
        className="min-h-24 flex-1 cursor-text"
        onClick={() => {
          if (boxSelected || page.locked) return;
          const lastBlock = records[page.content.at(-1) ?? ""];
          const reusable = lastBlock?.type === "text" && lastBlock.text === "" && lastBlock.content.length === 0;
          if (reusable) focusBlock({ id: lastBlock.id, at: 0 });
          else addBlockAfter(pageId, lastBlock?.id ?? null);
        }}
      />

      {toolbar && !page.locked && <FormatToolbar at={toolbar} />}

      {slash && slashItems.length > 0 && (
        <ul
          role="listbox"
          className="fixed z-20 max-h-72 w-64 overflow-auto rounded-xl glass p-1"
          style={{ top: slash.top, left: slash.left }}
        >
          {slashItems.map((item, index) => (
            <li
              key={item.key}
              role="option"
              aria-selected={index === slash.index}
              className={`cursor-pointer rounded px-2 py-1 ${index === slash.index ? "bg-muted" : ""}`}
              // mousedown, not click: picking must happen before the block loses focus
              onMouseDown={(event) => {
                event.preventDefault();
                pickSlash(item);
              }}
            >
              <div className="text-sm">{item.label}</div>
              {item.hint && <div className="text-xs text-subtle">{item.hint}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
