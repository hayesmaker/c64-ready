/**
 * Client for the `@c64cade/ultimate-bridge` npm bridge. Browsers can't call an Ultimate's
 * REST API directly, so requests go to the bridge running on the user's machine, which
 * forwards them to the device. The protocol matches C64Cade's own client.
 */

export const DEFAULT_BRIDGE_URL = 'http://localhost:6464';
export const ULTIMATE_BRIDGE_PACKAGE_URL = 'https://www.npmjs.com/package/@c64cade/ultimate-bridge';
export const ULTIMATE_FILE_TYPES = ['prg', 'crt', 'd64'] as const;
export const DEFAULT_D64_AUTOLOAD_COMMAND = 'LOAD"*",8,1\nRUN';

const BRIDGE_URL_STORAGE_KEY = 'c64-ultimate-bridge-url';
const IP_STORAGE_KEY = 'c64-ultimate-ip';
const PASSWORD_STORAGE_KEY = 'c64-ultimate-password';

export type UltimateFileType = (typeof ULTIMATE_FILE_TYPES)[number];

export interface UltimateSettings {
  bridgeUrl: string;
  ip: string;
  password: string;
}

export interface UltimateDeviceInfo {
  product?: string;
  firmware_version?: string;
  fpga_version?: string;
  core_version?: string;
  hostname?: string;
  unique_id?: string;
  [key: string]: unknown;
}

export interface UltimateLaunchOptions {
  fileType: UltimateFileType;
  filename: string;
  data: Uint8Array<ArrayBufferLike>;
  joyPort?: number;
  autoLoadCommand?: string;
}

export function getSavedUltimateSettings(): UltimateSettings {
  return {
    bridgeUrl: readStorage(BRIDGE_URL_STORAGE_KEY) || DEFAULT_BRIDGE_URL,
    ip: readStorage(IP_STORAGE_KEY),
    password: readStorage(PASSWORD_STORAGE_KEY),
  };
}

export function saveUltimateSettings(settings: Partial<UltimateSettings>): void {
  if (settings.bridgeUrl !== undefined)
    writeStorage(BRIDGE_URL_STORAGE_KEY, settings.bridgeUrl || DEFAULT_BRIDGE_URL);
  if (settings.ip !== undefined) writeStorage(IP_STORAGE_KEY, settings.ip);
  if (settings.password !== undefined) writeStorage(PASSWORD_STORAGE_KEY, settings.password);
}

export function isUltimateFileType(value: unknown): value is UltimateFileType {
  return typeof value === 'string' && (ULTIMATE_FILE_TYPES as readonly string[]).includes(value);
}

export function isValidUltimateIp(ip: string): boolean {
  const value = ip.trim();
  return (
    /^(?:\d{1,3}\.){3}\d{1,3}$/.test(value) &&
    value.split('.').every((octet) => Number(octet) <= 255)
  );
}

export async function getUltimateInfo(settings: UltimateSettings): Promise<UltimateDeviceInfo> {
  const { bridgeUrl, ip, password } = settings;
  return (await postToBridge(bridgeUrl, '/ultimate/info', { ip, password })) as UltimateDeviceInfo;
}

export async function launchOnUltimate(
  settings: UltimateSettings,
  options: UltimateLaunchOptions,
): Promise<void> {
  const { bridgeUrl, ip, password } = settings;
  await postToBridge(bridgeUrl, '/ultimate/launch', {
    ip,
    password,
    fileType: options.fileType,
    filename: options.filename,
    fileBase64: bytesToBase64(options.data),
    autoLoadCommand: options.autoLoadCommand ?? DEFAULT_D64_AUTOLOAD_COMMAND,
    joyPort: options.joyPort ?? 2,
  });
}

export async function rebootUltimate(settings: UltimateSettings): Promise<void> {
  const { bridgeUrl, ip, password } = settings;
  await postToBridge(bridgeUrl, '/ultimate/reboot', { ip, password });
}

export async function powerOffUltimate(settings: UltimateSettings): Promise<void> {
  const { bridgeUrl, ip, password } = settings;
  await postToBridge(bridgeUrl, '/ultimate/poweroff', { ip, password, timeoutMs: 1500 }, 2500);
}

export function bytesToBase64(bytes: Uint8Array<ArrayBufferLike>): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

async function postToBridge(
  bridgeUrl: string,
  path: string,
  body: Record<string, unknown>,
  timeoutMs?: number,
): Promise<unknown> {
  const baseUrl = (bridgeUrl || DEFAULT_BRIDGE_URL).replace(/\/$/, '');
  const controller = timeoutMs ? new AbortController() : null;
  const timer = controller ? window.setTimeout(() => controller.abort(), timeoutMs) : null;

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller?.signal,
    });
  } catch (err) {
    // fetch only rejects when the bridge itself can't be reached; Ultimate errors come back as JSON.
    if ((err as Error)?.name === 'AbortError')
      throw new Error(`The Ultimate bridge at ${baseUrl} did not respond in time.`, {
        cause: err,
      });
    throw new Error(
      `Could not reach the Ultimate bridge at ${baseUrl}. Start it with: npx @c64cade/ultimate-bridge`,
      { cause: err },
    );
  } finally {
    if (timer !== null) window.clearTimeout(timer);
  }

  const data = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) throw new Error(data?.error || `Bridge request failed: ${response.status}`);
  return data;
}

function readStorage(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function writeStorage(key: string, value: string): void {
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    // storage unavailable (private mode etc.)
  }
}
