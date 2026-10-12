# Writing a Burrow plugin

A plugin is a folder inside your notes folder:

```
<notes folder>/plugins/my-plugin/
  manifest.json
  main.js
```

The folder name is the plugin's id: lowercase letters, digits and dashes. `examples/plugins/word-count` in this repository is a complete plugin to copy.

Plugins are off until you turn them on under **⋯ → Plugins**. Turning one on or off restarts the editor. Which plugins are on is remembered in `plugins/enabled.json`, so it travels with the notes folder.

## manifest.json

```json
{
  "name": "My plugin",
  "version": "1.0.0",
  "description": "One line about what it does.",
  "main": "main.js"
}
```

`main` is optional and defaults to `main.js`. It must be a file in the plugin's own folder, at most 2 MB.

## main.js

The script runs once when Burrow starts, with one variable, `burrow`. It is a plain script, not a module: no `import`, no `require`.

| Call | What it does |
| --- | --- |
| `burrow.addCommand({ name, run })` | Adds a command to Ctrl+K. |
| `burrow.addBlock({ id, label, hint, render })` | Adds a block kind to the slash menu. See below. |
| `burrow.addSetting({ key, label, secret, placeholder })` | Asks the person for a value on the Plugins screen. `secret: true` hides what is typed. |
| `burrow.settings.get(key)` / `burrow.settings.set(key, value)` | Reads and stores the plugin's own values (text). They are kept in the notes folder, in `.burrow/plugin-<id>.json`. |
| `burrow.addSidebarItem({ label, run })` | Adds an entry at the bottom of the sidebar. |
| `burrow.onChange(listener)` | Calls `listener()` after every change to the notes. |
| `burrow.pages()` | Every page not in the trash, as `{ id, title, parent }`. |
| `burrow.currentPage()` | The id of the open page, or `null`. |
| `burrow.markdown(pageId)` | A page as Markdown text. |
| `burrow.append(pageId, markdown)` | Adds blocks, written as Markdown, to the end of a page. |
| `burrow.blocks(pageId)` | The blocks shown on a page, in order, as `{ id, type, text, checked, depth }`. |
| `burrow.updateBlock(id, { text, checked })` | Changes a block's text (written as inline Markdown) and/or its checkbox. |
| `burrow.removeBlock(id)` | Deletes a block; a page goes to the trash instead. |
| `burrow.open(pageId)` | Opens a page. |
| `burrow.notify(message)` | Shows a short notice in the corner. |
| `burrow.apiVersion` | `1`. Check it if you rely on something added later. |

### Blocks

```js
burrow.addBlock({
  id: "tally",                    // unique within your plugin
  label: "Tally counter",         // what the slash menu shows
  hint: "Click to count things",  // optional second line
  render(el, { data, update }) {
    // `el` is an empty element to fill. `data` is what this block last
    // saved (undefined for a new block). `update(newData)` saves new data;
    // Burrow then calls render again with it.
    // Return a function if you need to clean up (timers, listeners).
  },
});
```

`data` can be anything that survives JSON. It is stored in the notes file on the block itself, so it is undone, backed up and restored with everything else. If the plugin is later turned off, its blocks show a placeholder and keep their data.

A command's `run` may be `async`; if it fails later, the failure is still reported against the plugin. Settings are stored as plain text in the notes folder, so an API key kept there is only as private as the folder is.

`examples/plugins/ai-assistant` shows settings, a sidebar entry and network calls together.

## What a plugin can and cannot do

- It runs inside the editor's page, so it **can** read and change everything on screen and all of your notes, and it **can** use the network. Only turn on plugins you trust.
- It **cannot** reach the disk, run programs, or use Node or Electron: the page has no access to them.
- If the script throws while starting, the plugin adds nothing and its error is shown under ⋯ → Plugins. If a command, block or listener throws later, the error is shown there too and the editor carries on.

## What isn't in the API yet

Reading database rows and properties, custom settings screens beyond simple fields, and inline (within-text) elements. Say what you need in an issue.
