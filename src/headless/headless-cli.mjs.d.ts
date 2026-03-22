// Type declarations for the ESM CLI entrypoint used in tests.
// This declares the local relative module './headless-cli.mjs' so TypeScript
// can type-check imports from tests without requiring a typed build artifact.
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
