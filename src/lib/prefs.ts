import { useSyncExternalStore } from "react";
import { desktop } from "./desktop";
import { GRAPH_DEFAULTS, type GraphOptions } from "./graph";

/** Settings for this browser, as opposed to the pages themselves. */
export interface Prefs {
  theme: "system" | "light" | "dark";
  fullWidthDefault: boolean;
  focusMode: boolean;
  /** Recently opened pages, newest first. */
  recents: string[];
  /** The colour used for selection, links and highlights across the app. */
  accent: Accent;
  /** Solid panels instead of translucent ones: easier to read, and lighter on older graphics hardware. */
  reduceTransparency: boolean;
  spellcheck: boolean;
  graph: GraphOptions;
}

export const ACCENTS = { blue: "#0a84ff", purple: "#af52de", pink: "#ff2d6f", red: "#ff453a", orange: "#ff9500", green: "#30b158", graphite: "#8e8e93" };
export type Accent = keyof typeof ACCENTS;

const KEY = "folio:prefs";
const DEFAULTS: Prefs = { theme: "system", fullWidthDefault: false, focusMode: false, recents: [], accent: "blue", reduceTransparency: false, spellcheck: true, graph: GRAPH_DEFAULTS };
const listeners = new Set<() => void>();
let current: Prefs | undefined;

// Storage can be unavailable (private windows, blocked site data); prefs then last only for the visit.
const getSnapshot = (): Prefs => {
  if (current) return current;
  try {
    current = { ...DEFAULTS, ...JSON.parse(window.localStorage.getItem(KEY) ?? "{}") };
  } catch {
    current = DEFAULTS;
  }
  return current!;
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const usePrefs = () => useSyncExternalStore(subscribe, getSnapshot, () => DEFAULTS);

export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
  current = { ...getSnapshot(), [key]: value };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(current));
  } catch {}
  // in the desktop app the settings also live in the notes folder, so they move with it
  desktop()?.writeData("settings", current).catch(() => {});
  for (const listener of listeners) listener();
}

/** Desktop: takes the settings saved in the notes folder, which win over this computer's own copy. */
export async function loadSavedPrefs() {
  const saved = await desktop()?.readData("settings");
  if (!saved || typeof saved !== "object") return;
  current = { ...getSnapshot(), ...(saved as Partial<Prefs>) };
  for (const listener of listeners) listener();
}
