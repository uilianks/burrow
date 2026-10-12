import { useSyncExternalStore } from "react";
import { insertParsed, removeBlocks } from "./commands";
import { desktop } from "./desktop";
import { htmlToText } from "./dom";
import { fromMarkdown, inlineToHtml } from "./markdown";
import { ROOT } from "./store";
import { pageMarkdown } from "./transfer";
import { isTrashed, visibleRows } from "./tree";
import { openPage, store } from "./workspace";

/** A plugin as found in the notes folder's plugins/ directory. */
export interface FoundPlugin {
  id: string;
  name: string;
  version: string;
  description: string;
  enabled: boolean;
  /** The text of the plugin's script; only run when the plugin is enabled. */
  source: string;
}
export interface PluginInfo extends Omit<FoundPlugin, "source"> {
  /** Why the plugin isn't working, in its own words. */
  error?: string;
}
export interface PluginCommand {
  plugin: string;
  name: string;
  run: () => void;
}
/** What a block's render function is given besides the element to fill. */
export interface BlockContext {
  /** Whatever the block last saved with `update`, or undefined for a new block. */
  data: unknown;
  /** Saves new data for this block; the block is rendered again with it. */
  update: (data: unknown) => void;
}
export interface PluginBlock {
  /** "<plugin id>/<block id>", stored on blocks of this kind. */
  key: string;
  plugin: string;
  label: string;
  hint: string;
  render: (el: HTMLElement, context: BlockContext) => void | (() => void);
}

/** A setting a plugin asks the person for; shown, with its value, on the Plugins screen. */
export interface PluginSetting {
  plugin: string;
  key: string;
  label: string;
  /** Hide what is typed (keys, passwords). */
  secret: boolean;
  placeholder: string;
}
export interface PluginSidebarItem {
  plugin: string;
  label: string;
  run: () => void;
}

interface State {
  plugins: PluginInfo[];
  commands: PluginCommand[];
  blocks: PluginBlock[];
  settings: PluginSetting[];
  sidebar: PluginSidebarItem[];
  /** What each plugin has stored, by plugin id then key. */
  values: Record<string, Record<string, string>>;
  /** A short notice from a plugin (or about one), shown briefly. */
  message: string | null;
}

let state: State = { plugins: [], commands: [], blocks: [], settings: [], sidebar: [], values: {}, message: null };
const listeners = new Set<() => void>();
const change = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const getState = () => state;

export const usePlugins = () => useSyncExternalStore(subscribe, getState, getState);
export const pluginState = getState;
export const notify = (message: string | null) => change({ message });

// The page on screen. The address alone doesn't say: a freshly started app shows its first page with no id in the address.
let shownPage: string | null = null;
export const setShownPage = (id: string | null) => {
  shownPage = id;
};

const reason = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

/** Stores one of a plugin's settings: in the notes folder on the desktop, for the visit otherwise. */
export function setPluginSetting(plugin: string, key: string, value: string) {
  const values = { ...state.values, [plugin]: { ...state.values[plugin], [key]: value } };
  change({ values });
  desktop()?.writeData(`plugin-${plugin}`, values[plugin]).catch(() => {});
}

/**
 * Runs a plugin's code so that a mistake in it, now or later if it returns a
 * promise, is reported against the plugin instead of breaking the editor.
 */
export function guarded<T>(plugin: string, doing: string, run: () => T): T | undefined {
  const report = (cause: unknown) => {
    const name = state.plugins.find((info) => info.id === plugin)?.name ?? plugin;
    change({
      plugins: state.plugins.map((info) => (info.id === plugin ? { ...info, error: `While ${doing}: ${reason(cause)}` } : info)),
      message: `The plugin “${name}” ran into a problem while ${doing}: ${reason(cause)}`,
    });
  };
  try {
    const result = run();
    if (result instanceof Promise) result.catch(report);
    return result;
  } catch (cause) {
    report(cause);
    return undefined;
  }
}

const text = (value: unknown, what: string) => {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${what} must be a non-empty string`);
  return value;
};
const callable = <T>(value: T, what: string) => {
  if (typeof value !== "function") throw new Error(`${what} must be a function`);
  return value;
};

/** The object a plugin's script receives as `burrow`. See docs/plugins.md. */
interface Pending {
  commands: PluginCommand[];
  blocks: PluginBlock[];
  settings: PluginSetting[];
  sidebar: PluginSidebarItem[];
  watchers: (() => void)[];
}

function createApi(plugin: FoundPlugin, pending: Pending) {
  const page = (id: string) => {
    const found = store.getSnapshot()[id];
    if (found?.type !== "page" || id === ROOT) throw new Error(`There is no page with the id "${id}"`);
    return found;
  };
  return {
    apiVersion: 1,
    addCommand(command: { name: string; run: () => void }) {
      const name = text(command?.name, "A command's name");
      const run = callable(command.run, "A command's run");
      pending.commands.push({ plugin: plugin.id, name, run: () => guarded(plugin.id, `running “${name}”`, run) });
    },
    addBlock(block: { id: string; label: string; hint?: string; render: PluginBlock["render"] }) {
      pending.blocks.push({
        key: `${plugin.id}/${text(block?.id, "A block's id")}`,
        plugin: plugin.id,
        label: text(block.label, "A block's label"),
        hint: typeof block.hint === "string" ? block.hint : `From the plugin ${plugin.name}`,
        render: callable(block.render, "A block's render"),
      });
    },
    addSetting(setting: { key: string; label: string; secret?: boolean; placeholder?: string }) {
      pending.settings.push({
        plugin: plugin.id,
        key: text(setting?.key, "A setting's key"),
        label: text(setting.label, "A setting's label"),
        secret: !!setting.secret,
        placeholder: typeof setting.placeholder === "string" ? setting.placeholder : "",
      });
    },
    settings: {
      get: (key: string) => state.values[plugin.id]?.[key] ?? "",
      set: (key: string, value: string) => setPluginSetting(plugin.id, text(key, "A setting's key"), String(value)),
    },
    addSidebarItem(item: { label: string; run: () => void }) {
      const label = text(item?.label, "A sidebar item's label");
      const run = callable(item.run, "A sidebar item's run");
      pending.sidebar.push({ plugin: plugin.id, label, run: () => guarded(plugin.id, `opening “${label}”`, run) });
    },
    onChange(listener: () => void) {
      pending.watchers.push(callable(listener, "The onChange listener"));
    },
    pages: () =>
      Object.values(store.getSnapshot())
        .filter((block) => block.type === "page" && block.id !== ROOT && !isTrashed(store.getSnapshot(), block.id))
        .map((block) => ({ id: block.id, title: htmlToText(block.text), parent: block.parent })),
    currentPage: () => shownPage,
    markdown: (pageId: string) => pageMarkdown(store.getSnapshot(), page(pageId).id),
    append(pageId: string, markdown: string) {
      const target = page(pageId);
      insertParsed(store, target.id, target.content.at(-1) ?? null, fromMarkdown(text(markdown, "The text to append")));
    },
    blocks: (pageId: string) =>
      visibleRows(store.getSnapshot(), page(pageId).id).map((row) => {
        const found = store.getSnapshot()[row.id];
        return { id: found.id, type: found.type, text: htmlToText(found.text), checked: !!found.checked, depth: row.depth };
      }),
    updateBlock(id: string, changes: { text?: string; checked?: boolean }) {
      const found = store.getSnapshot()[id];
      if (!found || found.type === "page" || found.type === "shared") throw new Error(`There is no block with the id "${id}"`);
      store.commit([
        {
          op: "update",
          id,
          patch: {
            ...(typeof changes?.text === "string" ? { text: inlineToHtml(changes.text) } : {}),
            ...(typeof changes?.checked === "boolean" ? { checked: changes.checked } : {}),
          },
        },
      ]);
    },
    removeBlock(id: string) {
      const found = store.getSnapshot()[id];
      if (!found || found.type === "shared" || id === ROOT) throw new Error(`There is no block with the id "${id}"`);
      removeBlocks(store, [id]);
    },
    open: (pageId: string) => openPage(page(pageId).id),
    notify: (message: string) => notify(`${plugin.name}: ${String(message)}`),
  };
}

/**
 * Lists the found plugins and runs the enabled ones. A plugin whose script
 * throws while loading contributes nothing and is shown with its error.
 */
export function loadPlugins(found: FoundPlugin[], saved: Record<string, Record<string, string>> = {}) {
  const commands: PluginCommand[] = [];
  const blocks: PluginBlock[] = [];
  const settings: PluginSetting[] = [];
  const sidebar: PluginSidebarItem[] = [];
  const plugins: PluginInfo[] = [];
  // in place before any plugin runs, so a plugin can read its settings while starting
  change({ values: saved });
  for (const plugin of found) {
    const { source, ...info } = plugin;
    if (!plugin.enabled) {
      plugins.push(info);
      continue;
    }
    const pending: Pending = { commands: [], blocks: [], settings: [], sidebar: [], watchers: [] };
    try {
      new Function("burrow", `"use strict";\n${source}`)(createApi(plugin, pending));
      commands.push(...pending.commands);
      blocks.push(...pending.blocks);
      settings.push(...pending.settings);
      sidebar.push(...pending.sidebar);
      for (const watcher of pending.watchers) store.subscribe(() => guarded(plugin.id, "reacting to a change", watcher));
      plugins.push(info);
    } catch (cause) {
      plugins.push({ ...info, error: `While starting: ${reason(cause)}` });
    }
  }
  change({ plugins, commands, blocks, settings, sidebar });
}
