"use client";

import { useEffect, useState } from "react";
import { exportBackup, exportPage, exportPageHtml, importFile, openToday } from "@/lib/actions";
import { desktop } from "@/lib/desktop";
import { mirrorFiles } from "@/lib/mirror";
import { copyPage, createPage, restorePage, seed, trashPage } from "@/lib/commands";
import { maybeSaveVersion } from "@/lib/history";
import { loadPlugins, notify, setShownPage, usePlugins } from "@/lib/plugins";
import { ACCENTS, loadSavedPrefs, setPref, usePrefs } from "@/lib/prefs";
import { dueReminders } from "@/lib/search";
import { subtree } from "@/lib/snapshot";
import { ROOT, type Block } from "@/lib/store";
import { childPages, isTrashed, pageTrail } from "@/lib/tree";
import { openPage, store, useHash, useRecords } from "@/lib/workspace";
import { FlashcardsDialog, GraphDialog, HistoryDialog, TrashDialog } from "./Dialogs";
import { DatabaseBlock } from "./Database";
import { Editor } from "./Editor";
import { Palette, type Command } from "./Palette";
import { SettingsDialog, type SettingsTab } from "./Settings";
import { pageTitle, Sidebar, type DialogName } from "./Sidebar";

/** What the "Verified" choice stores: nothing, or when it was verified and for how many days (0 = no end). */
const verification = (choice: string) => {
  if (choice === "no") return undefined;
  const at = Date.now();
  return { at, until: Number(choice) ? at + Number(choice) * 86400000 : undefined };
};

const IMPORT_INPUT = "burrow-import-file";
const pickImportFile = () => document.getElementById(IMPORT_INPUT)?.click();

export function Workspace() {
  const records = useRecords();
  const hash = useHash();
  const prefs = usePrefs();
  const [ready, setReady] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [importFailed, setImportFailed] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [dialog, setDialog] = useState<DialogName | null>(null);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("general");
  const openSettings = (tab: SettingsTab) => {
    setSettingsTab(tab);
    setDialog("settings");
  };
  const [folder, setFolder] = useState<string | null>(null);
  // the moment this window was opened: good enough for "has this page's verification run out?"
  const [openedAt] = useState(() => Date.now());
  const plugins = usePlugins();

  // a notice from a plugin stays up for a few seconds
  useEffect(() => {
    if (!plugins.message) return;
    const timer = setTimeout(() => notify(null), 5000);
    return () => clearTimeout(timer);
  }, [plugins.message]);

  useEffect(() => {
    const root = document.documentElement;
    if (prefs.theme === "system") delete root.dataset.theme;
    else root.dataset.theme = prefs.theme;
    root.style.setProperty("--accent", ACCENTS[prefs.accent] ?? ACCENTS.blue);
    root.toggleAttribute("data-solid", prefs.reduceTransparency);
  }, [prefs.theme, prefs.accent, prefs.reduceTransparency]);

  useEffect(() => {
    store.onSaveError = (error) => {
      console.error(error);
      setSaveFailed(true);
    };
    store
      .load(seed)
      // plugins start once the notes are there for them to read
      .then(async () => {
        const bridge = desktop();
        if (!bridge) return;
        const found = await bridge.listPlugins();
        const saved = await Promise.all(found.filter((plugin) => plugin.enabled).map(async (plugin) => [plugin.id, (await bridge.readData(`plugin-${plugin.id}`)) ?? {}]));
        loadPlugins(found, Object.fromEntries(saved));
      })
      .catch(() => {})
      .then(() => loadSavedPrefs().catch(() => {}))
      .then(() => setReady(true));
    desktop()?.onSaveFailed(() => setSaveFailed(true));
    desktop()?.folder().then(setFolder);

    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key === ",") {
        event.preventDefault();
        setDialog((open) => (open === "settings" ? null : "settings"));
      } else if (key === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      } else if (key === "z") {
        event.preventDefault();
        if (event.shiftKey) store.redo();
        else store.undo();
      }
    };
    window.addEventListener("keydown", onKeyDown);

    // Reminders: say so here and, where the system allows, with a desktop notification. Each fires once.
    const reminders = setInterval(() => {
      for (const block of dueReminders(store.getSnapshot(), Date.now())) {
        const text = block.text.replace(/<[^>]*>/g, "") || "A block you marked";
        notify(`Reminder: ${text}`);
        if ("Notification" in window && Notification.permission === "granted") new Notification("Burrow reminder", { body: text });
        store.commit([{ op: "update", id: block.id, patch: { reminded: true } }]);
      }
    }, 15000);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      clearInterval(reminders);
    };
  }, []);

  // A database can be opened on its own, filling the window, the same way a page is.
  const databaseId = ready && records[hash]?.type === "database" && !isTrashed(records, hash) ? hash : undefined;
  const pageId = !ready || databaseId ? undefined : hash !== ROOT && records[hash]?.type === "page" ? hash : childPages(records, ROOT)[0];

  useEffect(() => setShownPage(pageId ?? null), [pageId]);

  useEffect(() => {
    if (pageId && prefs.recents[0] !== pageId) setPref("recents", [pageId, ...prefs.recents.filter((id) => id !== pageId)].slice(0, 8));
  }, [pageId, prefs.recents]);

  // Keep a version of the open page once the writing pauses (history.ts decides whether one is due).
  useEffect(() => {
    if (!pageId) return;
    const timer = setTimeout(() => maybeSaveVersion(pageId, subtree(records, pageId)).catch(() => {}), 3000);
    return () => clearTimeout(timer);
  }, [records, pageId]);

  // Desktop: keep the readable Markdown copy of every page in step, once the writing pauses.
  useEffect(() => {
    const bridge = desktop();
    if (!bridge || !ready) return;
    const timer = setTimeout(() => bridge.mirror(mirrorFiles(records)).catch(() => setSaveFailed(true)), 2000);
    return () => clearTimeout(timer);
  }, [records, ready]);

  if (!ready) return null;

  const page = pageId ? records[pageId] : undefined;
  const trail = pageTrail(records, databaseId ?? pageId ?? "");
  const inTrash = pageId ? pageTrail(records, pageId).find((id) => records[id].trashed) : undefined;
  const verificationExpired = !!page?.verified?.until && page.verified.until < openedAt;
  const updatePage = (patch: Partial<Block>) => page && store.commit([{ op: "update", id: page.id, patch }]);
  const row = "flex w-full items-center justify-between gap-2 rounded px-1 py-1 text-left hover:bg-muted";
  const select = "rounded border border-border bg-background px-1";
  const closing = (run: () => void) => () => {
    setMenuOpen(false);
    run();
  };

  const pageCommands: Command[] = page
    ? [
        { label: "Export this page as Markdown", run: () => exportPage(page.id) },
        { label: "Export this page as a web page (HTML)", run: () => exportPageHtml(page.id) },
        { label: "Page history", run: () => setDialog("history") },
        { label: page.favorite ? "Remove from favourites" : "Add to favourites", run: () => updatePage({ favorite: !page.favorite }) },
        { label: "Move this page to the trash", run: () => trashPage(store, page.id) },
      ]
    : [];
  const templates = Object.values(records).filter((block) => block.template && !isTrashed(records, block.id));
  const commands: Command[] = [
    { label: "New page", run: () => openPage(createPage(store)) },
    { label: "Open today’s note", run: openToday },
    ...templates.map((template) => ({
      label: `New page from template: ${pageTitle(records, template.id)}`,
      run: () => openPage(copyPage(store, template.id)),
    })),
    ...pageCommands,
    ...plugins.commands.map((command) => ({ label: command.name, run: command.run })),
    { label: "Settings", run: () => openSettings("general") },
    { label: "Plugins", run: () => openSettings("plugins") },
    { label: "Review flashcards", run: () => setDialog("cards") },
    { label: "Open the graph of pages", run: () => setDialog("graph") },
    { label: "Open the trash", run: () => setDialog("trash") },
    { label: "Export a backup of everything", run: exportBackup },
    { label: "Import a backup, web page or Markdown file", run: pickImportFile },
    { label: prefs.focusMode ? "Leave focus mode" : "Enter focus mode", run: () => setPref("focusMode", !prefs.focusMode) },
    ...(["light", "dark", "system"] as const).map((theme) => ({ label: `Theme: ${theme}`, run: () => setPref("theme", theme) })),
  ];

  return (
    <div className="wallpaper flex h-dvh gap-2 p-2">
      {sidebarOpen && !prefs.focusMode && <Sidebar current={pageId ?? databaseId} onSearch={() => setPaletteOpen(true)} onDialog={setDialog} />}
      <main className="sheet flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl">
        <header
          className={`flex items-center gap-1 px-2 py-1 text-sm text-subtle ${
            prefs.focusMode ? "opacity-0 transition-opacity focus-within:opacity-100 hover:opacity-100" : ""
          }`}
        >
          <button type="button" aria-label="Toggle sidebar" className="h-7 w-7 rounded hover:bg-muted" onClick={() => setSidebarOpen((open) => !open)}>
            ☰
          </button>
          {trail.map((id, index) => (
            <span key={id} className="flex min-w-0 items-center gap-1">
              {index > 0 && <span>/</span>}
              <button type="button" className="truncate rounded px-1 hover:bg-muted" onClick={() => openPage(id)}>
                {pageTitle(records, id)}
              </button>
            </span>
          ))}
          {databaseId && <span className="truncate px-1">/ {records[databaseId].text || "Untitled database"}</span>}
          {page?.verified &&
            (verificationExpired ? (
              <span className="text-red-600" title="This page was marked verified for a limited time, which has passed. Check it and verify it again.">
                ⚠ Verification expired
              </span>
            ) : (
              <span title={`Marked as checked and current on ${new Date(page.verified.at).toLocaleDateString()}`}>✔ Verified</span>
            ))}
          {page?.locked && <span title="This page is locked. Unlock it from the ⋯ menu.">🔒 Locked</span>}
          <div className="relative ml-auto">
            <button
              type="button"
              aria-label="Page and display options"
              aria-expanded={menuOpen}
              className="h-7 w-7 rounded hover:bg-muted"
              onClick={() => setMenuOpen((open) => !open)}
            >
              ⋯
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 z-20 w-64 rounded-xl glass p-2 text-foreground">
                  {page && (
                    <>
                      <div className="px-1 pb-1 text-xs text-subtle">This page</div>
                      <label className={row}>
                        Favourite
                        <input type="checkbox" checked={!!page.favorite} onChange={(event) => updatePage({ favorite: event.target.checked })} />
                      </label>
                      <label className={row}>
                        Use as a template
                        <input type="checkbox" checked={!!page.template} onChange={(event) => updatePage({ template: event.target.checked })} />
                      </label>
                      <label className={row}>
                        Verified
                        <select
                          aria-label="Verified"
                          className={select}
                          value={page.verified ? String(page.verified.until ? Math.round((page.verified.until - page.verified.at) / 86400000) : 0) : "no"}
                          onChange={(event) => updatePage({ verified: verification(event.target.value) })}
                        >
                          <option value="no">No</option>
                          <option value="0">Yes, until I say otherwise</option>
                          <option value="30">Yes, for 30 days</option>
                          <option value="90">Yes, for 90 days</option>
                          <option value="365">Yes, for a year</option>
                        </select>
                      </label>
                      <label className={row}>
                        Lock page
                        <input type="checkbox" checked={!!page.locked} onChange={(event) => updatePage({ locked: event.target.checked })} />
                      </label>
                      <label className={row}>
                        Full width
                        <input
                          type="checkbox"
                          checked={page.fullWidth ?? prefs.fullWidthDefault}
                          onChange={(event) => updatePage({ fullWidth: event.target.checked })}
                        />
                      </label>
                      <label className={row}>
                        Small text
                        <input type="checkbox" checked={!!page.smallText} onChange={(event) => updatePage({ smallText: event.target.checked })} />
                      </label>
                      <label className={row}>
                        Font
                        <select
                          className={select}
                          value={page.font ?? "default"}
                          onChange={(event) =>
                            updatePage({ font: event.target.value === "default" ? undefined : (event.target.value as Block["font"]) })
                          }
                        >
                          <option value="default">Default</option>
                          <option value="serif">Serif</option>
                          <option value="mono">Mono</option>
                        </select>
                      </label>
                      <button type="button" className={row} onClick={closing(() => setDialog("history"))}>
                        Page history
                      </button>
                      <button type="button" className={row} onClick={closing(() => exportPage(page.id))}>
                        Export as Markdown
                      </button>
                      <button type="button" className={row} onClick={closing(() => exportPageHtml(page.id))}>
                        Export as a web page
                      </button>
                      <button type="button" className={row} onClick={closing(() => trashPage(store, page.id))}>
                        Move to trash
                      </button>
                    </>
                  )}
                  <button type="button" className={row} onClick={closing(() => openSettings("general"))}>
                    Settings…
                  </button>
                </div>
              </>
            )}
          </div>
        </header>
        <input
          id={IMPORT_INPUT}
          type="file"
          accept=".json,.md,.markdown,.txt,.html,.htm"
          aria-label="File to import"
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) importFile(file).then(() => setImportFailed(null), (cause: Error) => setImportFailed(cause.message));
          }}
        />
        {saveFailed && (
          <p role="alert" className="bg-red-600 px-3 py-1 text-sm text-white">
            Changes can’t be saved right now{folder ? ` to ${folder}` : ""}. Check that the folder still exists and has free space; anything you
            write may be lost when you close Burrow.
          </p>
        )}
        {importFailed && (
          <p role="alert" className="flex items-center justify-between bg-red-600 px-3 py-1 text-sm text-white">
            That file couldn’t be imported. {importFailed}
            <button type="button" aria-label="Dismiss" className="rounded px-2 hover:bg-white/20" onClick={() => setImportFailed(null)}>
              ×
            </button>
          </p>
        )}
        {inTrash && (
          <p role="status" className="flex items-center gap-2 bg-muted px-3 py-1 text-sm">
            {inTrash === pageId ? "This page is in the trash." : `This page is inside “${pageTitle(records, inTrash)}”, which is in the trash.`}
            <button type="button" className="rounded border border-border bg-background px-2" onClick={() => restorePage(store, inTrash)}>
              Restore
            </button>
          </p>
        )}
        <div className="flex-1 overflow-auto">
          {databaseId ? (
            <div className="mx-auto w-full max-w-7xl p-8">
              <DatabaseBlock block={records[databaseId]} full />
            </div>
          ) : pageId ? (
            <Editor key={pageId} pageId={pageId} />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-subtle">
              <p>No pages yet.</p>
              <button
                type="button"
                className="rounded border border-border px-3 py-1 text-foreground hover:bg-muted"
                onClick={() => openPage(createPage(store))}
              >
                New page
              </button>
            </div>
          )}
        </div>
      </main>
      {paletteOpen && <Palette commands={commands} recents={prefs.recents} onClose={() => setPaletteOpen(false)} />}
      {plugins.message && (
        <p role="status" aria-label="Notice" className="fixed bottom-4 right-4 z-40 max-w-sm rounded-xl glass px-3 py-2 text-sm">
          {plugins.message}
        </p>
      )}
      {dialog === "settings" && <SettingsDialog tab={settingsTab} onTab={setSettingsTab} onImport={pickImportFile} onClose={() => setDialog(null)} />}
      {dialog === "cards" && <FlashcardsDialog onClose={() => setDialog(null)} />}
      {dialog === "trash" && <TrashDialog onClose={() => setDialog(null)} />}
      {dialog === "graph" && <GraphDialog current={pageId} onClose={() => setDialog(null)} />}
      {dialog === "history" && pageId && <HistoryDialog pageId={pageId} onClose={() => setDialog(null)} />}
    </div>
  );
}
