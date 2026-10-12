import { htmlToText } from "./dom";
import { evaluate, type FormulaResult, type FormulaValue } from "./formula";
import type { Block, Records } from "./store";

export type PropertyType = "text" | "number" | "select" | "multiSelect" | "person" | "files" | "date" | "checkbox" | "url" | "formula" | "relation" | "rollup";
export const PROPERTY_TYPES: { type: PropertyType; label: string }[] = [
  { type: "text", label: "Text" },
  { type: "number", label: "Number" },
  { type: "select", label: "Select" },
  { type: "multiSelect", label: "Multi-select" },
  { type: "person", label: "Person" },
  { type: "files", label: "Files" },
  { type: "date", label: "Date" },
  { type: "checkbox", label: "Checkbox" },
  { type: "url", label: "Link" },
  { type: "formula", label: "Formula" },
  { type: "relation", label: "Relation" },
  { type: "rollup", label: "Rollup" },
];

export type Aggregate = "count" | "list" | "sum" | "average" | "min" | "max";
export const AGGREGATES: { id: Aggregate; label: string }[] = [
  { id: "count", label: "Count" },
  { id: "list", label: "Show all" },
  { id: "sum", label: "Sum" },
  { id: "average", label: "Average" },
  { id: "min", label: "Smallest" },
  { id: "max", label: "Largest" },
];

/** A column of a database. The row's title is not one of these: it is the row page's own title. */
export interface Property {
  id: string;
  name: string;
  type: PropertyType;
  /** select, multiSelect and person: the choices (for person, the names), in display order. */
  options?: string[];
  /** formula: the expression (see formula.ts). */
  formula?: string;
  /** relation: the database whose rows this property links to. A row stores the linked rows' ids. */
  database?: string;
  /** rollup: the relation property (in this database) to follow… */
  relation?: string;
  /** …the property of the linked rows to read (TITLE for their names)… */
  target?: string;
  /** …and how to combine what is read. */
  aggregate?: Aggregate;
}

export type PropValue = string | number | boolean | string[] | undefined;

export type FilterOp = "contains" | "is" | "isNot" | "empty" | "notEmpty" | "gt" | "lt" | "checked" | "unchecked";
export const FILTER_OPS: { op: FilterOp; label: string; needsValue: boolean }[] = [
  { op: "contains", label: "contains", needsValue: true },
  { op: "is", label: "is", needsValue: true },
  { op: "isNot", label: "is not", needsValue: true },
  { op: "gt", label: "is more than / after", needsValue: true },
  { op: "lt", label: "is less than / before", needsValue: true },
  { op: "empty", label: "is empty", needsValue: false },
  { op: "notEmpty", label: "is not empty", needsValue: false },
  { op: "checked", label: "is checked", needsValue: false },
  { op: "unchecked", label: "is not checked", needsValue: false },
];

/** `property` is a property id, or TITLE for the row's name. */
export interface Filter {
  property: string;
  op: FilterOp;
  value?: string;
}
export interface Sort {
  property: string;
  descending?: boolean;
}
export type ViewType = "table" | "board" | "list" | "gallery" | "calendar" | "timeline" | "chart" | "form";
export const VIEW_TYPES: { type: ViewType; label: string }[] = [
  { type: "table", label: "Table" },
  { type: "board", label: "Board" },
  { type: "list", label: "List" },
  { type: "gallery", label: "Gallery" },
  { type: "calendar", label: "Calendar" },
  { type: "timeline", label: "Timeline" },
  { type: "chart", label: "Chart" },
  { type: "form", label: "Form" },
];

/** One saved way of looking at a database's rows. */
export interface View {
  id: string;
  name: string;
  type: ViewType;
  filters?: Filter[];
  sorts?: Sort[];
  /** board: the select property whose options are the columns. table, list and chart: any property to group rows by. */
  groupBy?: string;
  /** calendar and timeline: the date property that places rows on days. */
  dateBy?: string;
  /** timeline: the date property a row's bar runs to; without it a bar is one day long. */
  endBy?: string;
  /** chart: the number property to add up per group; without it the chart counts rows. */
  measure?: string;
}

/** "When this property becomes this value, set that property to that value." */
export interface Automation {
  id: string;
  when: { property: string; value: string };
  /** `value` may be "@today" for the day the rule fires. */
  set: { property: string; value: string };
}

/** A file kept in a files property: the stored file's id and its name, as one string. */
export const fileEntry = (id: string, name: string) => `${id}|${name}`;
export const fileParts = (entry: string) => ({ id: entry.slice(0, 36), name: entry.slice(37) || "file" });

export const TITLE = "title";
export const NAME: Property = { id: TITLE, name: "Name", type: "text" };

const EMPTY: Partial<Record<PropertyType, FormulaValue>> = { number: 0, checkbox: false };

/** The live rows a row links to through a relation property. */
export function relatedRows(row: Block, relation: Property, records: Records | undefined): Block[] {
  const ids = row.props?.[relation.id];
  if (!records || !Array.isArray(ids)) return [];
  return ids.map((id) => records[id]).filter((linked) => linked?.parent === relation.database && !linked.trashed);
}

function rollup(row: Block, property: Property, schema: Property[], records: Records | undefined): PropValue {
  const relation = schema.find((candidate) => candidate.id === property.relation && candidate.type === "relation");
  if (!relation) return undefined;
  const linked = relatedRows(row, relation, records);
  const aggregate = property.aggregate ?? "count";
  if (aggregate === "count") return linked.length;
  const targetSchema = records?.[relation.database ?? ""]?.schema ?? [];
  const target = property.target === TITLE || !property.target ? NAME : targetSchema.find((candidate) => candidate.id === property.target);
  if (!target) return undefined;
  const values = linked.map((other) => valueOf(other, target, targetSchema, records));
  if (aggregate === "list") return values.map(display).filter(Boolean);
  const numbers = values.filter((value): value is number => typeof value === "number");
  if (!numbers.length) return undefined;
  const sum = numbers.reduce((total, n) => total + n, 0);
  return aggregate === "sum" ? sum : aggregate === "average" ? sum / numbers.length : aggregate === "min" ? Math.min(...numbers) : Math.max(...numbers);
}

function compute(row: Block, property: Property, schema: Property[], depth: number, records?: Records): FormulaResult {
  if (depth > 4) return { error: "This formula refers back to itself" };
  return evaluate(property.formula ?? "", (name) => {
    const target = name === NAME.name ? NAME : schema.find((candidate) => candidate.name === name);
    if (!target) return undefined;
    if (target.type === "formula") {
      const inner = compute(row, target, schema, depth + 1, records);
      if ("error" in inner) throw new Error(inner.error);
      return inner.value;
    }
    const value = valueOf(row, target, schema, records);
    // an unfilled cell counts as zero, unchecked or empty text, so formulas work on half-filled rows
    return Array.isArray(value) ? value.join(", ") : (value ?? EMPTY[target.type] ?? "");
  });
}

/**
 * A row's value for a property, as it should be shown and compared. Formulas
 * and rollups are computed; a relation gives the linked rows' names (the ids
 * themselves are in `row.props`). `records` is needed to follow relations.
 */
export function valueOf(row: Block, property: Property, schema: Property[], records?: Records): PropValue {
  if (property.id === TITLE) return htmlToText(row.text);
  if (property.type === "relation") return relatedRows(row, property, records).map((linked) => htmlToText(linked.text) || "Untitled");
  if (property.type === "rollup") return rollup(row, property, schema, records);
  if (property.type === "files") {
    const stored = row.props?.[property.id];
    return Array.isArray(stored) ? stored.map((entry) => fileParts(entry).name) : undefined;
  }
  if (property.type !== "formula") return row.props?.[property.id];
  const result = compute(row, property, schema, 0, records);
  return "value" in result ? result.value : "#ERROR";
}

/** What is wrong with a formula when computed for `row` (or for an empty row), or null if it works. */
export function formulaError(property: Property, schema: Property[], row?: Block): string | null {
  const blank: Block = { id: "", type: "page", text: "", parent: null, content: [] };
  const result = compute(row ?? blank, property, schema, 0);
  return "error" in result ? result.error : null;
}

/** A value as text, for showing in read-only places, comparing and exporting. */
export const display = (value: PropValue): string =>
  Array.isArray(value) ? value.join(", ") : value === undefined || value === false ? "" : value === true ? "✓" : String(value);

const numeric = (value: PropValue | string) => (value === "" || value === undefined || Array.isArray(value) ? NaN : Number(value));
const compare = (a: PropValue | string, b: PropValue | string) =>
  Number.isNaN(numeric(a)) || Number.isNaN(numeric(b)) ? display(a).localeCompare(display(b)) : numeric(a) - numeric(b);

function matches(value: PropValue, filter: Filter): boolean {
  const shown = display(value).toLowerCase();
  const wanted = (filter.value ?? "").toLowerCase();
  switch (filter.op) {
    case "contains":
      return shown.includes(wanted);
    case "is":
      return Array.isArray(value) ? value.some((item) => item.toLowerCase() === wanted) : shown === wanted;
    case "isNot":
      return !matches(value, { ...filter, op: "is" });
    case "empty":
      return shown === "";
    case "notEmpty":
      return shown !== "";
    case "gt":
      return shown !== "" && compare(value, filter.value ?? "") > 0;
    case "lt":
      return shown !== "" && compare(value, filter.value ?? "") < 0;
    case "checked":
      return value === true;
    case "unchecked":
      return value !== true;
  }
}

const property = (schema: Property[], id: string) => (id === TITLE ? NAME : schema.find((candidate) => candidate.id === id));

/** The rows a view shows: every filter must match, then sorted by each sort in turn, with empty values last. */
export function queryRows(rows: Block[], schema: Property[], view: Pick<View, "filters" | "sorts">, records?: Records): Block[] {
  const value = (row: Block, id: string) => {
    const found = property(schema, id);
    return found ? valueOf(row, found, schema, records) : undefined;
  };
  const kept = rows.filter((row) =>
    // a filter still waiting for its value, or on a deleted property, filters nothing
    (view.filters ?? []).every(
      (filter) => !property(schema, filter.property) || (FILTER_OPS.find((o) => o.op === filter.op)?.needsValue && !filter.value) || matches(value(row, filter.property), filter),
    ),
  );
  const sorts = (view.sorts ?? []).filter((sort) => property(schema, sort.property));
  if (!sorts.length) return kept;
  return [...kept].sort((a, b) => {
    for (const sort of sorts) {
      const [left, right] = [value(a, sort.property), value(b, sort.property)];
      const [emptyLeft, emptyRight] = [display(left) === "", display(right) === ""];
      if (emptyLeft !== emptyRight) return emptyLeft ? 1 : -1;
      const order = compare(left, right);
      if (order) return sort.descending ? -order : order;
    }
    return 0;
  });
}

/** Rows split by a select property: one group with no value, then one per option, in option order. */
export function groupRows(rows: Block[], grouping: Property): { key: string; rows: Block[] }[] {
  const keys = ["", ...(grouping.options ?? [])];
  return keys.map((key) => ({
    key,
    rows: rows.filter((row) => {
      const value = row.props?.[grouping.id];
      return (typeof value === "string" && keys.includes(value) ? value : "") === key;
    }),
  }));
}

/**
 * Rows split by any property's shown value: the rows with no value first,
 * then a select's options in their own order, or other values sorted.
 */
export function groupByValue(rows: Block[], grouping: Property, schema: Property[], records?: Records): { key: string; rows: Block[] }[] {
  const groups = new Map<string, Block[]>([["", []], ...(grouping.type === "select" ? (grouping.options ?? []).map((option): [string, Block[]] => [option, []]) : [])]);
  for (const row of rows) {
    const key = display(valueOf(row, grouping, schema, records));
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const entries = [...groups].map(([key, members]) => ({ key, rows: members }));
  if (grouping.type !== "select") entries.sort((a, b) => (a.key === "" ? -1 : b.key === "" ? 1 : compare(a.key, b.key)));
  return entries.filter((group) => group.key !== "" || group.rows.length);
}

/** One bar per group: how many rows it has, or the total of `measure` over them. */
export function chartData(rows: Block[], grouping: Property, measure: Property | undefined, schema: Property[], records?: Records) {
  return groupByValue(rows, grouping, schema, records).map((group) => ({
    key: group.key,
    value: measure ? group.rows.reduce((total, row) => total + (Number(valueOf(row, measure, schema, records)) || 0), 0) : group.rows.length,
  }));
}

/**
 * What a database's automations set when `changed` has just become `value`.
 * Rules pointing at properties that no longer exist do nothing.
 */
export function automationChanges(database: Block, changed: string, value: PropValue, today: string): Record<string, PropValue> {
  const changes: Record<string, PropValue> = {};
  for (const rule of database.automations ?? []) {
    const target = database.schema?.find((property) => property.id === rule.set.property);
    if (rule.when.property !== changed || !target || display(value).toLowerCase() !== rule.when.value.trim().toLowerCase()) continue;
    const wanted = rule.set.value.trim() === "@today" ? today : rule.set.value.trim();
    changes[target.id] =
      target.type === "number" ? Number(wanted) || 0 : target.type === "checkbox" ? /^(true|yes|✓|1|checked)$/i.test(wanted) : target.type === "multiSelect" || target.type === "person" ? [wanted] : wanted;
  }
  return changes;
}

/** A database as a grid of text: a header row, then one row per given row. */
export function toTable(rows: Block[], schema: Property[], records?: Records): string[][] {
  const columns = [NAME, ...schema];
  return [columns.map((column) => column.name), ...rows.map((row) => columns.map((column) => display(valueOf(row, column, schema, records))))];
}
