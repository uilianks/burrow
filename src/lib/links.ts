import { htmlToText } from "./dom";
import { ROOT, type Records } from "./store";
import { isTrashed } from "./tree";

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * A link to a page, as stored in a block's text. A plain link always shows
 * the page's current title; one with `ownWords` keeps the words it was given
 * ("see the intro" pointing at "Getting started") however the page is renamed.
 */
export const pageLinkHtml = (pageId: string, text: string, ownWords: boolean) =>
  `<a href="#${pageId}"${ownWords ? ' data-alias="1"' : ""}>${escape(text)}</a>`;

/** What was typed between [[ and ]]: a page name, optionally followed by | and the words to show. */
export function parseWikiLink(typed: string): { name: string; words?: string } {
  const [name, ...rest] = typed.split("|");
  const words = rest.join("|").trim();
  return { name: name.trim(), words: words || undefined };
}

/** Pages a link could point at: everything that is a page and not in the trash. */
export const linkablePages = (records: Records) =>
  Object.values(records).filter((block) => block.type === "page" && block.id !== ROOT && !isTrashed(records, block.id));

/** The page with exactly this title, ignoring capitals; the first one if several share it. */
export const findPageByTitle = (records: Records, title: string) =>
  linkablePages(records).find((page) => htmlToText(page.text).trim().toLowerCase() === title.trim().toLowerCase())?.id;
