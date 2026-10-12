export type FormulaValue = string | number | boolean;
export type FormulaResult = { value: FormulaValue } | { error: string };

const TOKEN = /\s*(?:(\d+(?:\.\d+)?)|"((?:[^"\\]|\\.)*)"|([A-Za-z_]\w*)|(==|!=|>=|<=|[-+*/(),<>]))/y;
type Token = { kind: "number" | "string" | "name" | "symbol"; text: string };

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < source.trimEnd().length) {
    const at = TOKEN.lastIndex;
    const match = TOKEN.exec(source);
    if (!match) throw new Error(`Unexpected "${source.slice(at).trim()[0]}"`);
    if (match[1] !== undefined) tokens.push({ kind: "number", text: match[1] });
    else if (match[2] !== undefined) tokens.push({ kind: "string", text: match[2].replace(/\\(.)/g, "$1") });
    else if (match[3] !== undefined) tokens.push({ kind: "name", text: match[3] });
    else tokens.push({ kind: "symbol", text: match[4] });
  }
  return tokens;
}

const number = (value: FormulaValue) => {
  const n = typeof value === "number" ? value : value === "" ? NaN : Number(value);
  if (Number.isNaN(n)) throw new Error(`"${value}" is not a number`);
  return n;
};
const text = (value: FormulaValue) => String(value);

const FUNCTIONS: Record<string, (args: FormulaValue[]) => FormulaValue> = {
  if: ([condition, yes, no]) => (condition ? yes : (no ?? "")),
  concat: (args) => args.map(text).join(""),
  length: ([value]) => text(value).length,
  upper: ([value]) => text(value).toUpperCase(),
  lower: ([value]) => text(value).toLowerCase(),
  round: ([value, digits]) => Number(number(value).toFixed(digits === undefined ? 0 : number(digits))),
  abs: ([value]) => Math.abs(number(value)),
  min: (args) => Math.min(...args.map(number)),
  max: (args) => Math.max(...args.map(number)),
  number: ([value]) => number(value),
  empty: ([value]) => value === "" || value === false,
  not: ([value]) => !value,
  and: (args) => args.every(Boolean),
  or: (args) => args.some(Boolean),
  today: () => new Date().toISOString().slice(0, 10),
};

/**
 * Evaluates a formula such as `if(prop("Qty") > 10, "bulk", "single")`.
 * `lookup` supplies the value of a property by name, or undefined if there is none.
 */
export function evaluate(source: string, lookup: (name: string) => FormulaValue | undefined): FormulaResult {
  try {
    const tokens = tokenize(source);
    let at = 0;
    const peek = (symbol: string) => tokens[at]?.kind === "symbol" && tokens[at].text === symbol;
    const take = (symbol: string) => peek(symbol) && (at++, true);
    const expect = (symbol: string) => {
      if (!take(symbol)) throw new Error(`Expected "${symbol}"`);
    };

    const primary = (): FormulaValue => {
      const token = tokens[at++];
      if (!token) throw new Error("The formula is incomplete");
      if (token.kind === "number") return Number(token.text);
      if (token.kind === "string") return token.text;
      if (token.kind === "symbol") {
        if (token.text === "(") {
          const inner = comparison();
          expect(")");
          return inner;
        }
        if (token.text === "-") return -number(primary());
        throw new Error(`Unexpected "${token.text}"`);
      }
      if (token.text === "true" || token.text === "false") return token.text === "true";
      expect("(");
      const args: FormulaValue[] = [];
      while (!take(")")) {
        if (args.length) expect(",");
        args.push(comparison());
      }
      if (token.text === "prop") {
        const found = lookup(text(args[0] ?? ""));
        if (found === undefined) throw new Error(`There is no property called "${args[0]}"`);
        return found;
      }
      const run = FUNCTIONS[token.text];
      if (!run) throw new Error(`There is no function called "${token.text}"`);
      return run(args);
    };
    const product = (): FormulaValue => {
      let left = primary();
      while (peek("*") || peek("/")) left = tokens[at++].text === "*" ? number(left) * number(primary()) : number(left) / number(primary());
      return left;
    };
    const sum = (): FormulaValue => {
      let left = product();
      while (peek("+") || peek("-")) {
        const plus = tokens[at++].text === "+";
        const right = product();
        // + joins text when either side is text, otherwise it adds
        left = plus ? (typeof left === "string" || typeof right === "string" ? text(left) + text(right) : number(left) + number(right)) : number(left) - number(right);
      }
      return left;
    };
    const comparison = (): FormulaValue => {
      const left = sum();
      const symbol = tokens[at]?.kind === "symbol" ? tokens[at].text : "";
      if (!["==", "!=", ">", "<", ">=", "<="].includes(symbol)) return left;
      at++;
      const right = sum();
      if (symbol === "==") return left === right;
      if (symbol === "!=") return left !== right;
      const [a, b] = typeof left === "number" || typeof right === "number" ? [number(left), number(right)] : [text(left), text(right)];
      return symbol === ">" ? a > b : symbol === "<" ? a < b : symbol === ">=" ? a >= b : a <= b;
    };

    const value = comparison();
    if (at < tokens.length) throw new Error(`Unexpected "${tokens[at].text}"`);
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error("The result is not a number");
    return { value };
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : "The formula can’t be read" };
  }
}
