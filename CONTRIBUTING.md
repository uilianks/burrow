# Contributing to Burrow

Thanks for wanting to help. Burrow is MIT licensed; by contributing you agree your work is too.

## Getting set up

```bash
npm install
npm run dev       # the editor in a browser at http://localhost:3000 (notes go to the browser's own storage)
npm run desktop   # the real desktop app (notes go to Documents/Burrow)
npm test          # unit tests
npm run lint
```

Node 22 or newer. If `npm run desktop` says Electron failed to install, run `node node_modules/electron/install.js` once.

## Where things are

The README's "How it is put together" section maps the code. In short: `src/lib` is logic with no screen (and has the tests), `src/components` is the screen, `desktop/` is the Electron shell that reads and writes the notes folder.

## Before you open a pull request

- `npm test`, `npm run lint` and `npx tsc --noEmit` pass.
- New logic in `src/lib` comes with a test beside it.
- Every change to notes goes through `store.commit` (see `src/lib/commands.ts`), so it can be undone and is saved.
- Nothing may send notes anywhere. Burrow is local-only; network use is limited to things the person asks for (embeds, link previews).

## Plugins

Most additions don't need to be in the app itself. See `docs/plugins.md` and the sample in `examples/plugins/word-count`. If the plugin API is missing something you need, open an issue describing it.
