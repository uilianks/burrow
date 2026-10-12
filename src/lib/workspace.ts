import { useSyncExternalStore } from "react";
import { desktop, desktopPersistence } from "./desktop";
import { idbPersistence } from "./idb";
import { Store } from "./store";

// In the desktop app notes live in the person's notes folder; in a plain browser, in IndexedDB.
const bridge = desktop();
export const store = new Store(bridge ? desktopPersistence(bridge) : idbPersistence());

export const useRecords = () => useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);

const subscribeHash = (listener: () => void) => {
  window.addEventListener("hashchange", listener);
  return () => window.removeEventListener("hashchange", listener);
};

/** The open page id lives in the URL hash so pages are linkable and Back works. */
export const useHash = () =>
  useSyncExternalStore(
    subscribeHash,
    () => window.location.hash.slice(1),
    () => "",
  );

export const openPage = (id: string) => {
  window.location.hash = id;
};
