declare module 'c64-cheevos' {
  export function createCheevos(
    detectorId: string,
    options?: Record<string, unknown>,
  ): Promise<unknown>;
}
