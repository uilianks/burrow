const ALLOWED = new Set(["B", "STRONG", "I", "EM", "U", "S", "STRIKE", "CODE", "A", "BR", "SPAN"]);
/** Text and highlight colours a span may carry, as `data-color` / `data-bg`. */
export const COLORS = ["gray", "red", "orange", "green", "blue", "purple"];
const COLOR_ATTRIBUTES = ["data-color", "data-bg"];
const DROPPED = new Set(["SCRIPT", "STYLE"]);
// web and mail addresses, or "#<page id>" for a link to another page
const SAFE_HREF = /^(https?:|mailto:|#[0-9a-f-]{36}$)/i;

/** Reduces arbitrary HTML to the inline formatting blocks are allowed to store. */
export function sanitize(html: string): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  clean(template.content);
  const result = template.innerHTML;
  return result === "<br>" ? "" : result;
}

function clean(node: ParentNode) {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) continue;
    if (!(child instanceof Element) || DROPPED.has(child.tagName)) {
      child.remove();
      continue;
    }
    if (child.tagName === "SPAN" && child.hasAttribute("data-math")) {
      // Inline math: what is stored is just the LaTeX, whatever the editor has drawn inside the span.
      const latex = child.getAttribute("data-math") ?? "";
      for (const attribute of Array.from(child.attributes)) if (attribute.name !== "data-math") child.removeAttribute(attribute.name);
      child.textContent = latex;
      continue;
    }
    clean(child);
    if (!ALLOWED.has(child.tagName)) {
      child.replaceWith(...Array.from(child.childNodes));
      continue;
    }
    for (const attribute of Array.from(child.attributes)) {
      const keep =
        child.tagName === "A"
          ? // data-alias marks a page link that keeps its own words instead of showing the page's title
            (attribute.name === "href" && SAFE_HREF.test(attribute.value)) || (attribute.name === "data-alias" && attribute.value === "1")
          : child.tagName === "SPAN" && COLOR_ATTRIBUTES.includes(attribute.name) && COLORS.includes(attribute.value);
      if (!keep) child.removeAttribute(attribute.name);
    }
    // a span only exists to carry a colour
    if (child.tagName === "SPAN" && child.attributes.length === 0) child.replaceWith(...Array.from(child.childNodes));
  }
}

export function htmlToText(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

export const textLength = (el: HTMLElement) => el.textContent?.length ?? 0;

/**
 * Where the selection starts (or ends) as a character offset into the
 * element's text, or null if the selection is elsewhere.
 */
export function caretOffset(el: HTMLElement, edge: "start" | "end" = "start"): number | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!el.contains(range.startContainer)) return null;
  const before = document.createRange();
  before.selectNodeContents(el);
  if (edge === "start") before.setEnd(range.startContainer, range.startOffset);
  else before.setEnd(range.endContainer, range.endOffset);
  return before.toString().length;
}

/** Range covering text offsets [start, end) of the element; offsets past the end clamp to it. */
export function rangeFor(el: HTMLElement, start: number, end: number): Range {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let position = 0;
  let startSet = false;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = node.textContent?.length ?? 0;
    if (!startSet && start <= position + length) {
      range.setStart(node, start - position);
      startSet = true;
    }
    if (startSet && end <= position + length) {
      range.setEnd(node, end - position);
      return range;
    }
    position += length;
  }
  return range;
}

export function setCaret(el: HTMLElement, offset: number) {
  const range = rangeFor(el, offset, offset);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

export function caretRect(fallback: HTMLElement): DOMRect {
  const selection = window.getSelection();
  const rect = selection?.rangeCount ? selection.getRangeAt(0).getBoundingClientRect() : null;
  return rect && (rect.width || rect.height) ? rect : fallback.getBoundingClientRect();
}
