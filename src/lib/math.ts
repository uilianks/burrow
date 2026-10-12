import katex from "katex";

const decode = (text: string) => text.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** KaTeX's drawing of a piece of LaTeX, for use inside a line of text. Mistakes are drawn in red, not thrown. */
export const drawMath = (latex: string) => katex.renderToString(latex, { throwOnError: false });

/**
 * Stored inline HTML with each piece of inline math drawn. The drawn span is
 * one uneditable unit in the editor; saving turns it back into plain LaTeX.
 */
export const renderMath = (html: string) =>
  html.includes("data-math")
    ? html.replace(/<span data-math="([^"]*)">[^<]*<\/span>/g, (_, latex: string) => `<span data-math="${latex}" contenteditable="false">${drawMath(decode(latex))}</span>`)
    : html;
