"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { dueCards, review, type Grade } from "@/lib/cards";
import { purgePages, restorePage } from "@/lib/commands";
import { htmlToText } from "@/lib/dom";
import { toMarkdown } from "@/lib/markdown";
import { desktop } from "@/lib/desktop";
import { files } from "@/lib/files";
import { buildGraph, GRAPH_DEFAULTS, layoutGraph, type GraphNode, type GraphOptions } from "@/lib/graph";
import { listVersions, type Version } from "@/lib/history";
import { setPref, usePrefs } from "@/lib/prefs";
import { setPluginSetting, usePlugins } from "@/lib/plugins";
import { restoreOps } from "@/lib/snapshot";
import type { Block } from "@/lib/store";
import { pageMarkdown } from "@/lib/transfer";
import { openPage, store, useRecords } from "@/lib/workspace";
import { pageTitle } from "./Sidebar";

const button = "rounded border border-border px-2 py-1 text-sm hover:bg-muted";

export function Modal({ title, wide, onClose, children }: { title: string; wide?: boolean; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label={title}
        className={`flex max-h-[85vh] w-full flex-col rounded-2xl glass ${wide ? "max-w-4xl" : "max-w-lg"}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-2">
          <h2 className="font-semibold">{title}</h2>
          <button type="button" aria-label="Close" className="h-7 w-7 rounded hover:bg-muted" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">{children}</div>
      </div>
    </div>
  );
}

const when = (time: number) => new Date(time).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export function TrashDialog({ onClose }: { onClose: () => void }) {
  const records = useRecords();
  const [failed, setFailed] = useState(false);
  const trashed = Object.values(records)
    .filter((block) => block.trashed)
    .sort((a, b) => b.trashed! - a.trashed!);
  const purge = (ids: string[], question: string) => {
    if (window.confirm(question)) purgePages(store, files, ids).catch(() => setFailed(true));
  };
  return (
    <Modal title="Trash" onClose={onClose}>
      {trashed.length === 0 ? (
        <p className="text-sm text-subtle">The trash is empty. Deleted pages wait here until you remove them for good.</p>
      ) : (
        <>
          <ul className="flex flex-col gap-1">
            {trashed.map((page) => (
              <li key={page.id} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate">
                  {page.icon} {pageTitle(records, page.id)} <span className="text-subtle">· deleted {when(page.trashed!)}</span>
                </span>
                <button type="button" className={button} onClick={() => restorePage(store, page.id)}>
                  Restore
                </button>
                <button
                  type="button"
                  className={button}
                  onClick={() => purge([page.id], `Delete “${pageTitle(records, page.id)}” for good? This can’t be undone.`)}
                >
                  Delete forever
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className={`${button} mt-4`}
            onClick={() => purge(trashed.map((page) => page.id), `Delete all ${trashed.length} pages in the trash for good? This can’t be undone.`)}
          >
            Empty trash
          </button>
        </>
      )}
      {failed && (
        <p role="alert" className="mt-2 text-sm text-red-600">
          The pages were deleted, but some of their files couldn’t be removed from this browser’s storage.
        </p>
      )}
    </Modal>
  );
}

export function HistoryDialog({ pageId, onClose }: { pageId: string; onClose: () => void }) {
  const records = useRecords();
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [chosen, setChosen] = useState<Version | null>(null);
  useEffect(() => {
    listVersions(pageId).then(
      (found) => {
        setVersions(found);
        // open on the newest version, so there is something to look at straight away
        setChosen(found[0] ?? null);
      },
      () => setVersions([]),
    );
  }, [pageId]);

  // read the saved blocks in place of the live ones, so the preview shows the page as it was
  const preview = chosen && pageMarkdown({ ...records, ...Object.fromEntries(chosen.blocks.map((block) => [block.id, block])) }, pageId);
  return (
    <Modal title={`History of “${pageTitle(records, pageId)}”`} wide onClose={onClose}>
      {versions === null ? (
        <p className="text-sm text-subtle">Loading…</p>
      ) : versions.length === 0 ? (
        <p className="text-sm text-subtle">
          No earlier versions yet. Burrow keeps one every couple of minutes while you edit a page, up to the last 30.
        </p>
      ) : (
        <div className="flex gap-4">
          <ul className="flex w-52 shrink-0 flex-col gap-1">
            <li className="pb-2">
              <label className="flex flex-col gap-1 text-xs text-subtle">
                Slide back through time
                <input
                  type="range"
                  aria-label="Slide back through time"
                  min={0}
                  max={versions.length - 1}
                  // newest on the right, as on a timeline
                  value={versions.length - 1 - Math.max(0, versions.findIndex((version) => version.key === chosen?.key))}
                  onChange={(event) => setChosen(versions[versions.length - 1 - Number(event.target.value)])}
                />
              </label>
            </li>
            {versions.map((version) => (
              <li key={version.key}>
                <button
                  type="button"
                  className={`w-full rounded px-2 py-1 text-left text-sm hover:bg-muted ${chosen?.key === version.key ? "bg-muted font-medium" : ""}`}
                  onClick={() => setChosen(version)}
                >
                  {when(version.at)}
                </button>
              </li>
            ))}
          </ul>
          <div className="min-w-0 flex-1">
            {chosen ? (
              <>
                <button
                  type="button"
                  className={`${button} mb-2`}
                  onClick={() => {
                    store.commit(restoreOps(store.getSnapshot(), pageId, chosen.blocks));
                    onClose();
                  }}
                >
                  Restore this version
                </button>
                <pre className="whitespace-pre-wrap rounded bg-muted p-3 text-sm">{preview}</pre>
              </>
            ) : (
              <p className="text-sm text-subtle">Pick a version to see the page as it was. Restoring can be undone with Ctrl+Z.</p>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function Card({ card, onGrade }: { card: Block; onGrade: (grade: Grade) => void }) {
  const records = useRecords();
  const [shown, setShown] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <div className="text-lg font-medium">{htmlToText(card.text)}</div>
      {shown ? (
        <>
          <pre className="whitespace-pre-wrap rounded bg-muted p-3 font-sans text-sm">{toMarkdown(records, card.content)}</pre>
          <div className="flex gap-2">
            <button type="button" className={button} onClick={() => onGrade("again")}>
              Again
            </button>
            <button type="button" className={button} onClick={() => onGrade("good")}>
              Good
            </button>
            <button type="button" className={button} onClick={() => onGrade("easy")}>
              Easy
            </button>
          </div>
        </>
      ) : (
        <button type="button" className={`${button} self-start`} onClick={() => setShown(true)}>
          Show answer
        </button>
      )}
    </div>
  );
}

/** Reviews the toggles that are due, one at a time: the toggle's line is the question, what is inside it the answer. */
export function FlashcardsDialog({ onClose }: { onClose: () => void }) {
  const records = useRecords();
  // "now" is fixed when the window opens, so a card answered "again" (due in ten minutes) leaves this session
  const [now] = useState(() => Date.now());
  const due = dueCards(records, now);
  const grade = (card: Block, answer: Grade) => store.commit([{ op: "update", id: card.id, patch: { card: review(card.card, answer, Date.now()) } }]);
  return (
    <Modal title="Flashcards" onClose={onClose}>
      {due.length === 0 ? (
        <p className="text-sm text-subtle">
          Nothing to review. Every toggle with something inside it is a card: the toggle’s line is the question and its contents are the answer.
        </p>
      ) : (
        <>
          <p className="mb-3 text-xs text-subtle">{due.length} to review</p>
          <Card key={due[0].id} card={due[0]} onGrade={(answer) => grade(due[0], answer)} />
        </>
      )}
    </Modal>
  );
}

/** The plugins found in the notes folder, each with its switch. Turning one on or off restarts the editor. */
export function PluginsPanel() {
  const { plugins, settings, values } = usePlugins();
  const bridge = desktop();
  const toggle = (id: string, enabled: boolean) => bridge?.setPluginEnabled(id, enabled).then(() => window.location.reload());
  return (
    <div>
      <p className="mb-3 text-sm text-subtle">
        Plugins add commands and block types. A plugin can read and change all your notes and can use the network, so only turn on
        plugins from people you trust.
      </p>
      {!bridge ? (
        <p className="text-sm">Plugins are loaded from the notes folder, so they are available in the desktop app.</p>
      ) : plugins.length === 0 ? (
        <p className="text-sm">No plugins yet. Put a plugin’s folder into the plugins folder, then reopen Burrow.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {plugins.map((plugin) => (
            <li key={plugin.id} className="text-sm">
              <label className="flex items-start justify-between gap-3">
                <span>
                  <span className="font-medium">{plugin.name}</span> <span className="text-subtle">{plugin.version}</span>
                  <span className="block text-subtle">{plugin.description}</span>
                </span>
                <input
                  type="checkbox"
                  aria-label={`Turn ${plugin.name} ${plugin.enabled ? "off" : "on"}`}
                  checked={plugin.enabled}
                  onChange={(event) => toggle(plugin.id, event.target.checked)}
                />
              </label>
              {settings
                .filter((setting) => setting.plugin === plugin.id)
                .map((setting) => (
                  <label key={setting.key} className="mt-1 flex items-center gap-2">
                    <span className="w-32 shrink-0 text-subtle">{setting.label}</span>
                    <input
                      type={setting.secret ? "password" : "text"}
                      aria-label={`${plugin.name}: ${setting.label}`}
                      placeholder={setting.placeholder}
                      className="min-w-0 flex-1 rounded border border-border bg-background px-1"
                      value={values[plugin.id]?.[setting.key] ?? ""}
                      onChange={(event) => setPluginSetting(plugin.id, setting.key, event.target.value)}
                    />
                  </label>
                ))}
              {plugin.error && (
                <p role="alert" className="mt-1 text-red-600">
                  {plugin.error}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      <button type="button" className={`${button} mt-4`} onClick={() => bridge?.showPluginsFolder()}>
        Open the plugins folder
      </button>
    </div>
  );
}

const SIZE = 640;
const GROUP_COLOURS = ["var(--c-blue)", "var(--c-purple)", "var(--c-green)", "var(--c-orange)", "var(--c-red)", "var(--c-gray)"];

/** Every page as a dot, with a line for each sub-page relation and each link. What is drawn and how is the person's to choose. */
export function GraphDialog({ current, onClose }: { current: string | undefined; onClose: () => void }) {
  const records = useRecords();
  const saved = usePrefs().graph;
  const options = useMemo(() => ({ ...GRAPH_DEFAULTS, ...saved }), [saved]);
  const change = (patch: Partial<GraphOptions>) => setPref("graph", { ...options, ...patch });
  const [find, setFind] = useState("");
  const [zoom, setZoom] = useState(1);
  const { nodes, links, at } = useMemo(() => {
    const graph = buildGraph(records, options);
    return { ...graph, at: layoutGraph(graph.nodes, graph.links, options.layout, SIZE) };
  }, [records, options]);

  const groups = [...new Set(nodes.map((node) => node.group))];
  const wanted = find.trim().toLowerCase();
  const matches = (node: GraphNode) => !wanted || node.title.toLowerCase().includes(wanted);
  const view = SIZE / zoom;
  const toggle = (key: keyof GraphOptions, label: string) => (
    <label className="flex items-center justify-between gap-2">
      {label}
      <input type="checkbox" checked={options[key] as boolean} onChange={(event) => change({ [key]: event.target.checked })} />
    </label>
  );
  return (
    <Modal title="Graph of pages" wide onClose={onClose}>
      <div className="flex flex-col gap-4 md:flex-row">
        <div className="flex w-full shrink-0 flex-col gap-2 text-sm md:w-56">
          <label className="flex items-center justify-between gap-2">
            Layout
            <select aria-label="Layout" className="rounded-md border border-border bg-background px-1" value={options.layout} onChange={(event) => change({ layout: event.target.value as GraphOptions["layout"] })}>
              <option value="force">Linked pages together</option>
              <option value="groups">A cluster per top page</option>
              <option value="ring">One ring</option>
            </select>
          </label>
          {toggle("children", "Sub-page lines")}
          {toggle("mentions", "Link lines")}
          {toggle("orphans", "Pages with no lines")}
          {toggle("rows", "Database rows")}
          {toggle("labels", "Page names")}
          {toggle("sizeByLinks", "Bigger dots for more lines")}
          {toggle("colorByGroup", "Colour by top page")}
          <label className="flex items-center justify-between gap-2">
            Zoom
            <input type="range" aria-label="Zoom" min={0.6} max={3} step={0.1} value={zoom} onChange={(event) => setZoom(Number(event.target.value))} />
          </label>
          <input
            aria-label="Find a page in the graph"
            placeholder="Find a page…"
            className="rounded-md border border-border bg-background px-2 py-1"
            value={find}
            onChange={(event) => setFind(event.target.value)}
          />
          <button type="button" className={button} onClick={() => setPref("graph", GRAPH_DEFAULTS)}>
            Reset to defaults
          </button>
          <p className="text-xs text-subtle">
            {nodes.length} pages, {links.filter((link) => link.kind === "mention").length} links, {links.filter((link) => link.kind === "child").length} sub-page lines.
          </p>
        </div>
        <svg
          viewBox={`${(SIZE - view) / 2} ${(SIZE - view) / 2} ${view} ${view}`}
          className="min-w-0 flex-1 rounded-xl bg-muted"
          role="img"
          aria-label="Pages and the links between them"
        >
          {links.map((link, index) => (
            <line
              key={index}
              data-link={link.kind}
              x1={at.get(link.from)!.x}
              y1={at.get(link.from)!.y}
              x2={at.get(link.to)!.x}
              y2={at.get(link.to)!.y}
              stroke={link.kind === "mention" ? "var(--accent)" : "var(--subtle)"}
              strokeOpacity={link.kind === "mention" ? 0.9 : 0.45}
              strokeWidth={link.kind === "mention" ? 1.5 : 1}
            />
          ))}
          {nodes.map((node) => {
            const { x, y } = at.get(node.id)!;
            const radius = (options.sizeByLinks ? 4 + Math.min(node.degree, 8) * 1.2 : 5) + (node.id === current ? 3 : 0);
            return (
              <g
                key={node.id}
                data-node={node.id}
                className="cursor-pointer"
                opacity={matches(node) ? 1 : 0.15}
                onClick={() => {
                  openPage(node.id);
                  onClose();
                }}
              >
                <circle
                  cx={x}
                  cy={y}
                  r={radius}
                  fill={options.colorByGroup ? GROUP_COLOURS[groups.indexOf(node.group) % GROUP_COLOURS.length] : "var(--foreground)"}
                  stroke={node.id === current ? "var(--accent)" : "var(--background)"}
                  strokeWidth={node.id === current ? 3 : 1}
                />
                {(options.labels || (wanted && matches(node))) && (
                  <text x={x} y={y - radius - 4} textAnchor="middle" fontSize={11 / Math.sqrt(zoom)} fill="var(--foreground)">
                    {node.title.slice(0, 24)}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </Modal>
  );
}
