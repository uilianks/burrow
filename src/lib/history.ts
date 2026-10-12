import { desktop } from "./desktop";
import type { Block } from "./store";

/** A page as it was at some moment (see snapshot.ts for what is in `blocks`). */
export interface Version {
  key: number;
  page: string;
  at: number;
  blocks: Block[];
}

const STORE = "versions";
const KEEP = 30;
/** A new version is kept at most this often per page, so a long writing session is a handful of versions. */
const GAP = 2 * 60 * 1000;

let db: Promise<IDBDatabase> | undefined;
const open = () =>
  (db ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("folio-history", 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { autoIncrement: true }).createIndex("page", "page");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));

// In the desktop app a page's versions are one file in the notes folder, oldest first.
const fileFor = (page: string) => `history-${page}`;
const readFile = async (page: string) => ((await desktop()!.readData(fileFor(page))) as Omit<Version, "key">[] | null) ?? [];

/** Versions of a page, newest first. */
export async function listVersions(page: string): Promise<Version[]> {
  if (desktop()) return (await readFile(page)).map((version) => ({ ...version, key: version.at })).reverse();
  const database = await open();
  return new Promise((resolve, reject) => {
    const index = database.transaction(STORE).objectStore(STORE).index("page");
    const values = index.getAll(page);
    const keys = index.getAllKeys(page);
    keys.onsuccess = () =>
      resolve((values.result as Omit<Version, "key">[]).map((value, i) => ({ ...value, key: keys.result[i] as number })).reverse());
    keys.onerror = () => reject(keys.error);
  });
}

const latest = new Map<string, { at: number; signature: string }>();

/** Keeps the page's current state as a version if it changed and the last version is old enough. */
export async function maybeSaveVersion(page: string, blocks: Block[]) {
  const signature = JSON.stringify(blocks);
  if (!latest.has(page)) {
    const [newest] = await listVersions(page);
    latest.set(page, newest ? { at: newest.at, signature: JSON.stringify(newest.blocks) } : { at: 0, signature: "" });
  }
  const last = latest.get(page)!;
  const now = Date.now();
  if (signature === last.signature || now - last.at < GAP) return;
  latest.set(page, { at: now, signature });
  if (desktop()) return desktop()!.writeData(fileFor(page), [...(await readFile(page)), { page, at: now, blocks }].slice(-KEEP));
  const database = await open();
  const versions = database.transaction(STORE, "readwrite").objectStore(STORE);
  versions.add({ page, at: now, blocks });
  const keys = versions.index("page").getAllKeys(page);
  keys.onsuccess = () => keys.result.slice(0, Math.max(0, keys.result.length - KEEP)).forEach((key) => versions.delete(key));
}
