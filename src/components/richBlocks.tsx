"use client";

import "katex/dist/katex.min.css";
import katex from "katex";
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { htmlToText } from "@/lib/dom";
import { desktop } from "@/lib/desktop";
import { embedUrl, webUrl } from "@/lib/embed";
import { files, useFileUrl } from "@/lib/files";
import type { Block } from "@/lib/store";
import { pageTrail, visibleRows } from "@/lib/tree";
import { store, useRecords } from "@/lib/workspace";

const update = (id: string, patch: Partial<Block>, coalesce?: string) =>
  store.commit([{ op: "update", id, patch }], { coalesce });

const card = "rounded border border-border bg-muted p-3 text-sm";
const field = "min-w-0 flex-1 rounded border border-border bg-background px-2 py-1";
const action = "rounded border border-border bg-background px-2 py-1 hover:bg-border";

/** A one-line form asking for a web address; calls `onUrl` only with a valid http(s) one. */
function UrlForm({ label, onUrl }: { label: string; onUrl: (url: string) => void }) {
  const [invalid, setInvalid] = useState(false);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const url = webUrl(new FormData(event.currentTarget).get("url") as string);
    if (url) onUrl(url);
    else setInvalid(true);
  };
  return (
    <form className="flex min-w-0 flex-1 flex-wrap items-center gap-2" onSubmit={submit}>
      <input name="url" aria-label={label} placeholder={label} className={field} onChange={() => setInvalid(false)} />
      <button type="submit" className={action}>
        Add
      </button>
      {invalid && (
        <span role="alert" className="w-full text-red-600">
          That isn’t a web address. It should look like https://example.com
        </span>
      )}
    </form>
  );
}

const ACCEPT = { image: "image/*", video: "video/*", audio: "audio/*", file: undefined };
const formatSize = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;

export function MediaBlock({ block }: { block: Block }) {
  const type = block.type as keyof typeof ACCEPT;
  const stored = useFileUrl(block.fileId);
  const [failed, setFailed] = useState(false);
  const src = block.fileId ? stored : block.url;

  if (!block.fileId && !block.url) {
    const upload = (file: File | undefined) =>
      file &&
      files.put(file).then(
        (fileId) => update(block.id, { fileId, name: file.name, size: file.size }),
        () => setFailed(true),
      );
    return (
      <div className={`${card} flex flex-wrap items-center gap-2`}>
        <label className={`${action} cursor-pointer`}>
          Upload {type === "file" ? "a file" : type}
          <input type="file" accept={ACCEPT[type]} className="sr-only" onChange={(event) => upload(event.target.files?.[0])} />
        </label>
        {type !== "file" && <UrlForm label={`or paste a link to the ${type}`} onUrl={(url) => update(block.id, { url })} />}
        {failed && (
          <span role="alert" className="w-full text-red-600">
            The file couldn’t be saved in this browser. It may be too large for the space available.
          </span>
        )}
      </div>
    );
  }
  if (src === undefined) return <div className={`${card} text-subtle`}>Loading…</div>;
  if (src === null) {
    return <div className={`${card} text-subtle`}>“{block.name}” isn’t stored in this browser, so it can’t be shown here.</div>;
  }
  if (type === "image") {
    return (
      <figure className="group/image relative max-w-full" style={{ width: block.width ? `${block.width}%` : undefined }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- user files and arbitrary hosts, nothing for next/image to optimise */}
        <img src={src} alt={block.text || block.name || ""} className="w-full rounded" />
        <div className="absolute right-1 top-1 hidden gap-1 text-xs group-focus-within/image:flex group-hover/image:flex">
          {[25, 50, 75, 100].map((width) => (
            <button
              key={width}
              type="button"
              aria-label={`Image width ${width}%`}
              className="rounded bg-background px-1.5 py-0.5 shadow"
              onClick={() => update(block.id, { width: width === 100 ? undefined : width })}
            >
              {width}%
            </button>
          ))}
        </div>
        <input
          aria-label="Caption"
          placeholder="Add a caption"
          className={`w-full bg-transparent py-1 text-sm text-subtle outline-none ${block.text ? "" : "opacity-0 focus:opacity-100 group-hover/image:opacity-100"}`}
          value={block.text}
          onChange={(event) => update(block.id, { text: event.target.value }, block.id)}
        />
      </figure>
    );
  }
  if (type === "video") return <video controls src={src} className="max-w-full rounded" />;
  if (type === "audio") return <audio controls src={src} className="w-full" />;
  return (
    <a href={src} download={block.name} className={`${card} flex items-center gap-2 hover:bg-border`}>
      <span aria-hidden>📎</span>
      <span className="min-w-0 flex-1 truncate font-medium">{block.name}</span>
      {block.size !== undefined && <span className="text-subtle">{formatSize(block.size)}</span>}
    </a>
  );
}

export function BookmarkBlock({ block }: { block: Block }) {
  if (!block.url) {
    return (
      <div className={`${card} flex`}>
        <UrlForm
          label="Paste a link to bookmark"
          onUrl={(url) => {
            update(block.id, { url });
            // the desktop app can read the page's own title, description and picture; a browser can't
            desktop()
              ?.preview(url)
              .then((found) => found && update(block.id, { text: found.title, data: { description: found.description, image: found.image } }), () => {});
          }}
        />
      </div>
    );
  }
  const preview = block.data as { description?: string; image?: string } | undefined;
  return (
    <div className={`${card} flex items-center gap-3`}>
      <span aria-hidden>🔖</span>
      <div className="min-w-0 flex-1">
        <input
          aria-label="Bookmark title"
          className="w-full bg-transparent font-medium outline-none"
          placeholder="Add a title"
          value={block.text}
          onChange={(event) => update(block.id, { text: event.target.value }, block.id)}
        />
        {preview?.description && <div className="line-clamp-2 text-subtle">{preview.description}</div>}
        <div className="truncate text-subtle">{block.url}</div>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element -- a picture on someone else's site */}
      {preview?.image && <img src={preview.image} alt="" className="h-16 w-24 shrink-0 rounded object-cover" />}
      <a href={block.url} target="_blank" rel="noopener noreferrer" className={action}>
        Open ↗
      </a>
    </div>
  );
}

export function EmbedBlock({ block }: { block: Block }) {
  const src = block.url ? embedUrl(block.url) : null;
  if (!block.url) {
    return (
      <div className={`${card} flex`}>
        <UrlForm label="Paste a link to embed (YouTube, Vimeo, a map…)" onUrl={(url) => update(block.id, { url })} />
      </div>
    );
  }
  if (!src) return <div className={`${card} text-subtle`}>Only secure (https) pages can be embedded: {block.url}</div>;
  return (
    <iframe
      src={src}
      title={`Embedded page: ${block.url}`}
      className="aspect-video w-full rounded border border-border"
      sandbox="allow-scripts allow-same-origin allow-popups allow-presentation allow-forms"
      allow="fullscreen; picture-in-picture; encrypted-media"
      loading="lazy"
      // players such as YouTube refuse to start without knowing which site embeds them
      referrerPolicy="strict-origin-when-cross-origin"
    />
  );
}

export function EquationBlock({ block }: { block: Block }) {
  const [editing, setEditing] = useState(false);
  const open = editing || !block.text;
  return (
    <div>
      {block.text && (
        <button
          type="button"
          aria-label="Edit equation"
          className="block w-full overflow-x-auto rounded py-2 hover:bg-muted"
          onClick={() => setEditing(true)}
          // KaTeX escapes its input and, with trust off, emits no links or scripts
          dangerouslySetInnerHTML={{ __html: katex.renderToString(block.text, { displayMode: true, throwOnError: false }) }}
        />
      )}
      {open && (
        <textarea
          aria-label="Equation in LaTeX"
          autoFocus={editing}
          rows={2}
          placeholder="Write LaTeX, for example  E = mc^2"
          className={`${field} w-full font-mono text-sm`}
          value={block.text}
          onChange={(event) => update(block.id, { text: event.target.value }, block.id)}
          onBlur={() => setEditing(false)}
        />
      )}
    </div>
  );
}

function Cell({ value, header, onChange }: { value: string; header: boolean; onChange: (value: string) => void }) {
  const ref = useRef<HTMLTableCellElement>(null);
  useLayoutEffect(() => {
    if (ref.current!.textContent !== value) ref.current!.textContent = value;
  }, [value]);
  return (
    <td
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      className={`min-w-24 whitespace-pre-wrap border border-border px-2 py-1 align-top outline-none focus:bg-muted ${
        header ? "bg-muted font-semibold" : ""
      }`}
      onInput={(event) => onChange(event.currentTarget.textContent ?? "")}
      onKeyDown={(event) => event.key === "Enter" && event.preventDefault()}
      onPaste={(event) => {
        event.preventDefault();
        document.execCommand("insertText", false, event.clipboardData.getData("text/plain").replace(/\s*\n\s*/g, " "));
      }}
    />
  );
}

export function TableBlock({ block }: { block: Block }) {
  const table = block.table?.length ? block.table : [[""]];
  const save = (next: string[][], coalesce?: string) => update(block.id, { table: next }, coalesce);
  const remove = "h-5 w-5 rounded text-xs text-subtle opacity-0 hover:bg-muted focus:opacity-100 group-hover/table:opacity-100";
  return (
    <div className="group/table overflow-x-auto py-1">
      <table className="border-collapse text-sm">
        <tbody>
          <tr>
            {table[0].map((_, column) => (
              <td key={column} className="text-center">
                {table[0].length > 1 && (
                  <button
                    type="button"
                    aria-label={`Delete column ${column + 1}`}
                    className={remove}
                    onClick={() => save(table.map((row) => row.filter((_, index) => index !== column)))}
                  >
                    ×
                  </button>
                )}
              </td>
            ))}
          </tr>
          {table.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((value, column) => (
                <Cell
                  key={column}
                  value={value}
                  header={rowIndex === 0}
                  onChange={(text) =>
                    save(
                      table.map((cells, r) => (r === rowIndex ? cells.map((cell, c) => (c === column ? text : cell)) : cells)),
                      `${block.id}:${rowIndex}:${column}`,
                    )
                  }
                />
              ))}
              <td>
                {table.length > 1 && (
                  <button
                    type="button"
                    aria-label={`Delete row ${rowIndex + 1}`}
                    className={remove}
                    onClick={() => save(table.filter((_, index) => index !== rowIndex))}
                  >
                    ×
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-1 flex gap-2 text-xs text-subtle">
        <button type="button" className="rounded px-1 hover:bg-muted" onClick={() => save([...table, table[0].map(() => "")])}>
          + Row
        </button>
        <button type="button" className="rounded px-1 hover:bg-muted" onClick={() => save(table.map((row) => [...row, ""]))}>
          + Column
        </button>
      </div>
    </div>
  );
}

const TOC_INDENT = { h1: "", h2: "pl-4", h3: "pl-8" };

export function TocBlock({ block }: { block: Block }) {
  const records = useRecords();
  const page = pageTrail(records, block.id).at(-1);
  const headings = (page ? visibleRows(records, page) : [])
    .map((row) => records[row.id])
    .filter((candidate) => candidate.type in TOC_INDENT && htmlToText(candidate.text).trim());
  if (!headings.length) return <div className="py-1 text-sm text-subtle">Headings on this page will be listed here.</div>;
  return (
    <nav aria-label="Table of contents" className="py-1 text-sm">
      {headings.map((heading) => (
        <button
          key={heading.id}
          type="button"
          className={`block w-full truncate rounded px-1 py-0.5 text-left text-subtle underline-offset-2 hover:bg-muted hover:underline ${
            TOC_INDENT[heading.type as keyof typeof TOC_INDENT]
          }`}
          onClick={() => document.getElementById(`block-${heading.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}
        >
          {htmlToText(heading.text)}
        </button>
      ))}
    </nav>
  );
}

let diagrams = 0;

/** The drawing for a code block whose language is Mermaid. The library is only downloaded when one exists. */
export function MermaidPreview({ source }: { source: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!source.trim()) return;
    let current = true;
    // wait for a pause in typing: every keystroke is a different (often invalid) diagram
    const timer = setTimeout(async () => {
      const renderId = `folio-diagram-${++diagrams}`;
      try {
        const { default: mermaid } = await import("mermaid");
        const dark = getComputedStyle(document.documentElement).colorScheme.includes("dark");
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: dark ? "dark" : "default" });
        const { svg } = await mermaid.render(renderId, source);
        if (!current || !ref.current) return;
        ref.current.innerHTML = svg;
        setError(null);
      } catch (cause) {
        if (current) setError(cause instanceof Error ? cause.message.split("\n")[0] : "This diagram can’t be drawn.");
      } finally {
        // a failed render leaves its scratch element in the page
        document.getElementById(`d${renderId}`)?.remove();
      }
    }, 400);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [source]);

  if (!source.trim()) return null;
  return (
    <div className="mt-1 overflow-x-auto rounded border border-border p-2">
      <div ref={ref} className={error ? "opacity-40" : ""} />
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
