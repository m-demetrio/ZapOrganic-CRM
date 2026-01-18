type MediaRecord = {
  id: string;
  dataUrl: string;
  mimeType?: string;
  fileName?: string;
  updatedAt: number;
};

const DB_NAME = "zopMedia";
const DB_VERSION = 1;
const STORE_NAME = "media";

let dbPromise: Promise<IDBDatabase> | null = null;

const openDb = () => {
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Falha ao abrir IndexedDB"));
  });

  return dbPromise;
};

const createId = () => `media-${Date.now()}-${Math.random().toString(16).slice(2)}`;

export const putMedia = async (dataUrl: string, mimeType?: string, fileName?: string) => {
  const db = await openDb();
  const id = createId();
  const record: MediaRecord = {
    id,
    dataUrl,
    mimeType,
    fileName,
    updatedAt: Date.now()
  };

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Falha ao gravar arquivo"));
    tx.objectStore(STORE_NAME).put(record);
  });

  return id;
};

export const getMedia = async (id: string): Promise<MediaRecord | null> => {
  const db = await openDb();

  return await new Promise<MediaRecord | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(id);
    request.onsuccess = () => {
      resolve((request.result as MediaRecord | undefined) ?? null);
    };
    request.onerror = () => reject(request.error ?? new Error("Falha ao ler arquivo"));
  });
};

export const deleteMedia = async (id: string) => {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Falha ao remover arquivo"));
    tx.objectStore(STORE_NAME).delete(id);
  });
};
