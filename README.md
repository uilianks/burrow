# Folio

A block-based notes app for Windows and Linux. You download it, it runs on your own computer, and your notes live in a folder you can see, copy and back up yourself. There are no accounts and nothing is sent anywhere.

## Run

```bash
npm run desktop   # build and open the desktop app
npm run dist      # build the downloads into release/: a Linux AppImage and a Windows zip
npm run dev       # the editor alone in a browser at http://localhost:3000, for development
npm test          # unit tests
```

`npm run dist:installer` builds a Windows setup program instead of a zip; it needs Wine installed when run on Linux.

## Your notes folder

The desktop app keeps everything in one folder, `Documents/Folio` unless you pick another from the `⋯` menu:

| In the folder | What it is |
| --- | --- |
| `folio.json` | Every page and block. This is the file to back up; it is also a valid file for "Import a backup". |
| `folio.json.bak` | The notes as they were when the app was last opened. |
| `attachments/` | Uploaded files, each under its original name with an id in front. |
| `.folio/` | Settings and page history. |
| `plugins/` | One folder per plugin, and the list of which are turned on. |
| `Markdown/` | A readable copy of every page as a `.md` file, in folders that follow your page tree. Folio rewrites it as you edit, so changes made there by hand are not read back. |

If `folio.json` can't be read, Folio sets it aside under another name and opens the backup copy rather than writing over it.

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

Where Folio stands against Notion, what we'd add that Notion doesn't have, and the order to build it in.

The Notion inventory was compiled on 2026-10-12 from Notion's public product, releases and help pages plus general knowledge of the product. It was not checked feature-by-feature inside a logged-in workspace, so treat it as a planning list, not an audit.

Status: ✅ done · 🟡 partly done · ⬜ planned · ❌ not planned

## 1. Notion feature inventory

### Editor and blocks

| Feature | Folio | Phase |
| --- | --- | --- |
| Text, headings 1–3, bulleted / numbered / to-do lists, quote, callout, code, divider | ✅ | — |
| Slash menu, Markdown shortcuts, drag to reorder, duplicate, turn into | ✅ | — |
| Bold / italic / underline | ✅ | — |
| Undo / redo | ✅ | — |
| Selection toolbar: strikethrough, inline code, links | ✅ | — |
| Text and background colour | ✅ | — |
| Nested blocks (Tab / Shift+Tab indent) | ✅ | — |
| Toggle list | ✅ | — |
| Toggle headings | ✅ | — |
| Multi-block selection, bulk move / delete / copy | ✅ keyboard, Shift+click, or drag across the blank space beside the blocks | — |
| Copy and paste as Markdown, paste keeps line structure | ✅ | — |
| Code block language and syntax highlighting | ✅ 7 languages | — |
| Images, files, video, audio (upload, paste, drag in, or link) | ✅ no resize or captions yet | — |
| Embeds (YouTube, Vimeo, any https page that allows framing) | ✅ | — |
| Web bookmark | ✅ the desktop app fills in the page's title, description and picture | — |
| Columns (side-by-side blocks) | ✅ from the slash menu, or drop a block on another's right edge; no resizing | — |
| Simple table | ✅ | — |
| Math equations | ✅ block equations, and inline ones by typing `$$…$$` | — |
| Table of contents | ✅ | — |
| Synced blocks (same content shown in several pages) | ✅ | — |
| Inline emoji picker (`:name`) | ✅ about 400 emoji | — |
| Mermaid diagrams in code blocks | ✅ | — |

### Pages and organisation

| Feature | Folio | Phase |
| --- | --- | --- |
| Nested pages, sidebar tree, breadcrumbs, linkable URLs | ✅ | — |
| Page icon | ✅ | — |
| Page cover image | ✅ | — |
| Full-width pages | ✅ | — |
| Page font and small text | ✅ | — |
| Dark mode (system, light or dark) | ✅ | — |
| Move a page to another parent, reorder pages in the sidebar | ✅ | — |
| Quick find / search (Ctrl+K) | ✅ | — |
| Favourites and recently visited | ✅ | — |
| Trash with restore | ✅ | — |
| Links to pages, `@` mentions, backlinks | ✅ `[[ ]]` links as in Obsidian, links with their own words, mentions that follow renames, backlinks | — |
| Dates and reminders (`@today`, `@remind`) | ✅ `@today` / `@tomorrow`, and "Remind me at" on any block (shown in the app and as a desktop notification while Folio is open) | — |
| Templates and template buttons | ✅ | — |
| Page history (restore an earlier version) | ✅ last 30 versions per page, with a slider | — |
| Import (Markdown, HTML, CSV) and export (Markdown, HTML, PDF) | ✅ Markdown, HTML and CSV both ways, JSON backup both ways; PDF by printing the exported web page | — |
| Page lock, page verification, wikis | ✅ lock and verification (with an optional end date); no separate "wiki" mode | — |

### Databases

| Feature | Folio | Phase |
| --- | --- | --- |
| Database as a collection of pages with typed properties | ✅ text, number, select, multi-select, person, files, date, checkbox, link, formula, relation, rollup | — |
| Views: table, board, list, gallery, calendar, timeline | ✅ plus chart and form | — |
| Filter, sort, group, per-view layout | ✅ | — |
| Inline and full-page databases, linked views | ✅ | — |
| Relations and rollups | ✅ | — |
| Formulas | ✅ arithmetic, text, comparisons, `if`, and 14 functions | — |
| Database templates, sub-items, dependencies | 🟡 row templates and sub-items; no dependencies | — |
| Charts | ✅ bar chart of row counts or a number total per group | — |
| Forms that write into a database | ✅ as a view (not a shareable link: there is no server) | — |
| Buttons and database automations | ✅ template buttons, and "when a property becomes X, set another" rules | — |

### Collaboration and sharing

| Feature | Folio | Phase |
| --- | --- | --- |
| Accounts, workspaces, members and guests | ❌ no accounts by design | — |
| Sync across devices | ❌ built in; the notes folder can be put in any sync tool you already use (Syncthing, Dropbox, a git repository) | — |
| Real-time co-editing with presence | ❌ | — |
| Share a page with view / comment / edit permissions | ❌ | — |
| Comments, discussions, suggested edits | ✅ comments to yourself on any block | — |
| Mentions and notification inbox | ❌ | — |
| Publish a page to the web (Notion Sites) | ✅ as "Export as a web page": one HTML file you can host anywhere | — |
| Teamspaces, groups, SSO, audit log, admin console | ❌ | — |

### Platform, AI and adjacent products

| Feature | Folio | Phase |
| --- | --- | --- |
| Offline use | ✅ it never needs a connection | — |
| Keyboard shortcut set and high-contrast mode | 🟡 a few shortcuts | 1 |
| Desktop apps (Windows, macOS, Linux) | ✅ Windows and Linux; ❌ macOS | — |
| Mobile apps (iOS, Android) | ❌ | — |
| Public API and webhooks | ✅ as the plugin API (`docs/plugins.md`) | — |
| Integrations / connections (Slack, GitHub, Drive…) | ⬜ through plugins, none written yet | 6 |
| AI writing help, Q&A over your notes, autofill | 🟡 summarise, meeting notes and continue-writing through the sample AI plugin; no Q&A across all notes or autofill | — |
| AI agents, custom agents, skills, MCP | ❌ | — |
| AI meeting notes | 🟡 the AI plugin turns typed notes or a pasted transcript into meeting notes; it does not record or transcribe audio | — |
| Notion Calendar, Notion Mail, Marketplace | ❌ | — |

## 2. New ideas (not in Notion)

| Idea | Why | Phase |
| --- | --- | --- |
| **Plain Markdown folder** 🟡 — every page is also written as a `.md` file in your notes folder | Your notes stay readable without Folio, and work with git and other editors. One-way for now: edits to those files are not read back | Desktop app |
| **End-to-end encrypted sync** | Dropped with the move to a local-only app: there is no server to sync through | — |
| **Time travel** ✅ — page history keeps a version every couple of minutes; a slider moves through them and any can be restored | Get back what was lost without storing every keystroke | — |
| **Graph view** ✅ of pages and links, with layouts and display options you choose | See how notes connect | — |
| **Daily note** ✅ — "Today" in the sidebar opens today's page | Fast capture without deciding where things go | — |
| **Command palette** ✅ (Ctrl+K runs commands, not just search) | Whole app usable from the keyboard | — |
| **Text alignment** ✅ | Notion's own help centre lists it as unsupported | — |
| **"Full width by default" setting** ✅ | Also listed as unsupported by Notion | — |
| **Focus mode** ✅ — hide the chrome and dim every block but the current one | Long-form writing | — |
| **Flashcards from toggles** ✅ — review toggle blocks with spaced repetition | Turns notes into study material with no extra authoring | — |
| **Bring-your-own AI** ✅ — your own Claude API key or a model running on your computer | AI help without a subscription; with a local model nothing leaves the machine | — |

## 3. Implementation plan

Each phase ships on its own and leaves the app usable.

**Scope (changed 2026-10-12):** a downloadable desktop app for Windows and Linux, local-only like Obsidian. No accounts, no server, no mobile or macOS builds. The project is to be open source, and extendable through plugins.

### Phase 1 — Editor depth ✅
Done: nested blocks, toggle lists and toggle headings, selection toolbar with colours, block alignment, multi-block selection with bulk actions, Markdown copy and paste, code highlighting, page icon / width / font / text size, theme switch, full width by default, focus mode, moving pages in the sidebar.

Left over, folded into later phases: selecting blocks by dragging a box (phase 6) and the page cover image (phase 2, needs file storage).

### Phase 2 — Rich blocks ✅
Done: file storage, image / video / audio / file blocks (upload, paste, drag in, link), page cover, web bookmark, embeds, 2 and 3 columns, simple tables, block equations (KaTeX), Mermaid diagrams, table of contents, emoji picker, synced blocks.

Left over, folded into later phases:
- Inline equations, image resize and captions, dragging a block beside another to make columns (phase 3).
- Removing stored files and synced content that nothing points to any more: belongs with the trash in phase 3, because undo can still bring them back today.
- Bookmark previews fetched from the linked page (phase 6).

### Phase 3 — Find, link, keep ✅
Done: Ctrl+K search and command palette, recents, `@` mentions with backlinks, graph view, trash with restore and permanent delete (which also clears unused files and synced content), page history with restore, favourites, daily notes, templates, Markdown export and import, full JSON backup export and import, offline support, image captions and resizing. Edits are now also journalled as they happen, so closing the tab straight after typing no longer loses the last change.

Left over, folded into later phases: inline equations and drag-to-create columns (6), reminders (6); the Markdown folder copy is done as part of the desktop app, mentions that follow a page when it is renamed (6). A backup file does not include uploaded files; in the desktop app they are ordinary files in `attachments/`, so copying the notes folder copies everything.

### Phase 4 — Databases ✅ (core)
Done: databases as blocks whose rows are pages, eight property types, table / board / calendar / gallery / list views, filters and sorts per view, a formula language, row pages with their properties, CSV export and import.

Left over, moved to phase 6: timeline view, relations and rollups, linked views and full-page databases, grouping outside the board, row templates, sub-items, charts, forms, person and file properties.

### Desktop app ✅ (first version)
Done: the app packaged with Electron for Linux (AppImage) and Windows (zip); notes, attachments, settings and page history all in the notes folder; a backup copy and a set-aside rule for damaged files; a Markdown copy of every page kept in step; a menu to show or change the notes folder; links opening in the system browser; link previews for bookmarks.

Still to do:
1. Try the Windows build on a real Windows machine: so far only the Linux build has been run.
2. A Windows setup program with the app's own icon. `.github/workflows/release.yml` builds one on a Windows runner when a version tag is pushed; it has not run yet because the repository isn't online.
3. Read changes made to the `Markdown/` files back into Folio (today the copy is one-way).
4. Automatic updates, and code signing so Windows doesn't warn on first run (needs a certificate).

### Phase 5 — Open source and plugins ✅ (first version)
Done: MIT licence, contributor notes, a release workflow, plugins loaded from the notes folder with an on/off screen, a plugin API (commands, block kinds, settings, sidebar entries, change listeners, reading pages, adding, changing and removing blocks, notices), failures contained and shown per plugin, two sample plugins (word count, AI assistant) and a guide.

Still to do:
1. Put the repository online and tag a first release (this needs your account).
2. Plugin API additions: reading database rows and properties, inline elements.

### Phase 6 — Editor and databases ✅
Done since the first plan: inline equations, page lock and verification, HTML import, the history slider, full-page databases, row templates, sub-items, person and file properties, automations, AI help as a plugin, a fuller emoji list.

Small things left: dependencies between database rows, AI questions across all notes, recording and transcribing meetings.

### Look and settings ✅
Done: a Settings screen (General, Appearance, Editor, Plugins, About); translucent floating panels over a soft backdrop, with an accent colour and a "Reduce transparency" option; `[[ ]]` page links; a customisable graph.

Not done: resizing or reordering sidebar sections, custom fonts for the interface, per-page graph (the graph always shows the whole notes folder).

### Notion's business and enterprise features
Asked about on 2026-10-12. Folio is one person's app on one computer, with no accounts and no server, which decides most of these:

| Notion feature | In Folio |
| --- | --- |
| Verify any page | ✅ `⋯` → Verified |
| AI notes (meeting notes) | 🟡 the AI plugin writes meeting notes from typed notes or a transcript; no audio recording |
| Enterprise search (across connected apps) | 🟡 Ctrl+K searches every note; other apps would each need a plugin |
| Premium connections (Jira, GitHub, Slack…) | ⬜ each is a plugin to write; none exist yet |
| SAML single sign-on | ❌ there is no sign-in at all |
| Granular database permissions | ❌ there are no other users to give permissions to |
| Private teamspaces | ❌ same reason; a separate notes folder is the nearest thing |
| Domain verification | ❌ only meaningful for an organisation's accounts |
| Notion Agent | ❌ not wanted |

The four marked ❌ would need Folio to become a multi-user service with a server, which is the opposite of the local-only decision.

### Not planned
Accounts, cloud sync, sharing and real-time collaboration; mobile and macOS apps; enterprise administration; AI agents and meeting notes; separate calendar, mail and marketplace products. Syncing between your own computers is left to whatever tool you already trust with a folder.
