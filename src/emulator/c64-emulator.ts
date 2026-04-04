/**
 * C64Emulator — public interface for all emulator interactions.
 *
 * Responsibilities:
 * - Own the C64WASM instance and its lifecycle
 * - Expose clean, meaningful methods to frontend/headless consumers
 * - Manage emulation state (running, paused, frameCount)
 * - Fire onFrame / onAudio callbacks each tick
 *
 * Consumers (C64Player, C64Headless, Vue pages) use this class only.
 * They never touch C64WASM directly.
 */

import { C64WASM } from './c64-wasm';
import type { C64Config, FrameBuffer, AudioBuffer, GameLoadOptions, InputEvent } from '../types';
import type { JoystickPort, JoystickInput } from './constants';

const FRAME_WIDTH = 384;
const FRAME_HEIGHT = 272;
const DEFAULT_SAMPLE_RATE = 44100;

export class C64Emulator {
  private wasm: C64WASM;
  private config: C64Config;
  private running: boolean = false;
  private frameCount: number = 0;

  /** Called every tick with the latest video frame */
  onFrame?: (frame: FrameBuffer) => void;
  /** Called every tick with the latest audio samples */
  onAudio?: (audio: AudioBuffer) => void;

  private constructor(wasm: C64WASM, config: Partial<C64Config> = {}) {
    this.wasm = wasm;
    this.config = {
      videoWidth: FRAME_WIDTH,
      videoHeight: FRAME_HEIGHT,
      sampleRate: DEFAULT_SAMPLE_RATE,
      audioChannels: 1,
      cyclesPerFrame: 50,
      ...config,
    };
  }

  // ---------------------------------------------------------------------------
  // Factory
  // ---------------------------------------------------------------------------

  /**
   * Main entry point for any consumer (browser page, headless server, tests).
   *
   * @example
   * const emulator = await C64Emulator.load();
   */
  static async load(
    wasmUrl: string = '/src/emulator/c64.wasm',
    config: Partial<C64Config> = {},
  ): Promise<C64Emulator> {
    const wasm = await C64WASM.load(wasmUrl);
    const emulator = new C64Emulator(wasm, config);
    emulator.init();
    return emulator;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  private init(): void {
    const x = this.wasm.exports;
    if (!x) throw new Error('WASM exports not available');
    x.c64_init();
    // Mirror the headless init sequence exactly — both speed and play must be
    // set explicitly.  c64_init() sets speed=100 and running=1 by default, but
    // some cartridge types (plain 8K normal cart) rely on debugger_play() being
    // called before their first debugger_update().  Without it, simple carts
    // load silently but never execute a single CPU cycle (the debugger stays in
    // its post-init "play" state on most carts but certain CBUG paths leave it
    // paused).  Calling both unconditionally is safe and matches headless-cli.
    x.debugger_set_speed(100);
    x.debugger_play();
    if (this.config.sampleRate) {
      const fn = (this.wasm.exports as unknown as { sid_setSampleRate?: (rate: number) => unknown })
        .sid_setSampleRate;
      if (typeof fn === 'function') fn(this.config.sampleRate);
    }
  }

  start(): void {
    this.running = true;
  }
  pause(): void {
    this.running = false;
  }
  isRunning(): boolean {
    return this.running;
  }
  getFrameCount(): number {
    return this.frameCount;
  }

  reset(): void {
    const x = this.wasm.exports;
    if (!x) return;

    x.c64_reset();

    // Some cartridge types (EXROM=0, GAME=0 / EXROM=0, GAME=1) leave the CPU
    // I/O port ($01) in a state that banks out KERNAL and BASIC after c64_reset().
    // Writing $37 (LORAM=1, HIRAM=1, CHAREN=1) via c64_cpuWrite (not c64_ramWrite)
    // goes through the 6510 CPU port mechanism and updates the WASM's internal
    // banking registers — restoring KERNAL+BASIC visibility so the reset vector
    // at $FFFC/$FFFD reads the correct KERNAL address ($FCE2).
    x.c64_cpuWrite(1, 0x37);

    // ── KERNAL cold-start RAM fixup ───────────────────────────────────────────
    // Problem: certain cartridges (e.g. 8K Normal / 16K Normal) modify the
    // KERNAL's system-variable page ($0200-$02FF) and the CIA1 timer during
    // gameplay.  c64_reset() resets the CPU but does NOT clear RAM.  When the
    // KERNAL cold start runs, a CIA1 timer interrupt fires very early (before
    // the KERNAL can call SEI) because the stale cart timer interval is short.
    // That early IRQ lands in a half-initialized KERNAL, corrupting the CPU I/O
    // DDR register ($00) with a test pattern, which banks out KERNAL and causes
    // the frozen-screen symptom seen after detaching such carts.
    //
    // Fix: zero the KERNAL system-variable page ($0200-$02FF) after reset.
    // The KERNAL cold start re-initializes this page unconditionally anyway,
    // and clearing it prevents the stale timing state from triggering the
    // early-IRQ corruption.  User BASIC programs (from $0801+) are unaffected.
    for (let addr = 0x0200; addr <= 0x02FF; addr++) {
      x.c64_ramWrite(addr, 0);
    }

    // c64_reset() resets CPU/memory but preserves the debugger's running/paused
    // state.  Explicitly call debugger_play() so the machine always resumes.
    x.debugger_play();

    // c64_reset() also resets the SID's internal write counter to 0.  If the
    // audio worklet calls getSidBuffer() → sid_getAudioBuffer() before the next
    // debugger_update(), the counter mismatch causes the first update to run a
    // burst of extra cycles to refill the 4096-sample buffer, blocking the
    // browser for ~100ms and corrupting the KERNAL boot sequence timing.
    // Drain once here so the SID write counter and JS-side reader are in sync.
    x.sid_getAudioBuffer();

    this.frameCount = 0;
  }

  // ---------------------------------------------------------------------------
  // Frame loop — call once per animation frame (requestAnimationFrame)
  // ---------------------------------------------------------------------------

  /**
   * The SID continuously fills a circular audio buffer as CPU cycles execute.
   * Must match the ScriptProcessorNode buffer length used by the original
   * c64.js runtime (4096 samples).
   */
  private static readonly AUDIO_BUFFER_SIZE = 4096;

  tick(dTime: number = 0): void {
    if (!this.running) return;
    const x = this.wasm.exports!;

    // Clamp dTime to one frame's worth of work (~20ms at 50fps).
    if (!dTime || dTime > 25) dTime = 20;

    const updated = x.debugger_update(dTime);
    this.frameCount++;

    // Only push a video frame when the emulator actually advanced
    if (updated && this.onFrame) {
      const ptr = x.c64_getPixelBuffer();
      const data = this.wasm.heap!.heapU8.subarray(ptr, ptr + FRAME_WIDTH * FRAME_HEIGHT * 4);
      this.onFrame({ width: FRAME_WIDTH, height: FRAME_HEIGHT, data, timestamp: this.frameCount });
    }
  }

  // ---------------------------------------------------------------------------
  // Game loading
  // ---------------------------------------------------------------------------

  /**
   * Parse the CRT file header and return a human-readable one-line description
   * matching the format used by tools/cart-diagnostics.mjs.
   * Returns null if the data is too short to be a valid CRT.
   */
  private static describeCrt(data: Uint8Array): string | null {
    if (data.length < 64) return null;
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const magic = String.fromCharCode(...data.slice(0, 16)).trimEnd();
    if (!magic.startsWith('C64 CARTRIDGE')) return null;

    const hwType = view.getUint16(22, false);
    const exrom  = data[24];
    const game   = data[25];

    const hwTypeNames: Record<number, string> = {
      0: 'Normal', 1: 'Action Replay', 3: 'Final Cartridge III', 4: 'Simons BASIC',
      5: 'Ocean type 1', 7: 'Fun Play', 8: 'Super Games', 15: 'Magic Desk',
      17: 'Dinamic', 19: 'EasyFlash', 21: 'Comal-80', 32: 'Pagefox',
    };
    const memMapNames: Record<string, string> = {
      '0,0': '16K (ROML+ROMH)',
      '0,1': '8K (ROML only)',
      '1,0': 'MAX Machine (2K at $F800)',
      '1,1': 'Ultimax / disabled',
    };
    const hwName = hwTypeNames[hwType] ?? `Unknown(${hwType})`;
    const flagMap = memMapNames[`${exrom},${game}`] ?? `EXROM=${exrom} GAME=${game}`;

    // Walk CHIP packets: collect load addresses to describe actual ROM coverage.
    // The EXROM/GAME flags declare the *intended* memory map but don't reflect
    // how many CHIP packets are actually present — e.g. many "16K" (EXROM=0,
    // GAME=0) carts have only one 8K CHIP at $8000, leaving ROMH unmapped.
    const headerLen = view.getUint32(16, false);
    let chipCount = 0;
    let off = headerLen;
    const chipAddrs: string[] = [];
    let totalRomBytes = 0;
    while (off + 16 <= data.length) {
      const sig = String.fromCharCode(data[off], data[off+1], data[off+2], data[off+3]);
      if (sig !== 'CHIP') break;
      const pktLen  = view.getUint32(off + 4, false);
      const loadAddr = view.getUint16(off + 12, false);
      const romSize  = view.getUint16(off + 14, false);
      chipAddrs.push(`$${loadAddr.toString(16).toUpperCase()}+${romSize >> 10}K`);
      totalRomBytes += romSize;
      chipCount++;
      off += pktLen;
      if (chipCount > 64) break;
    }

    // If the actual ROM content differs from what EXROM/GAME flags imply, note it.
    // e.g. "16K (ROML+ROMH) flags, actual: $8000+8K" makes the mismatch visible.
    const actualDesc = chipAddrs.length > 0
      ? `${totalRomBytes >> 10}K actual (${chipAddrs.join(', ')})`
      : 'no CHIP data';
    const mapDesc = `${flagMap} flags, ${actualDesc}`;

    return `hwType=${hwType}(${hwName}) | ${mapDesc} | ${chipCount} CHIP(s) | ${data.length} bytes`;
  }

  loadGame(options: GameLoadOptions): void {
    const x = this.wasm.exports;
    if (!x || !this.wasm.heap) throw new Error('WASM not ready');

    if (options.type === 'crt') {
      // Log CRT header characteristics before anything touches WASM state
      const crtDesc = C64Emulator.describeCrt(options.data);
      if (crtDesc) console.log(`[C64 cart] loading: ${crtDesc}`);

      // Mirror the headless cart-load sequence exactly:
      //   removeCartridge → reset → allocAndWrite → loadCartridge
      // This is safe on a fresh emulator (removeCartridge is a no-op when
      // nothing is mounted) and correct for hot-swaps.
      x.c64_removeCartridge();
      x.c64_reset();
      // Use c64_cpuWrite (not c64_ramWrite) to go through the 6510 CPU port
      // mechanism — this updates the WASM's internal banking registers.
      x.c64_cpuWrite(1, 0x37);
      // Ensure the debugger is playing before the cart load.
      // preserves the current paused/running state and c64_loadCartridge()
      // does NOT internally call debugger_play().  Without this, simple 8K
      // normal cartridges (EXROM=0, GAME=1) load but execute zero CPU cycles.
      x.debugger_play();
      this.frameCount = 0;
    }

    const ptr = this.wasm.allocAndWrite(options.data);

    if (options.type === 'crt') {
      // c64_loadCartridge resets and resumes the machine internally, so:
      //   - free(ptr) is intentionally omitted — the WASM loader may retain
      //     the pointer during bank parsing; freeing it immediately corrupts
      //     the cartridge data (headless CLI has the same comment).
      //   - No c64_reset() / debugger_play() after — loadCartridge handles it.
      // Flush any stdout noise accumulated during init/reset before loading,
      // so consumeCartLineCount() after the call only counts cart-load output.
      this.wasm.consumeCartLineCount();
      x.c64_loadCartridge(ptr, options.data.length);

      // ── Silent-failure detection (two independent heuristics) ──────────────
      //
      // The WASM c64_loadCartridge() returns void with no error code.  When a
      // CRT format is not recognised the loader exits silently without printing
      // anything and without starting the machine.  We use two signals to detect
      // this and surface a warning to the console:
      //
      // 1. Cart-line counter: the C core always emits at least one printf line
      //    (e.g. "normal cartridge") when it successfully identifies the CRT
      //    format.  C64WASM.consumeCartLineCount() returns the number of such
      //    lines flushed during this call.  Zero = format not recognised.
      //
      // 2. debugger_isRunning(): a successful load leaves the machine running.
      //    If the debugger is still paused after loadCartridge, nothing started.
      //
      // Both checks are heuristic — they can in theory fire on edge cases — but
      // in practice they reliably distinguish a recognised load from a silent
      // no-op.  Neither throws; the warning is purely diagnostic.
      const cartLines = this.wasm.consumeCartLineCount();
      const isRunning = (x as unknown as { debugger_isRunning?: () => number })
        .debugger_isRunning?.() ?? 1; // default 1 (assume ok) if export absent

      if (cartLines === 0) {
        const msg = 'CRT format may not be recognised by this emulator build.';
        console.warn('[C64 cart] WARNING: no cartridge-type output from WASM during load — ' + msg);
        C64Emulator.dispatchCartLoadFailed(msg);
      } else if (!isRunning) {
        const msg = 'Cartridge was parsed but the machine did not start.';
        console.warn(
          '[C64 cart] WARNING: debugger_isRunning() returned 0 after c64_loadCartridge — ' + msg,
        );
        C64Emulator.dispatchCartLoadFailed(msg);
      } else {
        // Third heuristic: run 60 frames and count how many distinct PC values
        // appear.  A legitimately running machine (even one in a KERNAL wait-loop
        // during cart boot) visits at least 2 addresses per frame.  A truly broken
        // machine (e.g. plain 8K normal cart with KERNAL banked out) stays pinned
        // at a single address for all 60 frames: uniquePCs === 1.
        //
        // 3-frame pc0===pc1 was too narrow and fired a false-positive on Magic Desk
        // carts that sit in the KERNAL delay loop ($E9E5/$E9E6) for ~40 frames
        // before jumping to the game.
        const getPC = (x as unknown as { c64_getPC?: () => number }).c64_getPC;
        if (getPC) {
          const pcSet = new Set<number>();
          for (let i = 0; i < 60; i++) {
            x.debugger_update(20);
            pcSet.add(getPC());
          }
          // The 60-frame probe loop accumulates ~54 000 SID samples (60 × 20 ms ×
          // ~45 samples/ms at 44 100 Hz) without ever calling sid_getAudioBuffer().
          // The SID's internal write counter wraps ~13× past the 4096-sample buffer
          // boundary.  If left unserviced, the next call from the audio worklet
          // supplies an out-of-bounds pointer → WASM trap.
          // Drain once here to reset the write counter regardless of probe outcome.
          x.sid_getAudioBuffer();
          if (pcSet.size === 1) {
            const stuckPc = '0x' + [...pcSet][0].toString(16).toUpperCase();
            const msg =
              `CPU stuck at ${stuckPc} for 60 frames — ` +
              'this cart type may have a memory banking incompatibility with this emulator build.';
            console.warn('[C64 cart] WARNING: ' + msg);
            C64Emulator.dispatchCartLoadFailed(msg);
          } else {
            console.log(`[C64 cart] load OK — ${cartLines} diagnostic line(s), ${pcSet.size} unique PCs over 60 frames`);
          }
        } else {
          console.log(`[C64 cart] load OK — ${cartLines} diagnostic line(s), machine is running`);
        }
      }

      return;
    }

    try {
      switch (options.type) {
        case 'prg':
          x.c64_loadPRG(ptr, options.data.length);
          break;
        case 'd64':
          x.c64_insertDisk(ptr, options.data.length);
          break;
        case 'snapshot':
          x.c64_loadSnapshot(ptr, options.data.length);
          break;
      }
    } finally {
      this.wasm.free(ptr);
    }
  }

  removeCartridge(): void {
    // Only detach — do NOT reset here. Callers that want a reset after detach
    // (e.g. "Detach Cartridge" button) should call reset() explicitly via
    // C64Player.detachCartridge(). Keeping detach and reset separate means
    // loadGame()'s own pre-flight reset isn't duplicated on hot-swap loads.
    this.wasm.exports?.c64_removeCartridge();
  }

  /**
   * Dispatch a browser CustomEvent so the UI layer can react to a failed CRT
   * load without coupling the emulator to any specific UI framework.
   * Safe to call in non-browser environments (Node / tests) — `window` is
   * guarded so it never throws.
   */
  private static dispatchCartLoadFailed(reason: string): void {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('c64-cart-load-failed', { detail: { reason } }),
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------

  handleInput(event: InputEvent): void {
    const x = this.wasm.exports;
    if (!x) return;

    if (event.type === 'key' && event.key !== undefined) {
      x.keyboard_keyPressed(Number(event.key));
    } else if (event.type === 'joystick') {
      const port = (event.joystickPort ?? 1) - 1; // callers use 1/2, WASM uses 0/1
      const dirMap: Record<string, number> = { up: 1, down: 2, left: 4, right: 8 };
      if (event.direction) x.c64_joystick_push(port, dirMap[event.direction] ?? 0);
      if (event.fire1) x.c64_joystick_push(port, 16);
    }
  }

  keyDown(keyCode: number): void {
    this.wasm.exports?.keyboard_keyPressed(keyCode);
  }
  keyUp(keyCode: number): void {
    this.wasm.exports?.keyboard_keyReleased(keyCode);
  }

  /**
   * Push (press) a joystick direction or fire button.
   *
   * @param port - 1-based joystick port: `1` = port 1, `2` = port 2
   * @param dir  - Bitmask value for the direction or fire button:
   *   - `0x01` — Up    (`JOYSTICK_DIRECTION.UP`)
   *   - `0x02` — Down  (`JOYSTICK_DIRECTION.DOWN`)
   *   - `0x04` — Left  (`JOYSTICK_DIRECTION.LEFT`)
   *   - `0x08` — Right (`JOYSTICK_DIRECTION.RIGHT`)
   *   - `0x10` — Fire  (`JOYSTICK_FIRE_1`)
   *
   * @example
   * emulator.joystickPush(2, JOYSTICK_DIRECTION.UP);    // port 2 up
   * emulator.joystickPush(2, JOYSTICK_FIRE_1);           // port 2 fire
   */
  joystickPush(port: JoystickPort, dir: JoystickInput): void {
    this.wasm.exports?.c64_joystick_push(port - 1, dir);
  }

  /**
   * Release a joystick direction or fire button.
   *
   * @param port - 1-based joystick port: `1` = port 1, `2` = port 2
   * @param dir  - Bitmask value to release (same values as {@link joystickPush})
   *
   * @example
   * emulator.joystickRelease(2, JOYSTICK_DIRECTION.UP);  // release port 2 up
   */
  joystickRelease(port: JoystickPort, dir: JoystickInput): void {
    this.wasm.exports?.c64_joystick_release(port - 1, dir);
  }
  mousePosition(x: number, y: number): void {
    this.wasm.exports?.c64_mouse_position(x, y);
  }

  // ---------------------------------------------------------------------------
  // Memory access
  // ---------------------------------------------------------------------------

  ramRead(addr: number): number {
    return this.wasm.exports?.c64_ramRead(addr) ?? 0;
  }
  ramWrite(addr: number, v: number): void {
    this.wasm.exports?.c64_ramWrite(addr, v);
  }
  cpuRead(addr: number): number {
    return this.wasm.exports?.c64_cpuRead(addr) ?? 0;
  }
  cpuWrite(addr: number, v: number): void {
    this.wasm.exports?.c64_cpuWrite(addr, v);
  }

  // ---------------------------------------------------------------------------
  // CPU state
  // ---------------------------------------------------------------------------

  getPC(): number {
    return this.wasm.exports?.c64_getPC() ?? 0;
  }
  getRegA(): number {
    return this.wasm.exports?.c64_getRegA() ?? 0;
  }
  getRegX(): number {
    return this.wasm.exports?.c64_getRegX() ?? 0;
  }
  getRegY(): number {
    return this.wasm.exports?.c64_getRegY() ?? 0;
  }
  getSP(): number {
    return this.wasm.exports?.c64_getSP() ?? 0;
  }
  getCycleCount(): number {
    return this.wasm.exports?.c64_getCycleCount() ?? 0;
  }

  // ---------------------------------------------------------------------------
  // Video
  // ---------------------------------------------------------------------------

  getFrameBuffer(): FrameBuffer {
    if (!this.wasm.exports || !this.wasm.heap) throw new Error('WASM not ready');
    const ptr = this.wasm.exports.c64_getPixelBuffer();
    const data = this.wasm.heap.heapU8.slice(ptr, ptr + FRAME_WIDTH * FRAME_HEIGHT * 4);
    return { width: FRAME_WIDTH, height: FRAME_HEIGHT, data, timestamp: this.frameCount };
  }

  // ---------------------------------------------------------------------------
  // Snapshot
  // ---------------------------------------------------------------------------

  getSnapshot(): Uint8Array {
    const x = this.wasm.exports;
    if (!x || !this.wasm.heap) throw new Error('WASM not ready');
    const size = x.c64_getSnapshotSize();
    const ptr = x.malloc(size);
    x.c64_getSnapshot(ptr);
    const snap = this.wasm.heap.heapU8.slice(ptr, ptr + size);
    x.free(ptr);
    return snap;
  }

  // ---------------------------------------------------------------------------
  // Debugger
  // ---------------------------------------------------------------------------

  debuggerPause(): void {
    this.wasm.exports?.debugger_pause();
  }
  debuggerPlay(): void {
    this.wasm.exports?.debugger_play();
  }
  debuggerStep(): void {
    this.wasm.exports?.debugger_step();
  }
  debuggerIsRunning(): boolean {
    return (this.wasm.exports?.debugger_isRunning() ?? 0) !== 0;
  }
  setDebugSpeed(speed: number): void {
    this.wasm.exports?.debugger_set_speed(speed);
  }

  // ---------------------------------------------------------------------------
  // Audio / SID
  // ---------------------------------------------------------------------------

  setSampleRate(rate: number): void {
    this.wasm.exports?.sid_setSampleRate(rate);
  }

  /**
   * Return a snapshot of the SID's circular audio buffer (4096 Float32 samples).
   * This mirrors the original c64.js `audioProcess` which reads
   * `sid_getAudioBuffer()` with a fixed `audioBufferLength` — never calling
   * `sid_dumpBuffer()`.
   */
  getSidBuffer(): Float32Array | null {
    const x = this.wasm.exports;
    if (!x || !this.wasm.heap) return null;
    const ptr = x.sid_getAudioBuffer();
    // Return a copy so the caller owns the data (the SID overwrites this buffer)
    return new Float32Array(
      this.wasm.heap.heapF32.subarray(ptr >> 2, (ptr >> 2) + C64Emulator.AUDIO_BUFFER_SIZE),
    );
  }

  setSIDModel(model: number): void {
    this.wasm.exports?.sid_setModel(model);
  }
  setVoiceEnabled(voice: number, enabled: boolean): void {
    this.wasm.exports?.sid_setVoiceEnabled(enabled ? voice : 0);
  }

  // ---------------------------------------------------------------------------
  // Drive
  // ---------------------------------------------------------------------------

  setDriveEnabled(enabled: boolean): void {
    this.wasm.exports?.c64_setDriveEnabled(enabled ? 1 : 0);
  }
  getDriveEnabled(): boolean {
    return (this.wasm.exports?.c64_getDriveEnabled() ?? 0) !== 0;
  }
}
