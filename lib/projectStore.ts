// IndexedDB helper for Manga Translator project state persistence

const DB_NAME = "SuperKMangaTranslatorDB";
const DB_VERSION = 1;
const STORE_NAME = "project_session";

interface SessionData {
  id: string;
  pages: { url: string; name: string }[];
  currentPage: number;
  bubbleCache: [string, any[]][];
  translatedImageCache: [string, string][];
  updatedAt: number;
}

const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      reject(new Error("IndexedDB is not supported in this environment"));
      return;
    }
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
  });
};

export const saveProjectSession = async (data: {
  pages: { url: string; name: string }[];
  currentPage: number;
  bubbleCache: Map<string, any[]>;
  translatedImageCache: Map<string, string>;
}): Promise<void> => {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);

    const sessionData: SessionData = {
      id: "latest_session",
      pages: data.pages,
      currentPage: data.currentPage,
      bubbleCache: Array.from(data.bubbleCache.entries()),
      translatedImageCache: Array.from(data.translatedImageCache.entries()),
      updatedAt: Date.now(),
    };

    await new Promise<void>((resolve, reject) => {
      const req = store.put(sessionData);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn("Failed to save project session to IndexedDB", err);
  }
};

export const loadProjectSession = async (): Promise<{
  pages: { url: string; name: string }[];
  currentPage: number;
  bubbleCache: Map<string, any[]>;
  translatedImageCache: Map<string, string>;
  updatedAt: number;
} | null> => {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);

    const data = await new Promise<SessionData | null>((resolve, reject) => {
      const req = store.get("latest_session");
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });

    if (!data || !data.pages || data.pages.length === 0) return null;

    return {
      pages: data.pages,
      currentPage: data.currentPage || 0,
      bubbleCache: new Map(data.bubbleCache || []),
      translatedImageCache: new Map(data.translatedImageCache || []),
      updatedAt: data.updatedAt,
    };
  } catch (err) {
    console.warn("Failed to load project session from IndexedDB", err);
    return null;
  }
};

export const clearProjectSession = async (): Promise<void> => {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);

    await new Promise<void>((resolve, reject) => {
      const req = store.delete("latest_session");
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn("Failed to clear project session from IndexedDB", err);
  }
};
