/**
 * Client for the C64Cade Ultimate Bridge — the browser extension (Chrome / Firefox) or the
 * `@c64cade/ultimate-bridge` npm bridge. Browsers can't call an Ultimate's REST API directly,
 * so every request goes through one of those. The protocol matches C64Cade's own client.
 */

export const DEFAULT_BRIDGE_URL = 'http://localhost:6464';
export const ULTIMATE_FILE_TYPES = ['prg', 'crt', 'd64'] as const;
export const DEFAULT_D64_AUTOLOAD_COMMAND = 'LOAD"*",8,1\nRUN';

const EXTENSION_READY_EVENT = 'c64cade-ultimate-bridge-ready';
const EXTENSION_DISABLED_ERROR = 'C64Cade Ultimate Bridge is disabled in extension options';
const EXTENSION_DETECT_TIMEOUT_MS = 1500;
const EXTENSION_INFO_TIMEOUT_MS = 8000;
const LAUNCH_TIMEOUT_MS = 60000;

const BRIDGE_URL_STORAGE_KEY = 'c64-ultimate-bridge-url';
const IP_STORAGE_KEY = 'c64-ultimate-ip';
const PASSWORD_STORAGE_KEY = 'c64-ultimate-password';
const ROUTE_STORAGE_KEY = 'c64-ultimate-route';

export type UltimateFileType = (typeof ULTIMATE_FILE_TYPES)[number];
/** 'extension' or 'bridge' (npm bridge); '' picks the extension when present. */
export type UltimateRoute = 'extension' | 'bridge' | '';

export interface UltimateSettings {
  bridgeUrl: string;
  ip: string;
  password: string;
  route: UltimateRoute;
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

export interface ExtensionStatus {
  version?: string;
  enabled: boolean;
  ip?: string;
  hasValidIp?: boolean;
  hasPermission?: boolean;
  supportsStatus: boolean;
}

export interface UltimateLaunchOptions {
  fileType: UltimateFileType;
  filename: string;
  data: Uint8Array<ArrayBufferLike>;
  joyPort?: number;
  autoLoadCommand?: string;
}

interface ExtensionBridge {
  version?: string;
  request(payload: Record<string, unknown>): Promise<unknown>;
}

declare global {
  interface Window {
    C64CadeUltimateBridge?: ExtensionBridge;
  }
}

export const ULTIMATE_INSTALL_OPTIONS = [
  {
    name: 'Chrome extension',
    url: 'https://chromewebstore.google.com/detail/hbjmpjdmmgemjceidcmacpalbnegamnp',
  },
  {
    name: 'Firefox add-on',
    url: 'https://addons.mozilla.org/en-GB/firefox/addon/c64cade-ultimate-bridge/',
  },
  {
    name: 'npm bridge',
    url: 'https://www.npmjs.com/package/@c64cade/ultimate-bridge',
  },
] as const;

export function getSavedUltimateSettings(): UltimateSettings {
  const route = readStorage(ROUTE_STORAGE_KEY);
  return {
    bridgeUrl: readStorage(BRIDGE_URL_STORAGE_KEY) || DEFAULT_BRIDGE_URL,
    ip: readStorage(IP_STORAGE_KEY),
    password: readStorage(PASSWORD_STORAGE_KEY),
    route: route === 'extension' || route === 'bridge' ? route : '',
  };
}

export function saveUltimateSettings(settings: Partial<UltimateSettings>): void {
  if (settings.bridgeUrl !== undefined)
    writeStorage(BRIDGE_URL_STORAGE_KEY, settings.bridgeUrl || DEFAULT_BRIDGE_URL);
  if (settings.ip !== undefined) writeStorage(IP_STORAGE_KEY, settings.ip);
  if (settings.password !== undefined) writeStorage(PASSWORD_STORAGE_KEY, settings.password);
  if (settings.route !== undefined) writeStorage(ROUTE_STORAGE_KEY, settings.route);
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

/**
 * Resolves true once the extension's page bridge is available. The extension injects it
 * asynchronously, so it can arrive after the page first looks for it.
 */
export function waitForExtensionBridge(timeoutMs = EXTENSION_DETECT_TIMEOUT_MS): Promise<boolean> {
  if (window.C64CadeUltimateBridge?.request) return Promise.resolve(true);

  return new Promise((resolve) => {
    const finish = (found: boolean) => {
      window.clearTimeout(timer);
      window.removeEventListener(EXTENSION_READY_EVENT, onReady);
      resolve(found);
    };
    const onReady = () => finish(true);
    const timer = window.setTimeout(
      () => finish(!!window.C64CadeUltimateBridge?.request),
      timeoutMs,
    );
    window.addEventListener(EXTENSION_READY_EVENT, onReady);
  });
}

/** Reads the extension's own settings. Older extensions without a `status` action report none. */
export async function getExtensionStatus(): Promise<ExtensionStatus | null> {
  const bridge = window.C64CadeUltimateBridge;
  if (!bridge?.request) return null;

  try {
    const status = (await bridge.request({ action: 'status', timeoutMs: 3000 })) as Omit<
      ExtensionStatus,
      'supportsStatus'
    >;
    return { ...status, supportsStatus: true };
  } catch (err) {
    return {
      version: bridge.version,
      enabled: errorMessage(err) !== EXTENSION_DISABLED_ERROR,
      supportsStatus: false,
    };
  }
}

/** Explains what still needs setting up in the extension, or '' when it is ready. */
export function getExtensionSetupHint(status: ExtensionStatus | null): string {
  if (!status) return '';
  if (!status.enabled)
    return 'The extension is turned off. Open its settings and tick Enable Ultimate Bridge.';
  if (!status.supportsStatus) return '';
  if (!status.hasValidIp)
    return "Enter your Ultimate's IP address in the extension settings, then save.";
  if (!status.hasPermission)
    return `Save the IP address in the extension settings to give it access to ${status.ip}.`;
  return '';
}

export async function openExtensionOptions(): Promise<void> {
  await window.C64CadeUltimateBridge?.request({ action: 'open-options', timeoutMs: 3000 });
}

export async function getUltimateInfo(settings: UltimateSettings): Promise<UltimateDeviceInfo> {
  const { bridgeUrl, ip, password, route } = settings;
  const extensionResponse = await requestExtensionBridge(
    'info',
    { ip, timeoutMs: EXTENSION_INFO_TIMEOUT_MS },
    route,
  );
  if (extensionResponse) return extensionResponse as UltimateDeviceInfo;

  return (await postToBridge(bridgeUrl, '/ultimate/info', { ip, password })) as UltimateDeviceInfo;
}

export async function launchOnUltimate(
  settings: UltimateSettings,
  options: UltimateLaunchOptions,
): Promise<void> {
  const { bridgeUrl, ip, password, route } = settings;
  const payload = {
    ip,
    fileType: options.fileType,
    filename: options.filename,
    fileBase64: bytesToBase64(options.data),
    autoLoadCommand: options.autoLoadCommand ?? DEFAULT_D64_AUTOLOAD_COMMAND,
    joyPort: options.joyPort ?? 2,
  };
  const extensionResponse = await requestExtensionBridge(
    'launch',
    { ...payload, timeoutMs: LAUNCH_TIMEOUT_MS },
    route,
  );
  if (extensionResponse) return;

  await postToBridge(bridgeUrl, '/ultimate/launch', { ...payload, password });
}

export async function rebootUltimate(settings: UltimateSettings): Promise<void> {
  const { bridgeUrl, ip, password, route } = settings;
  const extensionResponse = await requestExtensionBridge('reboot', { ip }, route);
  if (extensionResponse) return;

  await postToBridge(bridgeUrl, '/ultimate/reboot', { ip, password });
}

export async function powerOffUltimate(settings: UltimateSettings): Promise<void> {
  const { bridgeUrl, ip, password, route } = settings;
  const extensionResponse = await requestExtensionBridge(
    'poweroff',
    { ip, timeoutMs: 1500 },
    route,
  );
  if (extensionResponse) return;

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

/** Returns null when the npm bridge should handle the request instead of the extension. */
async function requestExtensionBridge(
  action: string,
  payload: Record<string, unknown>,
  route: UltimateRoute,
): Promise<unknown> {
  if (route === 'bridge') return null;
  const bridge = window.C64CadeUltimateBridge;
  if (!bridge?.request) {
    if (route === 'extension')
      throw new Error(
        'The C64Cade Ultimate Bridge extension was not found. Reload the page, or check it is installed.',
      );
    return null;
  }
  try {
    // The extension resolves with undefined for some actions; callers only need "handled".
    return (await bridge.request({ ...payload, action })) ?? { ok: true };
  } catch (err) {
    if (errorMessage(err) === EXTENSION_DISABLED_ERROR) {
      if (route === 'extension')
        throw new Error(
          'The browser extension is turned off. Turn it on in the extension settings.',
          { cause: err },
        );
      return null;
    }
    throw err;
  }
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
      throw new Error(`The npm bridge at ${baseUrl} did not respond in time.`, { cause: err });
    throw new Error(`Could not reach the npm bridge at ${baseUrl}. Check it is running.`, {
      cause: err,
    });
  } finally {
    if (timer !== null) window.clearTimeout(timer);
  }

  const data = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) throw new Error(data?.error || `Bridge request failed: ${response.status}`);
  return data;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
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
