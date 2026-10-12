"use client";

import { useState, type ReactNode } from "react";
import { addRow, importRows, trashPage } from "@/lib/commands";
import { parseCsv, toCsv } from "@/lib/csv";
import {
  AGGREGATES,
  automationChanges,
  chartData,
  display,
  fileEntry,
  fileParts,
  FILTER_OPS,
  formulaError,
  groupByValue,
  groupRows,
  NAME,
  PROPERTY_TYPES,
  queryRows,
  TITLE,
  toTable,
  valueOf,
  VIEW_TYPES,
  type Filter,
  type Property,
  type PropValue,
  type Aggregate,
  type Automation,
  type Sort,
  type View,
} from "@/lib/database";
import { htmlToText } from "@/lib/dom";
import { webUrl } from "@/lib/embed";
import { files } from "@/lib/files";
import type { Block } from "@/lib/store";
import { download } from "@/lib/transfer";
import { openPage, store, useRecords } from "@/lib/workspace";

const input = "w-full min-w-0 rounded bg-transparent px-1 py-0.5 outline-none focus:bg-muted";
const control = "rounded border border-border bg-background px-1.5 py-0.5 text-sm";
const chip = "rounded bg-muted px-1.5 py-0.5 text-xs";
const quiet = "rounded px-1.5 py-0.5 text-sm text-subtle hover:bg-muted";
const NEW_OPTION = "\u0000new";
const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

const update = (id: string, patch: Partial<Block>, coalesce?: string) => store.commit([{ op: "update", id, patch }], { coalesce });
const title = (row: Block) => htmlToText(row.text);
const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const setTitle = (row: Block, text: string) => update(row.id, { text: escapeHtml(text) }, row.id);
/** Saves a value on a row, along with whatever the database's automations set in response. */
const setProp = (row: Block, property: string, value: PropValue) => {
  const database = store.getSnapshot()[row.parent ?? ""];
  const automatic = database ? automationChanges(database, property, value, iso(new Date())) : {};
  update(row.id, { props: { ...row.props, [property]: value, ...automatic } }, `${row.id}:${property}`);
};

/** Opens a file kept in a files property: the browser shows it or saves it, as it would any download. */
async function openStoredFile(entry: string) {
  const { id, name } = fileParts(entry);
  const blob = await files.get(id);
  if (!blob) return window.alert(`“${name}” isn’t stored on this computer.`);
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement("a"), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** Asks for a new choice and adds it to a select property. Returns the choice, or null if none was given. */
function addOption(database: Block, property: Property): string | null {
  const name = window.prompt(`New option for “${property.name}”`)?.trim();
  if (!name) return null;
  if (!property.options?.includes(name)) {
    update(database.id, {
      schema: database.schema!.map((p) => (p.id === property.id ? { ...p, options: [...(p.options ?? []), name] } : p)),
    });
  }
  return name;
}

/** The editor for one property of one row, by the property's type. */
export function PropertyField({
  database,
  row,
  property,
  onChange,
}: {
  database: Block;
  row: Block;
  property: Property;
  /** Where the new value goes; by default it is saved on the row. A form passes its own, to fill a row not yet added. */
  onChange?: (value: PropValue) => void;
}) {
  const records = useRecords();
  const schema = database.schema ?? [];
  const value = valueOf(row, property, schema, records);
  const label = `${property.name} of ${title(row) || "untitled row"}`;
  const set = onChange ?? ((next: PropValue) => setProp(row, property.id, next));

  switch (property.type) {
    case "formula":
    case "rollup":
      return <span className="px-1">{display(value)}</span>;
    case "relation": {
      const target = records[property.database ?? ""];
      if (target?.type !== "database") return <span className="px-1 text-xs text-subtle">Choose a database in this property’s settings</span>;
      const stored = row.props?.[property.id];
      const linked = (Array.isArray(stored) ? stored : []).filter((id) => records[id] && !records[id].trashed);
      const others = target.content.filter((id) => records[id] && !records[id].trashed && !linked.includes(id));
      return (
        <span className="flex flex-wrap items-center gap-1">
          {linked.map((id) => (
            <button key={id} type="button" title="Remove" className={chip} onClick={() => set(linked.filter((other) => other !== id))}>
              {title(records[id]) || "Untitled"} ×
            </button>
          ))}
          <select aria-label={label} className="w-6 bg-transparent text-subtle outline-none" value="" onChange={(event) => event.target.value && set([...linked, event.target.value])}>
            <option value="">+</option>
            {others.map((id) => (
              <option key={id} value={id}>
                {title(records[id]) || "Untitled"}
              </option>
            ))}
          </select>
        </span>
      );
    }
    case "checkbox":
      return <input type="checkbox" aria-label={label} checked={value === true} onChange={(event) => set(event.target.checked)} />;
    case "number":
      return (
        <input
          type="number"
          aria-label={label}
          className={input}
          value={typeof value === "number" ? value : ""}
          onChange={(event) => set(event.target.value === "" ? undefined : Number(event.target.value))}
        />
      );
    case "date":
      return <input type="date" aria-label={label} className={input} value={typeof value === "string" ? value : ""} onChange={(event) => set(event.target.value || undefined)} />;
    case "select":
      return (
        <select
          aria-label={label}
          className={input}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => set(event.target.value === NEW_OPTION ? (addOption(database, property) ?? value) : event.target.value || undefined)}
        >
          <option value="" />
          {property.options?.map((option) => <option key={option}>{option}</option>)}
          <option value={NEW_OPTION}>+ New option…</option>
        </select>
      );
    case "files": {
      const stored = row.props?.[property.id];
      const kept = Array.isArray(stored) ? stored : [];
      return (
        <span className="flex flex-wrap items-center gap-1">
          {kept.map((entry) => (
            <span key={entry} className={`${chip} flex items-center gap-1`}>
              <button type="button" data-nav className="underline" onClick={() => openStoredFile(entry)}>
                {fileParts(entry).name}
              </button>
              <button type="button" aria-label={`Remove ${fileParts(entry).name}`} onClick={() => set(kept.filter((other) => other !== entry))}>
                ×
              </button>
            </span>
          ))}
          <label className="cursor-pointer px-1 text-subtle" title="Attach a file">
            +
            <input
              type="file"
              aria-label={label}
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) files.put(file).then((id) => set([...kept, fileEntry(id, file.name)]), () => window.alert("The file couldn’t be saved."));
              }}
            />
          </label>
        </span>
      );
    }
    case "person":
    case "multiSelect": {
      const chosen = Array.isArray(value) ? value : [];
      return (
        <span className="flex flex-wrap items-center gap-1">
          {chosen.map((option) => (
            <button key={option} type="button" title="Remove" className={chip} onClick={() => set(chosen.filter((o) => o !== option))}>
              {option} ×
            </button>
          ))}
          <select
            aria-label={label}
            className="w-6 bg-transparent text-subtle outline-none"
            value=""
            onChange={(event) => {
              const option = event.target.value === NEW_OPTION ? addOption(database, property) : event.target.value;
              if (option && !chosen.includes(option)) set([...chosen, option]);
            }}
          >
            <option value="">+</option>
            {property.options?.filter((option) => !chosen.includes(option)).map((option) => <option key={option}>{option}</option>)}
            <option value={NEW_OPTION}>+ New option…</option>
          </select>
        </span>
      );
    }
    default: {
      const link = property.type === "url" && typeof value === "string" ? webUrl(value) : null;
      return (
        <span className="flex items-center">
          <input aria-label={label} className={input} value={typeof value === "string" ? value : ""} onChange={(event) => set(event.target.value || undefined)} />
          {link && (
            <a href={link} target="_blank" rel="noopener noreferrer" aria-label={`Open ${link}`} className="px-1 text-subtle hover:text-foreground">
              ↗
            </a>
          )}
        </span>
      );
    }
  }
}

/** The properties of a row, shown under the title when the row is open as a page. */
export function RowProperties({ row, database }: { row: Block; database: Block }) {
  return (
    <dl className="mb-4 grid grid-cols-[10rem_1fr] items-center gap-x-2 gap-y-1 border-b border-border pb-3 text-sm">
      {(database.schema ?? []).map((property) => (
        <div key={property.id} className="contents">
          <dt className="truncate text-subtle">{property.name}</dt>
          <dd className="min-w-0">
            <PropertyField database={database} row={row} property={property} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function PropertyMenu({ database, property, onClose }: { database: Block; property: Property; onClose: () => void }) {
  const schema = database.schema!;
  const change = (patch: Partial<Property>) => update(database.id, { schema: schema.map((p) => (p.id === property.id ? { ...p, ...patch } : p)) }, property.id);
  const records = useRecords();
  // try the formula on the first row, so the message is about real values
  const problem = property.type === "formula" && property.formula ? formulaError(property, schema, records[database.content[0]]) : null;
  const relations = schema.filter((candidate) => candidate.type === "relation");
  const followed = relations.find((relation) => relation.id === property.relation);
  const followedSchema = records[followed?.database ?? ""]?.schema ?? [];
  return (
    <>
      <div className="fixed inset-0 z-10" onClick={onClose} />
      <div className="absolute left-0 top-full z-20 flex w-64 flex-col gap-2 rounded-xl glass p-2 text-sm font-normal">
        <input aria-label="Property name" className={control} value={property.name} onChange={(event) => change({ name: event.target.value })} />
        <select aria-label="Property type" className={control} value={property.type} onChange={(event) => change({ type: event.target.value as Property["type"] })}>
          {PROPERTY_TYPES.map((type) => (
            <option key={type.type} value={type.type}>
              {type.label}
            </option>
          ))}
        </select>
        {(property.type === "select" || property.type === "multiSelect" || property.type === "person") && (
          <label className="flex flex-col gap-1 text-xs text-subtle">
            {property.type === "person" ? "People" : "Options"}, separated by commas
            <input
              aria-label={property.type === "person" ? "People" : "Options"}
              className={control}
              defaultValue={property.options?.join(", ")}
              onBlur={(event) => change({ options: [...new Set(event.target.value.split(",").map((o) => o.trim()).filter(Boolean))] })}
            />
          </label>
        )}
        {property.type === "relation" && (
          <label className="flex flex-col gap-1 text-xs text-subtle">
            Rows of which database
            <select aria-label="Related database" className={control} value={property.database ?? ""} onChange={(event) => change({ database: event.target.value || undefined })}>
              <option value="">Choose…</option>
              {Object.values(records)
                .filter((block) => block.type === "database")
                .map((block) => (
                  <option key={block.id} value={block.id}>
                    {block.text || "Untitled database"}
                  </option>
                ))}
            </select>
          </label>
        )}
        {property.type === "rollup" && (
          <div className="flex flex-col gap-1 text-xs text-subtle">
            Follow this relation
            <select aria-label="Relation to follow" className={control} value={property.relation ?? ""} onChange={(event) => change({ relation: event.target.value || undefined, target: undefined })}>
              <option value="">Choose…</option>
              {relations.map((relation) => (
                <option key={relation.id} value={relation.id}>
                  {relation.name}
                </option>
              ))}
            </select>
            and show
            <select aria-label="How to combine" className={control} value={property.aggregate ?? "count"} onChange={(event) => change({ aggregate: event.target.value as Aggregate })}>
              {AGGREGATES.map((aggregate) => (
                <option key={aggregate.id} value={aggregate.id}>
                  {aggregate.label}
                </option>
              ))}
            </select>
            {property.aggregate && property.aggregate !== "count" && (
              <>
                of
                <select aria-label="Property to read" className={control} value={property.target ?? TITLE} onChange={(event) => change({ target: event.target.value })}>
                  {[NAME, ...followedSchema].map((target) => (
                    <option key={target.id} value={target.id}>
                      {target.name}
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>
        )}
        {property.type === "formula" && (
          <label className="flex flex-col gap-1 text-xs text-subtle">
            Formula, for example prop(&quot;Qty&quot;) * 2
            <input aria-label="Formula" className={`${control} font-mono`} value={property.formula ?? ""} onChange={(event) => change({ formula: event.target.value })} />
            {problem && (
              <span role="alert" className="text-red-600">
                {problem}
              </span>
            )}
          </label>
        )}
        <button
          type="button"
          className="rounded px-1 py-0.5 text-left text-red-600 hover:bg-muted"
          onClick={() => {
            update(database.id, { schema: schema.filter((p) => p.id !== property.id) });
            onClose();
          }}
        >
          Delete property
        </button>
      </div>
    </>
  );
}

/** Editors for a view's filters or sorts: one line per rule. */
function Rules<T extends Filter | Sort>({
  schema,
  rules,
  blank,
  noun,
  onChange,
  extra,
}: {
  schema: Property[];
  rules: T[];
  blank: T;
  noun: string;
  onChange: (rules: T[]) => void;
  extra: (rule: T, change: (patch: Partial<T>) => void) => ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 rounded border border-border p-2 text-sm">
      {rules.map((rule, index) => {
        const change = (patch: Partial<T>) => onChange(rules.map((r, i) => (i === index ? { ...r, ...patch } : r)));
        return (
          <div key={index} className="flex flex-wrap items-center gap-1">
            <select aria-label={`${noun} ${index + 1} property`} className={control} value={rule.property} onChange={(event) => change({ property: event.target.value } as Partial<T>)}>
              {[NAME, ...schema].map((property) => (
                <option key={property.id} value={property.id}>
                  {property.name}
                </option>
              ))}
            </select>
            {extra(rule, change)}
            <button type="button" aria-label={`Remove ${noun} ${index + 1}`} className={quiet} onClick={() => onChange(rules.filter((_, i) => i !== index))}>
              ×
            </button>
          </div>
        );
      })}
      <button type="button" className={`${quiet} self-start`} onClick={() => onChange([...rules, blank])}>
        + Add {noun}
      </button>
    </div>
  );
}

const ROW_DRAG = "application/x-burrow-row";
/** Pasting this text into a block adds a linked view of the database. */
export const DATABASE_LINK = /^burrow-db:([0-9a-f-]{36})$/;

/** A view that is a blank row to fill in: submitting it adds the row. */
function FormView({ database }: { database: Block }) {
  const [name, setName] = useState("");
  const [props, setProps] = useState<NonNullable<Block["props"]>>({});
  const [added, setAdded] = useState<string | null>(null);
  const draft: Block = { id: "draft", type: "page", text: "", parent: database.id, content: [], props };
  const fields = (database.schema ?? []).filter((property) => property.type !== "formula" && property.type !== "rollup");
  return (
    <form
      className="flex max-w-md flex-col gap-2 text-sm"
      onSubmit={(event) => {
        event.preventDefault();
        addRow(store, database.id, props, escapeHtml(name));
        setAdded(name || "Untitled");
        setName("");
        setProps({});
      }}
    >
      <label className="flex flex-col gap-1">
        <span className="text-subtle">Name</span>
        <input aria-label="Name of the new row" className={control} value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      {fields.map((property) => (
        <div key={property.id} className="flex flex-col gap-1">
          <span className="text-subtle">{property.name}</span>
          <div className="rounded border border-border px-1 py-0.5">
            <PropertyField database={database} row={draft} property={property} onChange={(value) => setProps({ ...props, [property.id]: value })} />
          </div>
        </div>
      ))}
      <button type="submit" className={`${control} self-start hover:bg-muted`}>
        Add
      </button>
      {added && <p role="status">Added “{added}”.</p>}
    </form>
  );
}

const DAY = 24 * 60 * 60 * 1000;
const MAX_DAYS = 120;

/** Rows as bars along a line of days, from each row's start date to its end date. */
function Timeline({ rows, start, end, open }: { rows: Block[]; start: Property; end: Property | undefined; open: (row: Block) => ReactNode }) {
  const time = (value: PropValue) => (typeof value === "string" && !Number.isNaN(Date.parse(value)) ? Date.parse(`${value}T00:00:00`) : null);
  const spans = rows
    .map((row) => ({ row, from: time(row.props?.[start.id]), until: end ? time(row.props?.[end.id]) : null }))
    .filter((span): span is { row: Block; from: number; until: number | null } => span.from !== null)
    .map((span) => ({ ...span, until: Math.max(span.until ?? span.from, span.from) }));
  if (!spans.length) return <div className="rounded border border-border p-3 text-sm text-subtle">No rows have a {start.name} yet.</div>;

  const first = Math.min(...spans.map((span) => span.from)) - DAY;
  const count = Math.min(MAX_DAYS, Math.round((Math.max(...spans.map((span) => span.until)) - first) / DAY) + 2);
  const days = Array.from({ length: count }, (_, index) => new Date(first + index * DAY + DAY / 2));
  const column = (at: number) => Math.min(count, Math.max(0, Math.round((at - first) / DAY)));
  const grid = { display: "grid", gridTemplateColumns: `10rem repeat(${count}, 1.75rem)` };
  return (
    <div className="overflow-x-auto text-xs">
      <div style={grid} className="text-subtle">
        <span />
        {days.map((date, index) => (
          <span key={index} className="border-l border-border px-0.5">
            {index === 0 || date.getDate() === 1 ? date.toLocaleDateString(undefined, { month: "short" }) : ""}
            <br />
            {date.getDate()}
          </span>
        ))}
      </div>
      {spans.map((span) => (
        <div key={span.row.id} style={grid} className="items-center border-t border-border py-1">
          <span className="truncate pr-2 text-sm">{open(span.row)}</span>
          <span
            data-bar={span.row.id}
            title={`${iso(new Date(span.from))} to ${iso(new Date(span.until))}`}
            className="h-4 rounded bg-accent"
            style={{ gridColumn: `${column(span.from) + 2} / ${column(span.until) + 3}` }}
          />
        </div>
      ))}
      {count === MAX_DAYS && <p className="pt-1 text-subtle">Showing the first {MAX_DAYS} days.</p>}
    </div>
  );
}

/** The rules of a database: "when this property becomes this, set that property to that". */
function Automations({ database }: { database: Block }) {
  const schema = database.schema ?? [];
  const rules = database.automations ?? [];
  const save = (automations: Automation[]) => update(database.id, { automations });
  const change = (index: number, patch: Partial<Automation>) => save(rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));
  const pick = (label: string, value: string, onPick: (id: string) => void) => (
    <select aria-label={label} className={control} value={value} onChange={(event) => onPick(event.target.value)}>
      {schema.map((property) => (
        <option key={property.id} value={property.id}>
          {property.name}
        </option>
      ))}
    </select>
  );
  if (!schema.length) return <div className="rounded border border-border p-2 text-sm text-subtle">Add a property first.</div>;
  return (
    <div className="flex flex-col gap-1 rounded border border-border p-2 text-sm">
      {rules.map((rule, index) => (
        <div key={rule.id} className="flex flex-wrap items-center gap-1">
          When
          {pick(`Rule ${index + 1}: property to watch`, rule.when.property, (property) => change(index, { when: { ...rule.when, property } }))}
          becomes
          <input aria-label={`Rule ${index + 1}: value to watch for`} className={`${control} w-24`} value={rule.when.value} onChange={(event) => change(index, { when: { ...rule.when, value: event.target.value } })} />
          set
          {pick(`Rule ${index + 1}: property to set`, rule.set.property, (property) => change(index, { set: { ...rule.set, property } }))}
          to
          <input aria-label={`Rule ${index + 1}: value to set`} className={`${control} w-24`} value={rule.set.value} onChange={(event) => change(index, { set: { ...rule.set, value: event.target.value } })} />
          <button type="button" aria-label={`Remove rule ${index + 1}`} className={quiet} onClick={() => save(rules.filter((_, i) => i !== index))}>
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className={`${quiet} self-start`}
        onClick={() => save([...rules, { id: crypto.randomUUID(), when: { property: schema[0].id, value: "" }, set: { property: schema[0].id, value: "" } }])}
      >
        + Add automation
      </button>
      <span className="text-xs text-subtle">Write @today as the value to set a date property to the day the rule fires.</span>
    </div>
  );
}

/** Rows in table order with sub-items directly under the row they belong to. */
function nest(rows: Block[]): { row: Block; depth: number }[] {
  const shown = new Set(rows.map((row) => row.id));
  const ordered: { row: Block; depth: number }[] = [];
  const visit = (row: Block, depth: number) => {
    // depth is capped so that a row made its own ancestor by mistake can't loop forever
    if (depth > 8 || ordered.some((entry) => entry.row.id === row.id)) return;
    ordered.push({ row, depth });
    for (const child of rows) if (child.parentRow === row.id) visit(child, depth + 1);
  };
  for (const row of rows) if (!row.parentRow || !shown.has(row.parentRow)) visit(row, 0);
  return ordered;
}

export function DatabaseBlock({ block, full }: { block: Block; full?: boolean }) {
  const records = useRecords();
  // A linked view shows another database's rows and properties; only its views are its own.
  const linked = block.type === "linkedDatabase";
  const source = linked ? records[block.source ?? ""] : block;
  const schema = source?.schema ?? [];
  const views = block.views?.length ? block.views : [{ id: "default", name: "Table", type: "table" as const }];
  const [viewId, setViewId] = useState(views[0].id);
  const [panel, setPanel] = useState<string | null>(null);
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  if (source?.type !== "database") {
    return <div className="rounded border border-border bg-muted p-3 text-sm text-subtle">The database this view shows no longer exists.</div>;
  }
  const view = views.find((candidate) => candidate.id === viewId) ?? views[0];
  const rows = queryRows(
    source.content.map((id) => records[id]).filter((row) => row && !row.trashed),
    schema,
    view,
    records,
  );

  const changeView = (patch: Partial<View>) => update(block.id, { views: views.map((v) => (v.id === view.id ? { ...v, ...patch } : v)) });
  const toggle = (name: string) => setPanel((open) => (open === name ? null : name));
  const selects = schema.filter((property) => property.type === "select");
  const dates = schema.filter((property) => property.type === "date");
  const numbers = schema.filter((property) => property.type === "number" || property.type === "formula" || property.type === "rollup");
  const grouping = selects.find((property) => property.id === view.groupBy) ?? selects[0];
  const dating = dates.find((property) => property.id === view.dateBy) ?? dates[0];
  const ending = dates.find((property) => property.id === view.endBy && property.id !== dating?.id);
  // table and list group only when asked to; a chart always needs something to group by
  const anyGrouping = [NAME, ...schema].find((property) => property.id === view.groupBy) ?? (view.type === "chart" ? (selects[0] ?? NAME) : undefined);
  const measure = numbers.find((property) => property.id === view.measure);
  const groups = anyGrouping ? groupByValue(rows, anyGrouping, schema, records) : [{ key: "", rows }];
  const addProperty = (property: Omit<Property, "id">) => {
    const id = crypto.randomUUID();
    update(source.id, { schema: [...schema, { ...property, id }] });
    return id;
  };

  const open = (row: Block) => (
    <button type="button" data-nav className="min-w-0 truncate text-left font-medium hover:underline" onClick={() => openPage(row.id)}>
      {row.icon} {title(row) || "Untitled"}
    </button>
  );
  /** A row's non-empty values other than `skip`, as small labels. */
  const facts = (row: Block, skip?: string) =>
    schema
      .filter((property) => property.id !== skip)
      .map((property) => ({ property, text: display(valueOf(row, property, schema, records)) }))
      .filter((fact) => fact.text)
      .map((fact) => (
        <span key={fact.property.id} className={chip} title={fact.property.name}>
          {fact.text}
        </span>
      ));
  const missing = (what: string, label: string, property: Omit<Property, "id">) => (
    <div className="rounded border border-border p-3 text-sm text-subtle">
      This view needs {what}.{" "}
      <button type="button" className="underline" onClick={() => addProperty(property)}>
        {label}
      </button>
    </div>
  );
  const groupLabel = (key: string) => (anyGrouping ? key || `No ${anyGrouping.name}` : "");

  let body: ReactNode;
  if (view.type === "table") {
    body = (
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-subtle">
              <th className="min-w-48 border-b border-border px-1 py-1 font-normal">Name</th>
              {schema.map((property) => (
                <th key={property.id} className="relative min-w-32 border-b border-l border-border px-1 py-1 font-normal">
                  <button type="button" className="w-full truncate rounded text-left hover:bg-muted" onClick={() => toggle(property.id)}>
                    {property.name || "Unnamed"}
                  </button>
                  {panel === property.id && <PropertyMenu database={source} property={property} onClose={() => setPanel(null)} />}
                </th>
              ))}
              <th className="w-8 border-b border-border">
                <button type="button" aria-label="Add a property" className={quiet} onClick={() => setPanel(addProperty({ name: "Property", type: "text" }))}>
                  +
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {groups.flatMap((group) => [
              anyGrouping && (
                <tr key={`group:${group.key}`} data-group={group.key}>
                  <td colSpan={schema.length + 2} className="border-b border-border bg-muted px-1 py-0.5 text-xs font-medium">
                    {groupLabel(group.key)} <span className="text-subtle">{group.rows.length}</span>
                  </td>
                </tr>
              ),
              ...nest(group.rows).map(({ row, depth }) => (
                <tr key={row.id} className="group/row">
                  <td className="border-b border-border px-1">
                    <span className="flex items-center gap-1" style={{ paddingLeft: depth * 20 }}>
                      {depth > 0 && <span className="text-subtle">↳</span>}
                      <input aria-label="Row name" className={`${input} font-medium`} placeholder="Untitled" value={title(row)} onChange={(event) => setTitle(row, event.target.value)} />
                      <button
                        type="button"
                        aria-label={`Add a sub-item to ${title(row) || "untitled row"}`}
                        title="Add a sub-item"
                        className={`${quiet} opacity-0 focus:opacity-100 group-hover/row:opacity-100`}
                        onClick={() => addRow(store, source.id, {}, "", row.id)}
                      >
                        ↳+
                      </button>
                      <button type="button" data-nav className={`${quiet} opacity-0 focus:opacity-100 group-hover/row:opacity-100`} onClick={() => openPage(row.id)}>
                        Open
                      </button>
                    </span>
                  </td>
                  {schema.map((property) => (
                    <td key={property.id} className="border-b border-l border-border px-1">
                      <PropertyField database={source} row={row} property={property} />
                    </td>
                  ))}
                  <td className="border-b border-border">
                    <button
                      type="button"
                      aria-label={`Delete ${title(row) || "untitled row"}`}
                      className={`${quiet} opacity-0 focus:opacity-100 group-hover/row:opacity-100`}
                      onClick={() => trashPage(store, row.id)}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              )),
            ])}
          </tbody>
        </table>
      </div>
    );
  } else if (view.type === "board") {
    body = !grouping ? (
      missing("a Select property to make its columns from", "Add a Status property", { name: "Status", type: "select", options: ["To do", "Doing", "Done"] })
    ) : (
      <div className="flex gap-3 overflow-x-auto pb-1">
        {groupRows(rows, grouping).map((group) => (
          <div
            key={group.key}
            aria-label={group.key || `No ${grouping.name}`}
            className="flex w-60 shrink-0 flex-col gap-2 rounded bg-muted p-2"
            onDragOver={(event) => event.dataTransfer.types.includes(ROW_DRAG) && event.preventDefault()}
            onDrop={(event) => {
              const row = records[event.dataTransfer.getData(ROW_DRAG)];
              if (row) setProp(row, grouping.id, group.key || undefined);
            }}
          >
            <div className="text-sm font-medium">
              {group.key || `No ${grouping.name}`} <span className="text-subtle">{group.rows.length}</span>
            </div>
            {group.rows.map((row) => (
              <div
                key={row.id}
                draggable
                className="flex cursor-grab flex-col gap-1 rounded border border-border bg-background p-2 text-sm"
                onDragStart={(event) => event.dataTransfer.setData(ROW_DRAG, row.id)}
              >
                {open(row)}
                <div className="flex flex-wrap gap-1">{facts(row, grouping.id)}</div>
              </div>
            ))}
            <button type="button" className={`${quiet} self-start`} onClick={() => addRow(store, source.id, group.key ? { [grouping.id]: group.key } : {})}>
              + New
            </button>
          </div>
        ))}
      </div>
    );
  } else if (view.type === "calendar") {
    const start = new Date(month.getFullYear(), month.getMonth(), 1 - month.getDay());
    const days = Array.from({ length: 42 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index));
    body = !dating ? (
      missing("a Date property to place rows on days", "Add a Date property", { name: "Date", type: "date" })
    ) : (
      <div>
        <div className="mb-1 flex items-center gap-2 text-sm">
          <button type="button" aria-label="Previous month" className={quiet} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
            ‹
          </button>
          <span className="w-36 text-center font-medium">{month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</span>
          <button type="button" aria-label="Next month" className={quiet} onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>
            ›
          </button>
        </div>
        <div className="grid grid-cols-7 border-l border-t border-border text-xs">
          {days.map((date) => (
            <div key={iso(date)} data-day={iso(date)} className={`group/day min-h-20 border-b border-r border-border p-1 ${date.getMonth() === month.getMonth() ? "" : "bg-muted text-subtle"}`}>
              <div className="flex justify-between">
                <span className={iso(date) === iso(new Date()) ? "rounded bg-accent px-1 text-white" : ""}>{date.getDate()}</span>
                <button
                  type="button"
                  aria-label={`Add a row on ${iso(date)}`}
                  className="text-subtle opacity-0 focus:opacity-100 group-hover/day:opacity-100"
                  onClick={() => addRow(store, source.id, { [dating.id]: iso(date) })}
                >
                  +
                </button>
              </div>
              {rows
                .filter((row) => row.props?.[dating.id] === iso(date))
                .map((row) => (
                  <div key={row.id} className="mt-1 truncate rounded bg-background px-1 shadow-sm">
                    {open(row)}
                  </div>
                ))}
            </div>
          ))}
        </div>
      </div>
    );
  } else if (view.type === "timeline") {
    body = !dating ? (
      missing("a Date property for where each bar starts", "Add a Date property", { name: "Date", type: "date" })
    ) : (
      <Timeline rows={rows} start={dating} end={ending} open={open} />
    );
  } else if (view.type === "chart") {
    const data = chartData(rows, anyGrouping ?? NAME, measure, schema, records);
    const most = Math.max(1, ...data.map((bar) => bar.value));
    body = (
      <div className="flex flex-col gap-1 text-sm" role="img" aria-label={`${measure ? `Total ${measure.name}` : "Number of rows"} by ${anyGrouping?.name}`}>
        {data.map((bar) => (
          <div key={bar.key} data-bar={bar.key} className="flex items-center gap-2">
            <span className="w-32 shrink-0 truncate text-right text-subtle">{groupLabel(bar.key)}</span>
            <span className="h-5 rounded bg-accent" style={{ width: `${(bar.value / most) * 70}%`, minWidth: bar.value ? 2 : 0 }} />
            <span>{Number.isInteger(bar.value) ? bar.value : bar.value.toFixed(2)}</span>
          </div>
        ))}
        {data.length === 0 && <span className="text-subtle">No rows to chart.</span>}
      </div>
    );
  } else if (view.type === "form") {
    body = <FormView database={source} />;
  } else {
    const card = view.type === "gallery" ? "flex min-h-24 flex-col gap-2 rounded border border-border p-3 text-sm" : "flex items-center gap-2 border-b border-border py-1 text-sm";
    body = (
      <div className="flex flex-col gap-2">
        {groups.map((group) => (
          <div key={group.key} data-group={group.key}>
            {anyGrouping && (
              <div className="rounded bg-muted px-1 py-0.5 text-xs font-medium">
                {groupLabel(group.key)} <span className="text-subtle">{group.rows.length}</span>
              </div>
            )}
            <div className={view.type === "gallery" ? "grid grid-cols-2 gap-3 md:grid-cols-3" : "flex flex-col"}>
              {group.rows.map((row) => (
                <div key={row.id} className={card}>
                  {open(row)}
                  <div className={`flex flex-wrap gap-1 ${view.type === "list" ? "ml-auto" : ""}`}>{facts(row)}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  const choose = (label: string, value: string | undefined, options: Property[], onPick: (id: string | undefined) => void, none?: string) => (
    <select aria-label={label} className={control} value={value ?? ""} onChange={(event) => onPick(event.target.value || undefined)}>
      {none && <option value="">{none}</option>}
      {options.map((property) => (
        <option key={property.id} value={property.id}>
          {label}: {property.name}
        </option>
      ))}
    </select>
  );
  const groupable = view.type === "table" || view.type === "list" || view.type === "gallery" || view.type === "chart";

  return (
    <div className="my-2 rounded border border-border p-3" data-database>
      {linked ? (
        <div className="mb-2 text-lg font-semibold">
          <span className="text-subtle" title="A linked view of this database">
            ↗
          </span>{" "}
          {source.text || "Untitled database"}
        </div>
      ) : (
        <input
          aria-label="Database name"
          className="mb-2 w-full bg-transparent text-lg font-semibold outline-none"
          placeholder="Untitled database"
          value={block.text}
          onChange={(event) => update(block.id, { text: event.target.value }, block.id)}
        />
      )}
      <div className="mb-2 flex flex-wrap items-center gap-1 text-sm">
        {views.map((candidate) => (
          <button
            key={candidate.id}
            type="button"
            role="tab"
            data-nav
            aria-selected={candidate.id === view.id}
            className={`rounded px-2 py-0.5 ${candidate.id === view.id ? "bg-muted font-medium" : "text-subtle hover:bg-muted"}`}
            onClick={() => setViewId(candidate.id)}
          >
            {candidate.name}
          </button>
        ))}
        <select
          aria-label="Add a view"
          className="w-6 bg-transparent text-subtle outline-none"
          value=""
          onChange={(event) => {
            const type = VIEW_TYPES.find((candidate) => candidate.type === event.target.value)!;
            const id = crypto.randomUUID();
            update(block.id, { views: [...views, { id, name: type.label, type: type.type }] });
            setViewId(id);
          }}
        >
          <option value="">+</option>
          {VIEW_TYPES.map((type) => (
            <option key={type.type} value={type.type}>
              {type.label}
            </option>
          ))}
        </select>
        <span className="ml-auto flex flex-wrap items-center gap-1">
          {view.type === "board" && selects.length > 1 && choose("Group by", grouping?.id, selects, (groupBy) => changeView({ groupBy }))}
          {groupable && choose("Group by", anyGrouping?.id, [NAME, ...schema], (groupBy) => changeView({ groupBy }), view.type === "chart" ? undefined : "No grouping")}
          {view.type === "chart" && choose("Total of", measure?.id, numbers, (id) => changeView({ measure: id }), "Count rows")}
          {(view.type === "calendar" || view.type === "timeline") && dates.length > 1 && choose("Date", dating?.id, dates, (dateBy) => changeView({ dateBy }))}
          {view.type === "timeline" && dates.length > 1 && choose("Ends", ending?.id, dates.filter((property) => property.id !== dating?.id), (endBy) => changeView({ endBy }), "One day each")}
          {view.type !== "form" && (
            <>
              <button type="button" className={quiet} aria-expanded={panel === "filter"} onClick={() => toggle("filter")}>
                Filter{view.filters?.length ? ` (${view.filters.length})` : ""}
              </button>
              <button type="button" className={quiet} aria-expanded={panel === "sort"} onClick={() => toggle("sort")}>
                Sort{view.sorts?.length ? ` (${view.sorts.length})` : ""}
              </button>
            </>
          )}
          {!full && (
            <button type="button" data-nav className={quiet} title="Open this database on its own, filling the window" onClick={() => openPage(source.id)}>
              ⤢ Full page
            </button>
          )}
          <button type="button" className={quiet} aria-expanded={panel === "more"} onClick={() => toggle("more")}>
            ⋯
          </button>
        </span>
      </div>

      {panel === "filter" && (
        <Rules<Filter>
          schema={schema}
          rules={view.filters ?? []}
          blank={{ property: TITLE, op: "contains", value: "" }}
          noun="filter"
          onChange={(filters) => changeView({ filters })}
          extra={(rule, change) => (
            <>
              <select aria-label="Condition" className={control} value={rule.op} onChange={(event) => change({ op: event.target.value as Filter["op"] })}>
                {FILTER_OPS.map((option) => (
                  <option key={option.op} value={option.op}>
                    {option.label}
                  </option>
                ))}
              </select>
              {FILTER_OPS.find((option) => option.op === rule.op)?.needsValue && (
                <input aria-label="Value" className={`${control} w-32`} value={rule.value ?? ""} onChange={(event) => change({ value: event.target.value })} />
              )}
            </>
          )}
        />
      )}
      {panel === "sort" && (
        <Rules<Sort>
          schema={schema}
          rules={view.sorts ?? []}
          blank={{ property: TITLE }}
          noun="sort"
          onChange={(sorts) => changeView({ sorts })}
          extra={(rule, change) => (
            <select aria-label="Direction" className={control} value={rule.descending ? "down" : "up"} onChange={(event) => change({ descending: event.target.value === "down" })}>
              <option value="up">Ascending</option>
              <option value="down">Descending</option>
            </select>
          )}
        />
      )}
      {panel === "more" && (
        <div className="flex flex-wrap items-center gap-2 rounded border border-border p-2 text-sm">
          <label className="flex items-center gap-1">
            View name
            <input className={control} value={view.name} onChange={(event) => changeView({ name: event.target.value })} />
          </label>
          {views.length > 1 && (
            <button type="button" className={quiet} onClick={() => update(block.id, { views: views.filter((v) => v.id !== view.id) })}>
              Delete this view
            </button>
          )}
          <button type="button" className={quiet} onClick={() => download(`${source.text || "database"}.csv`, toCsv(toTable(rows, schema, records)), "text/csv")}>
            Export CSV
          </button>
          <label className={`${quiet} cursor-pointer`}>
            Import CSV
            <input
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={(event) => event.target.files?.[0]?.text().then((text) => importRows(store, source.id, parseCsv(text)))}
            />
          </label>
          <label className="flex items-center gap-1">
            New rows start as
            <select
              aria-label="Row template"
              className={control}
              value={source.rowTemplate ?? ""}
              onChange={(event) => update(source.id, { rowTemplate: event.target.value || undefined })}
            >
              <option value="">an empty row</option>
              {source.content
                .map((id) => records[id])
                .filter((row) => row && !row.trashed)
                .map((row) => (
                  <option key={row.id} value={row.id}>
                    a copy of {title(row) || "Untitled"}
                  </option>
                ))}
            </select>
          </label>
          <button type="button" className={quiet} onClick={() => setPanel("automations")}>
            Automations{source.automations?.length ? ` (${source.automations.length})` : ""}
          </button>
          <button
            type="button"
            className={quiet}
            title="Then paste on any page to show these rows there too, with separate views"
            onClick={() => {
              const link = `burrow-db:${source.id}`;
              navigator.clipboard.writeText(link).catch(() => window.prompt("Copy this, then paste it where the linked view should go", link));
            }}
          >
            Copy a linked view
          </button>
        </div>
      )}

      {panel === "automations" && <Automations database={source} />}

      <div className="mt-2">{body}</div>
      {(view.type === "table" || view.type === "list" || view.type === "gallery") && (
        <button type="button" className={`${quiet} mt-1`} onClick={() => addRow(store, source.id)}>
          + New row
        </button>
      )}
    </div>
  );
}
