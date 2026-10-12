/** Rows of text to CSV. Cells containing a comma, quote or line break are quoted. */
export const toCsv = (table: string[][]) =>
  table.map((row) => row.map((cell) => (/[",\n\r]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(",")).join("\n");

/** CSV to rows of text, honouring quoted cells that contain commas, quotes and line breaks. */
export function parseCsv(text: string): string[][] {
  const table: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const endCell = () => {
    row.push(cell);
    cell = "";
  };
  const endRow = () => {
    endCell();
    table.push(row);
    row = [];
  };
  const source = text.replace(/\r\n?/g, "\n");
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') cell += source[++i];
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell === "") quoted = true;
    else if (char === ",") endCell();
    else if (char === "\n") endRow();
    else cell += char;
  }
  if (cell !== "" || row.length) endRow();
  return table.filter((cells) => cells.some((value) => value !== ""));
}
