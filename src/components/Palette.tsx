"use client";

import { useState } from "react";
import { search } from "@/lib/search";
import { openPage, useRecords } from "@/lib/workspace";
import { pageTitle } from "./Sidebar";

export interface Command {
  label: string;
  run: () => void;
}

/** Ctrl+K: jump to a page by title or text, or run a command. */
export function Palette({ commands, recents, onClose }: { commands: Command[]; recents: string[]; onClose: () => void }) {
  const records = useRecords();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);

  const wanted = query.trim().toLowerCase();
  const pages: Command[] = wanted
    ? search(records, query, 12).map((result) => ({
        label: result.snippet ? `${result.title} — ${result.snippet}` : result.title || "Untitled",
        run: () => openPage(result.page),
      }))
    : recents
        .filter((id) => records[id]?.type === "page" && !records[id].trashed)
        .map((id) => ({ label: pageTitle(records, id), run: () => openPage(id) }));
  const sections = [
    { title: wanted ? "Pages" : "Recent", items: pages },
    { title: "Commands", items: commands.filter((command) => command.label.toLowerCase().includes(wanted)) },
  ].filter((section) => section.items.length);
  const items = sections.flatMap((section) => section.items);
  const active = Math.min(index, items.length - 1);

  const choose = (item: Command | undefined) => {
    if (!item) return;
    onClose();
    item.run();
  };

  return (
    <div className="fixed inset-0 z-30 flex items-start justify-center bg-black/30 p-4 pt-[12vh]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label="Search and commands"
        className="w-full max-w-xl overflow-hidden rounded-2xl glass"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <input
          autoFocus
          aria-label="Search pages or run a command"
          placeholder="Search pages or run a command…"
          className="w-full border-b border-border bg-transparent px-4 py-3 outline-none"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setIndex(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") onClose();
            else if (event.key === "Enter") choose(items[active]);
            else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setIndex((active + (event.key === "ArrowDown" ? 1 : -1) + items.length) % Math.max(items.length, 1));
            }
          }}
        />
        <div className="max-h-[50vh] overflow-auto p-1">
          {items.length === 0 && <div className="px-3 py-2 text-sm text-subtle">Nothing matches “{query}”.</div>}
          {sections.map((section) => (
            <div key={section.title}>
              <div className="px-3 pb-1 pt-2 text-xs text-subtle">{section.title}</div>
              {section.items.map((item) => (
                <button
                  key={`${section.title}:${items.indexOf(item)}`}
                  type="button"
                  className={`block w-full truncate rounded px-3 py-1.5 text-left text-sm ${items[active] === item ? "bg-muted" : ""}`}
                  onMouseEnter={() => setIndex(items.indexOf(item))}
                  onClick={() => choose(item)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
