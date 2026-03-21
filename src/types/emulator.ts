/**
 * Actual exports from the C64 WASM binary (Emscripten-compiled)
 */
export interface WASMExports {
  memory: WebAssembly.Memory;

  // Init / lifecycle
  __wasm_call_ctors(): void;
  c64_init(): void;
  c64_reset(): void;
  c64_step(): void;
  c64_update(): void;

  // Model
  c64_setModel(model: number): void;
  c64_getModel(): number;

  // Video
  c64_getPixelBuffer(): number;
  c64_setColor(index: number, r: number, g: number, b: number): void;
  c64_getRasterX(): number;
  c64_getRasterY(): number;
  c64_getVicCycle(): number;

  // Audio (SID)
  sid_getAudioBuffer(): number;
  sid_getAudioBufferCh(ch: number): number;
  sid_dumpBuffer(): number;
  sid_readNS(val: number): number;
  sid_setSampleRate(rate: number): number;
  sid_setModel(model: number): void;
  sid_setVoiceEnabled(voice: number): number;
  sid_setChannelBuffersEnabled(enabled: number): void;
  sid_getWaveformByte(index: number): number;

  // Keyboard
  keyboard_keyPressed(key: number): void;
  keyboard_keyReleased(key: number): void;

  // Joystick
  c64_joystick_push(port: number, dir: number): void;
  c64_joystick_release(port: number, dir: number): void;

  // Mouse
  c64_mouse_position(x: number, y: number): void;
  c64_set_mouse_port_enabled(port: number, enabled: number): void;

  // Drive / disk
  c64_getDriveEnabled(): number;
  c64_setDriveEnabled(enabled: number): void;
  c64_insertDisk(ptr: number, len: number): void;

  // Loading
  c64_loadPRG(ptr: number, len: number): void;
  c64_loadCartridge(ptr: number, len: number): void;
  c64_removeCartridge(): void;

  // Snapshot
  c64_getSnapshotSize(): number;
  c64_getSnapshot(ptr: number): void;
  c64_loadSnapshot(ptr: number, len: number): void;

  // Data
  c64_getData(): number;
  c64_getDataLength(): number;

  // Memory access
  c64_ramRead(addr: number): number;
  c64_ramWrite(addr: number, value: number): void;
  c64_cpuRead(addr: number): number;
  c64_cpuReadNS(addr: number): number;
  c64_cpuWrite(addr: number, value: number): void;

  // CPU registers
  c64_getPC(): number;
  c64_getRegX(): number;
  c64_getRegY(): number;
  c64_getRegA(): number;
  c64_getSP(): number;
  c64_setPC(v: number): void;
  c64_setRegX(v: number): void;
  c64_setRegY(v: number): void;
  c64_setRegA(v: number): void;
  c64_getCycleCount(): number;

  // CPU flags
  c64_getFlagN(): number;
  c64_setFlagN(v: number): void;
  c64_getFlagC(): number;
  c64_setFlagC(v: number): void;
  c64_getFlagD(): number;
  c64_setFlagD(v: number): void;
  c64_getFlagZ(): number;
  c64_setFlagZ(v: number): void;
  c64_getFlagV(): number;
  c64_setFlagV(v: number): void;
  c64_getFlagI(): number;
  c64_setFlagI(v: number): void;
  c64_getFlagU(): number;
  c64_setFlagU(v: number): void;
  c64_getFlagB(): number;
  c64_setFlagB(v: number): void;

  // VIC
  c64_vicRead(addr: number): number;
  c64_vicReadRegister(reg: number): number;
  c64_vicReadAbsolute(addr: number): number;
  vic_getRegisterAt(reg: number): number;
  vic_readNS(): number;

  // CIA
  cia1_getRegisterAt(reg: number): number;
  cia1_readNS(): number;
  cia2_getRegisterAt(reg: number): number;
  cia2_readNS(): number;

  // C1541 drive
  c1541_getStatus(): number;
  c1541_cpuRead(addr: number): number;
  c1541_getPC(): number;
  c1541_getRegX(): number;
  c1541_getRegY(): number;
  c1541_getRegA(): number;
  c1541_getSP(): number;
  c1541_getFlagN(): number;
  c1541_getFlagC(): number;
  c1541_getFlagD(): number;
  c1541_getFlagZ(): number;
  c1541_getFlagV(): number;
  c1541_getFlagI(): number;
  c1541_getFlagU(): number;
  c1541_getFlagB(): number;
  c1541_getPosition(): number;

  // Debugger
  debugger_set_inspect_at(addr: number, val: number): void;
  debugger_set_speed(speed: number): void;
  debugger_get_speed(): number;
  debugger_get_sprite_pointer(n: number): number;
  debugger_pause(): void;
  debugger_play(): void;
  debugger_isRunning(): number;
  debugger_step(): void;
  debugger_update(dTime: number): number;

  // Breakpoints
  breakpoints_pcClearAll(): void;
  breakpoints_pcAdd(pc: number): void;
  breakpoint_pcSetEnabled(pc: number, enabled: number): void;
  breakpoint_pcRemove(pc: number): void;
  breakpoints_memoryAdd(addr: number, rw: number, val: number): void;
  breakpoint_memorySetEnabled(addr: number, a: number, b: number, enabled: number): void;
  breakpoint_memoryRemove(addr: number, a: number, b: number): void;
  breakpoints_rasterYAdd(y: number): void;
  breakpoint_rasterYSetEnabled(y: number, enabled: number): void;
  breakpoint_rasterYRemove(y: number): void;

  // Heap / stack (Emscripten internals)
  malloc(size: number): number;
  free(ptr: number): void;
  stackSave(): number;
  stackAlloc(size: number): number;
  stackRestore(ptr: number): void;
  setThrew(threw: number, value: number): void;
  __growWasmMemory(pages: number): number;
  __errno_location(): number;
}
