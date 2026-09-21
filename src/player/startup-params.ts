export function resolveGameFromParam(
  raw: string | null,
  baseUrl: string,
  options: { disableDefault?: boolean } = {},
): string {
  if (!raw) return options.disableDefault ? '' : `${baseUrl}games/cartridges/legend-of-wilf.crt`;
  const value = raw.trim();
  if (!value) return options.disableDefault ? '' : `${baseUrl}games/cartridges/legend-of-wilf.crt`;
  if (value.toLowerCase() === 'null') return '';
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('/')) return value;
  return `${baseUrl}${value.replace(/^\/+/, '')}`;
}

export function resolveUrlFromParam(raw: string | null, baseUrl: string): string {
  if (!raw) return '';
  const value = raw.trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('/@fs/')) return `${baseUrl.replace(/\/+$/, '')}${value}`;
  if (value.startsWith('/')) return value;
  return `${baseUrl}${value.replace(/^\/+/, '')}`;
}

export function toViteFsUrl(pathOrUrl: string, baseUrl: string): string {
  const value = pathOrUrl.trim();
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  const base = baseUrl.replace(/\/+$/, '');
  if (value.startsWith(`${base}/@fs/`)) return value.slice(base.length);
  if (value.startsWith('/@fs/')) return value;
  if (value.startsWith('/')) return `/@fs${value}`;
  return value;
}

export function shouldDisableDefaultGameForCheevos(params: URLSearchParams): boolean {
  return (
    !params.has('game') && !!params.get('cheevos')?.trim() && !!params.get('cheevosSet')?.trim()
  );
}
