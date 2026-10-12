import type { FileStore } from "./files";
import type { FoundPlugin } from "./plugins";
import type { Block, Persistence } from "./store";

/** What desktop/preload.cjs exposes when Folio runs as the desktop app. */
export interface DesktopBridge {
  load(): Promise<Block[]>;
  save(changed: Record<string, Block | null>): Promise<void>;
  folder(): Promise<string>;
  showFolder(): Promise<void>;
  /** Asks for another notes folder; the app reloads into it. Null when cancelled. */
  chooseFolder(): Promise<string | null>;
  mirror(files: Record<string, string>): Promise<void>;
  putFile(name: string, bytes: ArrayBuffer): Promise<string>;
  getFile(id: string): Promise<{ bytes: ArrayBuffer; type: string } | null>;
  fileKeys(): Promise<string[]>;
  deleteFile(id: string): Promise<void>;
  onSaveFailed(listener: (message: string) => void): void;
  /** The title, description and picture a web page declares for itself, or null if it can't be read. */
  preview(url: string): Promise<{ title: string; description: string; image: string } | null>;
  /** Small named JSON files kept in the notes folder's .folio/ directory (settings, page history). */
  readData(name: string): Promise<unknown>;
  writeData(name: string, value: unknown): Promise<void>;
  /** Plugins in the notes folder's plugins/ directory, with their scripts. */
  listPlugins(): Promise<FoundPlugin[]>;
  setPluginEnabled(id: string, enabled: boolean): Promise<void>;
  showPluginsFolder(): Promise<void>;
}

declare global {
  interface Window {
    folioDesktop?: DesktopBridge;
  }
}

/** The desktop shell, or undefined when running in a plain browser (development, tests). */
export const desktop = () => (typeof window === "undefined" ? undefined : window.folioDesktop);

export const desktopPersistence = (bridge: DesktopBridge): Persistence => ({
  load: async () => Object.fromEntries((await bridge.load()).map((block) => [block.id, block])),
  save: (changed) => bridge.save(changed),
});

export const desktopFiles = (bridge: DesktopBridge): FileStore => ({
  put: async (file) => bridge.putFile(file instanceof File ? file.name : "file", await file.arrayBuffer()),
  get: async (id) => {
    const found = await bridge.getFile(id);
    return found ? new Blob([found.bytes], { type: found.type }) : undefined;
  },
  keys: () => bridge.fileKeys(),
  delete: (id) => bridge.deleteFile(id),
});
