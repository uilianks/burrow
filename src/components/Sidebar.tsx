"use client";

import { useState, type DragEvent } from "react";
import { openToday } from "@/lib/actions";
import { createPage, moveTo, trashPage } from "@/lib/commands";
import { htmlToText } from "@/lib/dom";
import { usePlugins } from "@/lib/plugins";
import { ROOT, type Records } from "@/lib/store";
import { childPages, isTrashed } from "@/lib/tree";
import { openPage, store, useRecords } from "@/lib/workspace";

export const pageTitle = (records: Records, id: string) => htmlToText(records[id]?.text ?? "") || "Untitled";

const DRAG_TYPE = "application/x-burrow-page";
type Zone = "before" | "inside" | "after";
const ZONE_STYLE: Record<Zone, string> = {
  before: "shadow-[inset_0_2px_0_var(--accent)]",
  inside: "bg-border",
  after: "shadow-[inset_0_-2px_0_var(--accent)]",
};

export type DialogName = "trash" | "graph" | "history" | "settings" | "cards";

export function Sidebar({
  current,
  onSearch,
  onDialog,
}: {
  current: string | undefined;
  onSearch: () => void;
  onDialog: (dialog: DialogName) => void;
}) {
  const records = useRecords();
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [drop, setDrop] = useState<{ id: string; zone: Zone } | null>(null);
  const pluginItems = usePlugins().sidebar;

  const toggle = (id: string) =>
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const favorites = Object.values(records).filter((block) => block.favorite && !isTrashed(records, block.id));
  const trashed = Object.values(records).filter((block) => block.trashed).length;
  const entry = "rounded-lg px-2 py-1 text-left text-sm text-subtle hover:bg-foreground/8";

  // Top and bottom quarters of a row drop next to the page; the middle drops inside it.
  const zoneAt = (event: DragEvent<HTMLElement>): Zone => {
    const rect = event.currentTarget.getBoundingClientRect();
    const position = (event.clientY - rect.top) / rect.height;
    return position < 0.25 ? "before" : position > 0.75 ? "after" : "inside";
  };

  const onDragOver = (id: string, event: DragEvent<HTMLElement>) => {
    if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
    event.preventDefault();
    const zone = zoneAt(event);
    if (drop?.id !== id || drop.zone !== zone) setDrop({ id, zone });
  };

  const onDrop = (id: string, event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    const dragged = event.dataTransfer.getData(DRAG_TYPE);
    const target = records[id];
    const zone = zoneAt(event);
    if (dragged && dragged !== id && target?.parent) {
      if (zone === "inside") {
        moveTo(store, dragged, id, target.content.filter((child) => child !== dragged).at(-1) ?? null);
      } else {
        const order = records[target.parent].content.filter((child) => child !== dragged);
        moveTo(store, dragged, target.parent, zone === "before" ? (order[order.indexOf(id) - 1] ?? null) : id);
      }
    }
    setDrop(null);
  };

  const renderPage = (id: string, depth: number) => {
    const children = childPages(records, id);
    const open = !collapsed.has(id);
    const highlight = drop?.id === id ? ZONE_STYLE[drop.zone] : id === current ? "bg-accent/15 font-medium text-accent" : "";
    return (
      <li key={id}>
        <div
          draggable
          className={`group flex items-center rounded pr-1 hover:bg-foreground/8 ${highlight}`}
          style={{ paddingLeft: depth * 12 }}
          onDragStart={(event) => {
            event.dataTransfer.setData(DRAG_TYPE, id);
            event.dataTransfer.effectAllowed = "move";
          }}
          onDragOver={(event) => onDragOver(id, event)}
          onDragLeave={(event) => {
            // moving between the row's own buttons also fires dragleave
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDrop(null);
          }}
          onDrop={(event) => onDrop(id, event)}
          onDragEnd={() => setDrop(null)}
        >
          <button
            type="button"
            aria-label={open ? "Collapse" : "Expand"}
            className={`h-6 w-5 shrink-0 text-xs text-subtle ${children.length ? "" : "invisible"}`}
            onClick={() => toggle(id)}
          >
            {open ? "▾" : "▸"}
          </button>
          <button type="button" className="min-w-0 flex-1 truncate py-1 text-left text-sm" onClick={() => openPage(id)}>
            {records[id]?.icon && <span className="mr-1">{records[id].icon}</span>}
            {pageTitle(records, id)}
          </button>
          <button
            type="button"
            aria-label="Move page to trash"
            className="h-6 w-5 shrink-0 text-subtle opacity-0 hover:text-foreground focus:opacity-100 group-hover:opacity-100"
            onClick={() => trashPage(store, id)}
          >
            ×
          </button>
          <button
            type="button"
            aria-label="Add a page inside"
            className="h-6 w-5 shrink-0 text-subtle opacity-0 hover:text-foreground focus:opacity-100 group-hover:opacity-100"
            onClick={() => openPage(createPage(store, id))}
          >
            +
          </button>
        </div>
        {open && children.length > 0 && <ul>{children.map((child) => renderPage(child, depth + 1))}</ul>}
      </li>
    );
  };

  return (
    <nav className="glass flex h-full w-64 shrink-0 flex-col gap-2 overflow-auto rounded-2xl p-2">
      <div className="px-2 pt-1 text-sm font-semibold">Burrow</div>
      <div className="flex flex-col">
        <button type="button" className={entry} onClick={onSearch}>
          🔍 Search <span className="float-right text-xs">Ctrl K</span>
        </button>
        <button type="button" className={entry} onClick={openToday}>
          📅 Today
        </button>
      </div>
      {favorites.length > 0 && (
        <div>
          <div className="px-2 text-xs text-subtle">Favourites</div>
          {favorites.map((page) => (
            <button
              key={page.id}
              type="button"
              className={`block w-full truncate rounded px-2 py-1 text-left text-sm hover:bg-foreground/8 ${page.id === current ? "bg-accent/15 font-medium text-accent" : ""}`}
              onClick={() => openPage(page.id)}
            >
              ★ {pageTitle(records, page.id)}
            </button>
          ))}
        </div>
      )}
      <div className="px-2 text-xs text-subtle">Pages</div>
      <ul>{childPages(records, ROOT).map((id) => renderPage(id, 0))}</ul>
      <button
        type="button"
        className="rounded px-2 py-1 text-left text-sm text-subtle hover:bg-foreground/8"
        onClick={() => openPage(createPage(store))}
      >
        + New page
      </button>
      <div className="mt-auto flex flex-col border-t border-border pt-2">
        {pluginItems.map((item, index) => (
          <button key={index} type="button" className={entry} onClick={item.run}>
            🧩 {item.label}
          </button>
        ))}
        <button type="button" className={entry} onClick={() => onDialog("cards")}>
          🃏 Flashcards
        </button>
        <button type="button" className={entry} onClick={() => onDialog("graph")}>
          🕸 Graph
        </button>
        <button type="button" className={entry} onClick={() => onDialog("settings")}>
          ⚙ Settings <span className="float-right text-xs">Ctrl ,</span>
        </button>
        <button type="button" className={entry} onClick={() => onDialog("trash")}>
          🗑 Trash{trashed ? ` (${trashed})` : ""}
        </button>
      </div>
    </nav>
  );
}
