import type { C64Emulator } from '../emulator/c64-emulator';
import type { GameLoadOptions } from '../types';

export type ProgressCallback = (percent: number, label: string) => void;

export class C64Player {
  private readonly emulator: C64Emulator;

  constructor(emulator: C64Emulator) {
    this.emulator = emulator;
  }

  async loadGame(
    url: string,
    type: GameLoadOptions['type'] = 'crt',
    onProgress?: ProgressCallback,
  ): Promise<void> {
    onProgress?.(0, 'LOADING GAME...');

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch game: ${response.status}`);
    }

    const contentLength = Number(response.headers.get('content-length') ?? 0);
    let data: Uint8Array;

    if (contentLength > 0 && response.body) {
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let loaded = 0;

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        loaded += value.byteLength;
        const pct = Math.round((loaded / contentLength) * 90);
        onProgress?.(pct, `LOADING GAME... ${Math.round((loaded / contentLength) * 100)}%`);
      }

      data = new Uint8Array(loaded);
      let offset = 0;
      for (const chunk of chunks) {
        data.set(chunk, offset);
        offset += chunk.byteLength;
      }
    } else {
      data = new Uint8Array(await response.arrayBuffer());
    }

    onProgress?.(95, 'INSERTING CARTRIDGE...');
    this.emulator.loadGame({ type, data });
    onProgress?.(100, 'READY!');
  }
}

