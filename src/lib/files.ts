import { useEffect, useState } from "react";
import { desktop, desktopFiles } from "./desktop";

/** Where uploaded files live: the notes folder's attachments/ in the desktop app, IndexedDB in a plain browser. */
export interface FileStore {
  put(file: Blob): Promise<string>;
  get(id: string): Promise<Blob | undefined>;
  keys(): Promise<string[]>;
  delete(id: string): Promise<void>;
}

const STORE = "files";

export function idbFiles(name = "folio-files"): FileStore {
  let db: Promise<IDBDatabase> | undefined;
  const open = () =>
    (db ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }));
  const run = async <T>(mode: IDBTransactionMode, work: (files: IDBObjectStore) => IDBRequest<T>) => {
    const database = await open();
    return new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE, mode);
      const request = work(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = transaction.onabort = () => reject(transaction.error);
    });
  };

  return {
    async put(file) {
      const id = crypto.randomUUID();
      await run("readwrite", (files) => files.put(file, id));
      return id;
    },
    get: (id) => run("readonly", (files) => files.get(id) as IDBRequest<Blob | undefined>),
    keys: () => run("readonly", (files) => files.getAllKeys() as IDBRequest<string[]>),
    delete: async (id) => void (await run("readwrite", (files) => files.delete(id))),
  };
}

const bridge = desktop();
export const files: FileStore = bridge ? desktopFiles(bridge) : idbFiles();

// One object URL per file for the life of the tab: blocks showing the same file share it.
const urls = new Map<string, Promise<string | null>>();
const urlFor = (id: string) => {
  if (!urls.has(id)) {
    urls.set(
      id,
      files.get(id).then(
        (blob) => (blob ? URL.createObjectURL(blob) : null),
        () => null,
      ),
    );
  }
  return urls.get(id)!;
};

/**
 * An address the browser can load for a stored file: undefined while it is
 * being read, null if the file is not in this browser.
 */
export function useFileUrl(id: string | undefined): string | null | undefined {
  const [loaded, setLoaded] = useState<{ id: string; url: string | null }>();
  useEffect(() => {
    if (!id) return;
    let current = true;
    urlFor(id).then((url) => current && setLoaded({ id, url }));
    return () => {
      current = false;
    };
  }, [id]);
  return loaded?.id === id ? loaded?.url : undefined;
}
