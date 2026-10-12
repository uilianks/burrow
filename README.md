# Burrow

A block-based notes app for Windows and Linux. You download it, it runs on your own computer, and your notes live in a folder you can see, copy and back up yourself. There are no accounts and nothing is sent anywhere.

## Run

```bash
npm run desktop   # build and open the desktop app
npm run dist      # build the downloads into release/: a Linux AppImage and a Windows zip
npm run dev       # the editor alone in a browser at http://localhost:3000, for development
npm test          # unit tests
```

`npm run dist:installer` builds a Windows setup program instead of a zip; it needs Wine installed when run on Linux.

`npm run build` also writes `out/THIRD_PARTY_NOTICES.txt`, the licenses of the bundled packages and fonts (bundling strips their headers); `npm run dist` puts it next to the app's executable.

`site/` is the download page: plain static files, separate from the app. Its buttons link to the files attached to the latest GitHub release (`Burrow-linux.AppImage`, `Burrow-windows.zip`), so publishing a release with those two files from `release/` is all it needs. `npm run demo` re-records the page's video (`site/demo.mp4`) by driving the editor with Playwright; it needs `ffmpeg`.

## Your notes folder

The desktop app keeps everything in one folder, `Documents/Burrow` unless you pick another from the `⋯` menu:

| In the folder | What it is |
| --- | --- |
| `burrow.json` | Every page and block. This is the file to back up; it is also a valid file for "Import a backup". |
| `burrow.json.bak` | The notes as they were when the app was last opened. |
| `attachments/` | Uploaded files, each under its original name with an id in front. |
| `.burrow/` | Settings and page history. |
| `plugins/` | One folder per plugin, and the list of which are turned on. |
| `Markdown/` | A readable copy of every page as a `.md` file, in folders that follow your page tree. Burrow rewrites it as you edit, so changes made there by hand are not read back. |

If `burrow.json` can't be read, Burrow sets it aside under another name and opens the backup copy rather than writing over it.

## Using it

- Type `/` in a block to pick a block type: text kinds (headings, toggle headings, to-do, lists, toggle, quote, callout, code), divider, sub-page, image, video, audio, file, web bookmark, embed, equation, table, table of contents, 2 or 3 columns, synced block.
- Paste or drag in files from your computer to add them; images, video and audio show in place. Type `:name` for an emoji.
- A code block set to "Mermaid diagram" draws the diagram under the code.
- A synced block shows the same content wherever it is placed: use "Copy to paste on another page" in its handle menu, then paste on the other page.
- Start a line with `#`, `##`, `###`, `-`, `1.`, `[]`, `>` or ` ``` ` and press space.
- Tab nests a block under the one above; Shift+Tab moves it back out. Toggle blocks hide and show what is nested in them.
- Drag the `⋮⋮` handle to reorder; click it to delete, duplicate, align or change a block's type.
- Select text for the formatting bar (bold, italic, underline, strikethrough, inline code, link, text colour and highlight). Ctrl+B / Ctrl+I / Ctrl+U also work.
- Select whole blocks with Esc, Shift+↑/↓ past the edge of a block, Shift+click, or Ctrl+A twice. Then: Backspace deletes, Tab / Shift+Tab indents, Ctrl+D duplicates, Ctrl+C / Ctrl+X copies or cuts as Markdown, and dragging one handle moves them all. The handle menu applies to the whole selection.
- Pasting several lines creates blocks, reading Markdown (headings, lists, to-dos, quotes, code fences, indentation).
- Code blocks have a language picker and syntax colouring.
- Ctrl+Z undoes, Ctrl+Shift+Z redoes.
- Ctrl+K searches page titles and text, and runs commands (new page, today's note, templates, export, theme…).
- Link pages as you type: `[[` lists pages to link (or offers to create one), `[[Page name]]` typed in full links or creates it, and `[[Page name|other words]]` links with your own words. To link words already written, select them and press `[[ ]]` in the formatting bar. `@` also mentions a page or inserts today's date.
- A linked page lists what links to it. The sidebar's Graph draws pages and links; you choose the layout, which lines and pages to show, sizes, colours and names, and it remembers your choices.
- Settings (sidebar, or Ctrl+,) holds the notes folder and backups, theme, accent colour, transparency, editor defaults, spell check and plugins.
- Deleting a page sends it to the Trash (sidebar), where it can be restored or deleted for good.
- The `⋯` menu also has: Favourite, Use as a template, Page history (a version is kept every couple of minutes while you edit), Export as Markdown, and backup export / import.
- `/database` adds a database: rows with typed properties, shown as a table, board, calendar, gallery or list, each view with its own filters and sorts. Rows open as pages. Formulas such as `prop("Qty") * 2` are supported, and rows go in and out as CSV.
- Databases also have relation and rollup properties, grouping, and timeline, chart and form views. "Copy a linked view" in a database's `⋯` panel, then paste on any page, shows the same rows there with separate views.
- A template button (slash menu) adds a copy of the blocks inside it each time it is pressed. Dropping a block on another block's right edge puts them in columns.
- A block's handle menu has "Comment…" and "Remind me at". Flashcards (sidebar) reviews every toggle that has something inside it.
- Type `$$x^2$$` for inline math; click it to edit. `⋯` → "Lock page" stops accidental edits; "Verified" marks a page as checked, optionally for a limited time.
- Databases can open on their own page ("Full page"), take person and file properties, sub-items, a row template for new rows, and automations ("when Status becomes Done, set Finished to @today").
- Import also reads web pages (`.html`).
- Plugins add commands, block types, settings and sidebar entries: see `docs/plugins.md`. `examples/plugins/ai-assistant` is an AI helper that uses your own Claude API key or a local model.
- Hover above a page title to add an icon or a cover image. The `⋯` menu sets the page's width, font and text size, plus full width by default, focus mode and the light / dark theme.
- Drag pages in the sidebar to reorder them or drop one inside another.

## How it is put together

- `src/lib/store.ts` — every page and block is one record. All changes go through `commit(ops)`, which applies a small set of operations (`set`, `update`, `insert`, `remove`), records their inverse for undo, and hands the changed records to a `Persistence` backend.
- `src/lib/commands.ts` — editing actions (split, merge, indent, move, delete a tree) expressed as ops.
- `src/lib/tree.ts` — read-only helpers over the block tree (on-screen order, page trail, sub-pages).
- `src/lib/markdown.ts` — blocks to Markdown and back. `src/lib/highlight.ts` — code tokenizer and highlight painting.
- `src/lib/database.ts`, `formula.ts`, `csv.ts` — database properties, filtering, sorting, grouping, the formula language and CSV.
- `src/lib/search.ts`, `snapshot.ts`, `history.ts`, `transfer.ts` — search and backlinks, page versions, backup and Markdown export / import.
- `src/lib/files.ts` — uploaded files, kept in a second IndexedDB database behind a small `FileStore` interface.
- `src/lib/prefs.ts` — settings (theme, accent, transparency, editor defaults, graph options), kept in localStorage and, in the desktop app, in the notes folder.
- `src/lib/links.ts`, `graph.ts` — page links, and what the graph draws and where.
- `src/lib/idb.ts` — the IndexedDB `Persistence`. A server-sync backend would implement the same two-method interface.
- `src/components/` — `Workspace` (shell, routing by URL hash), `Sidebar` (page tree), `Editor` (keyboard, selection, slash menu, drag and drop), `blocks` (how each text block renders), `richBlocks` (media, bookmark, embed, equation, table, contents, diagrams), `FormatToolbar`, `Database` (the five views and property editors), `Palette` (Ctrl+K), `Settings`, `Dialogs` (trash, history, graph, flashcards).

There are no accounts, sync or sharing. When the editor runs in a plain browser (development, tests) it stores notes in the browser's IndexedDB instead of a folder; `src/lib/desktop.ts` is the seam between the two, and `desktop/` is the Electron shell that does the disk work.

---

# Roadmap
