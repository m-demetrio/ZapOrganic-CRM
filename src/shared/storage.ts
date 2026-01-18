type StorageEnvelope<T> = {
  schemaVersion: number;
  value: T;
};

const SCHEMA_VERSION = 1;

const migrations: Array<(value: unknown) => unknown> = [
  (value) => value
];

const isEnvelope = (value: unknown): value is StorageEnvelope<unknown> => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return typeof record.schemaVersion === "number" && "value" in record;
};

const normalizeVersion = (version: unknown) => {
  if (typeof version !== "number" || !Number.isFinite(version) || version < 0) {
    return 0;
  }

  return Math.floor(version);
};

const applyMigrations = (value: unknown, fromVersion: number) => {
  let current = value;

  for (let version = fromVersion; version < SCHEMA_VERSION; version += 1) {
    const migration = migrations[version];
    if (migration) {
      current = migration(current);
    }
  }

  return current;
};

const readStorageValue = async (key: string): Promise<unknown | undefined> => {
  if (chrome?.storage?.local) {
    return await new Promise<unknown | undefined>((resolve) => {
      chrome.storage.local.get([key], (result) => {
        resolve(result[key]);
      });
    });
  }

  const raw = localStorage.getItem(key);
  if (!raw) {
    return undefined;
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
};

const writeStorageValue = async (key: string, value: unknown) => {
  if (chrome?.storage?.local) {
    await new Promise<void>((resolve) => {
      chrome.storage.local.set({ [key]: value }, () => resolve());
    });
    return;
  }

  localStorage.setItem(key, JSON.stringify(value));
};

export const loadData = async <T>(key: string, defaultValue: T): Promise<T> => {
  const raw = await readStorageValue(key);
  if (raw === undefined) {
    return defaultValue;
  }

  let storedValue: unknown = raw;
  let version = 0;

  if (isEnvelope(raw)) {
    version = normalizeVersion(raw.schemaVersion);
    storedValue = raw.value;
  }

  if (version > SCHEMA_VERSION) {
    return storedValue as T;
  }

  if (version < SCHEMA_VERSION) {
    const migrated = applyMigrations(storedValue, version);
    await writeStorageValue(key, { schemaVersion: SCHEMA_VERSION, value: migrated });
    return migrated as T;
  }

  return storedValue as T;
};

export const saveData = async (key: string, value: unknown): Promise<void> => {
  await writeStorageValue(key, { schemaVersion: SCHEMA_VERSION, value });
};
