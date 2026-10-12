import { createPage, dailyPage, deleteBlock, importBlocks, insertParsed } from "./commands";
import { htmlToText } from "./dom";
import { pageHtml } from "./html";
import { fromHtml } from "./htmlImport";
import { fromMarkdown } from "./markdown";
import { backup, download, pageMarkdown, readBackup } from "./transfer";
import { openPage, store } from "./workspace";

/** Today (or a day `offset` days away) as YYYY-MM-DD in the person's own time zone. */
export function day(offset = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export const openToday = () => openPage(dailyPage(store, day()));

const fileName = (title: string) => title.replace(/[\\/:*?"<>|]+/g, " ").trim() || "Untitled";

export function exportPage(id: string) {
  const records = store.getSnapshot();
  download(`${fileName(htmlToText(records[id].text))}.md`, pageMarkdown(records, id), "text/markdown");
}

/** The page as one web page file, which any browser opens and can print to PDF. */
export function exportPageHtml(id: string) {
  const records = store.getSnapshot();
  download(`${fileName(htmlToText(records[id].text))}.html`, pageHtml(records, id), "text/html");
}

export const exportBackup = () => download(`folio-backup-${day()}.json`, backup(store.getSnapshot()), "application/json");

/** Brings in a Folio backup (.json), a web page (.html) or a Markdown file as a new page, and opens it. */
export async function importFile(file: File) {
  const text = await file.text();
  if (file.name.toLowerCase().endsWith(".json")) {
    const { blocks, top } = readBackup(text);
    return openPage(importBlocks(store, `Imported ${day()}`, blocks, top));
  }
  const web = /\.html?$/i.test(file.name) ? fromHtml(text) : null;
  const parsed = web ? web.blocks : fromMarkdown(text);
  const titled = !web && parsed[0]?.type === "h1";
  store.batch(() => {
    const id = createPage(store);
    const [placeholder] = store.getSnapshot()[id].content;
    store.commit([{ op: "update", id, patch: { text: web?.title || (titled ? parsed[0].text : file.name.replace(/\.\w+$/, "")) } }]);
    const body = titled ? parsed.slice(1) : parsed;
    insertParsed(store, id, placeholder, body);
    // the empty line a new page starts with is only wanted when the file had nothing in it
    if (body.length) deleteBlock(store, placeholder);
    openPage(id);
  });
}
