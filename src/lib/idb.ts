import type { Block, Persistence } from "./store";

const STORE = "blocks";

/**
 * Blocks in IndexedDB. Its writes finish a moment after they are asked for,
 * and closing or reloading the tab in that moment would drop them. So every
 * change is first written, synchronously, to a small journal in localStorage,
 * and removed from it once the database confirms. Loading replays whatever
 * is still in the journal.
 */
export function idbPersistence(name = "burrow"): Persistence {
  const journalKey = `${name}:unsaved`;
  const unsaved = new Map<string, Block | null>();
  // Without localStorage (private windows, blocked site data) there is simply no journal.
  const writeJournal = () => {
    try {
      if (unsaved.size) window.localStorage.setItem(journalKey, JSON.stringify([...unsaved]));
      else window.localStorage.removeItem(journalKey);
    } catch {}
  };
  const readJournal = (): [string, Block | null][] => {
    try {
      return JSON.parse(window.localStorage.getItem(journalKey) ?? "[]");
    } catch {
      return [];
    }
  };

  let db: Promise<IDBDatabase> | undefined;
  const open = () =>
    (db ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }));

  const save: Persistence["save"] = async (changed) => {
    for (const [id, value] of Object.entries(changed)) unsaved.set(id, value);
    writeJournal();
    const database = await open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE, "readwrite");
      const blocks = transaction.objectStore(STORE);
      for (const [id, value] of Object.entries(changed)) {
        if (value) blocks.put(value);
        else blocks.delete(id);
      }
      transaction.oncomplete = () => {
        // a newer change to the same block may already be waiting; leave that one in the journal
        for (const [id, value] of Object.entries(changed)) if (unsaved.get(id) === value) unsaved.delete(id);
        writeJournal();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  };

  return {
    async load() {
      const database = await open();
      const records = await new Promise<Record<string, Block>>((resolve, reject) => {
        const request = database.transaction(STORE).objectStore(STORE).getAll();
        request.onsuccess = () => resolve(Object.fromEntries((request.result as Block[]).map((block) => [block.id, block])));
        request.onerror = () => reject(request.error);
      });
      const journal = readJournal();
      if (journal.length) {
        for (const [id, value] of journal) {
          if (value) records[id] = value;
          else delete records[id];
        }
        await save(Object.fromEntries(journal));
      }
      return records;
    },
    save,
  };
}
