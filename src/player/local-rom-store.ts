import {
  getAcceptForLoadTypeSelection,
  inferLoadTypeFromFilename,
  isSupportedLoadType,
} from './load-formats';
import type { LoadType } from './load-formats';

const DB_NAME = 'c64-ready-local-roms';
const STORE_NAME = 'rom-files';
const DB_VERSION = 2;

export type LocalRomFile = {
  file: File;
  type: LoadType;
  romPath: string;
};

type StoredRomRecord = {
  romPath: string;
  name: string;
  type: LoadType;
  blob: Blob;
};

type WindowWithFilePicker = Window & {
  showOpenFilePicker?: (options?: {
    multiple?: boolean;
    types?: Array<{ description: string; accept: Record<string, string[]> }>;
  }) => Promise<FileSystemFileHandle[]>;
};

export function getCheevosRomPath(set: { romPath?: unknown; rom?: { path?: unknown } }): string {
  const value = typeof set.romPath === 'string' ? set.romPath : set.rom?.path;
  return typeof value === 'string' ? value.trim() : '';
}

export function getCheevosRomType(set: {
  romPath?: unknown;
  rom?: { path?: unknown; type?: unknown };
}): LoadType | undefined {
  if (isSupportedLoadType(set.rom?.type)) return set.rom.type;
  const romPath = getCheevosRomPath(set);
  return inferLoadTypeFromFilename(romPath) ?? undefined;
}

export async function getStoredCheevosRom(
  romPath: string,
  type?: LoadType,
): Promise<LocalRomFile | null> {
  const record = await getStoredRomRecord(romPath);
  if (!record) return null;
  const file = new File([record.blob], record.name, { type: record.blob.type });
  return { file, type: type ?? record.type, romPath };
}

export async function chooseAndStoreCheevosRom(
  romPath: string,
  type?: LoadType,
): Promise<LocalRomFile | null> {
  const picker = (window as WindowWithFilePicker).showOpenFilePicker;
  if (!picker) return null;
  const [handle] = await picker({
    multiple: false,
    types: [
      {
        description: 'C64 ROM files',
        accept: {
          'application/octet-stream': getAcceptForLoadTypeSelection(type ?? 'auto').split(','),
        },
      },
    ],
  });
  if (!handle) return null;
  const file = await handle.getFile();
  await storeCheevosRomFile(romPath, file, type);
  return { file, type: type ?? inferLoadTypeFromFilename(file.name) ?? 'crt', romPath };
}

export async function storeCheevosRomFile(
  romPath: string,
  file: File,
  type?: LoadType,
): Promise<void> {
  const resolvedType = type ?? inferLoadTypeFromFilename(file.name) ?? 'crt';
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put({
      romPath,
      name: file.name,
      type: resolvedType,
      blob: file,
    } satisfies StoredRomRecord);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Unable to store ROM file'));
  });
  db.close();
}

async function getStoredRomRecord(romPath: string): Promise<StoredRomRecord | null> {
  if (typeof indexedDB === 'undefined') return null;
  const db = await openDb();
  const record = await new Promise<StoredRomRecord | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(romPath);
    request.onsuccess = () => resolve(request.result as StoredRomRecord | undefined);
    request.onerror = () => reject(request.error ?? new Error('Unable to read ROM file'));
  });
  db.close();
  if (!record?.blob || !record.name || !isSupportedLoadType(record.type)) return null;
  return record;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'romPath' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Unable to open local ROM store'));
  });
}
