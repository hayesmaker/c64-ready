import type { GameLoadOptions } from '../types';

export type LoadType = GameLoadOptions['type'];
export type LoadTypeSelection = LoadType | 'auto';

export interface LoadFormatOption {
  type: LoadType;
  label: string;
  extensions: string[];
}

export const LOAD_FORMAT_OPTIONS: LoadFormatOption[] = [
  { type: 'crt', label: 'Cartridge (.crt)', extensions: ['.crt'] },
  { type: 'prg', label: 'Program (.prg)', extensions: ['.prg'] },
  { type: 'd64', label: 'Disk image (.d64)', extensions: ['.d64'] },
  {
    type: 'snapshot',
    label: 'Snapshot (.snapshot, .vsf, .s64)',
    extensions: ['.snapshot', '.vsf', '.s64'],
  },
];

const LOAD_TYPE_SET = new Set<LoadType>(LOAD_FORMAT_OPTIONS.map((f) => f.type));

export function isSupportedLoadType(value: unknown): value is LoadType {
  return typeof value === 'string' && LOAD_TYPE_SET.has(value as LoadType);
}

export function inferLoadTypeFromFilename(filename: string): LoadType | null {
  const lower = filename.toLowerCase();
  for (const format of LOAD_FORMAT_OPTIONS) {
    if (format.extensions.some((ext) => lower.endsWith(ext))) {
      return format.type;
    }
  }
  return null;
}

export function resolveLoadTypeSelection(
  selection: LoadTypeSelection,
  filename: string,
  fallback: LoadType = 'crt',
): LoadType {
  if (selection !== 'auto') return selection;
  return inferLoadTypeFromFilename(filename) ?? fallback;
}

export function getAcceptForLoadTypeSelection(selection: LoadTypeSelection): string {
  const exts =
    selection === 'auto'
      ? LOAD_FORMAT_OPTIONS.flatMap((f) => f.extensions)
      : LOAD_FORMAT_OPTIONS.find((f) => f.type === selection)?.extensions ?? [];
  return exts.join(',');
}

export function getLoadTypeLabel(type: LoadType): string {
  return LOAD_FORMAT_OPTIONS.find((f) => f.type === type)?.label ?? type.toUpperCase();
}
