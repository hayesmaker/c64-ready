// Declaration for './headless-cli.mjs' to satisfy imports from tests.
declare module './headless-cli.mjs' {
  export interface RunHeadlessOptions {
    argv?: string[];
    instantiateFn?: (
      wasmBinary: ArrayBuffer | Uint8Array,
      importObject: unknown,
    ) => Promise<{ instance: { exports: unknown } }>;
    repoRoot?: string;
  }
  export function runHeadless(
    options?: RunHeadlessOptions,
  ): Promise<{ ok: boolean; output: unknown[] | string }>;
}

export {};
