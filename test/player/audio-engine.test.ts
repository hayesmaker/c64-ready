import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine } from '../../src/player/audio-engine';

// ---------------------------------------------------------------------------
// Mock Web Audio API — jsdom doesn't provide AudioContext / AudioWorkletNode
// ---------------------------------------------------------------------------

function makeMockAudioContext(initialState: 'running' | 'suspended' = 'running') {
  let state = initialState;
  const stateChangeListeners: (() => void)[] = [];

  const mockPort = {
    postMessage: vi.fn(),
    onmessage: null as ((ev: { data: unknown }) => void) | null,
  };

  const mockWorkletNode = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    port: mockPort,
  };

  const mockGainNode = {
    gain: { value: 1 },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };

  const mockCtx = {
    sampleRate: 48000,
    get state() {
      return state;
    },
    destination: {},
    createGain: vi.fn(() => mockGainNode),
    resume: vi.fn(async () => {
      state = 'running';
      stateChangeListeners.forEach((fn) => fn());
    }),
    close: vi.fn(async () => {}),
    addEventListener: vi.fn((event: string, fn: () => void) => {
      if (event === 'statechange') stateChangeListeners.push(fn);
    }),
    audioWorklet: {
      addModule: vi.fn(async () => {}),
    },
  };

  // Mock the AudioWorkletNode constructor
  const MockAudioWorkletNode = vi.fn(() => mockWorkletNode);

  return {
    mockCtx,
    mockGainNode,
    mockWorkletNode,
    mockPort,
    MockAudioWorkletNode,
    stateChangeListeners,
  };
}

function installMocks(mocks: ReturnType<typeof makeMockAudioContext>) {
  vi.stubGlobal(
    'AudioContext',
    vi.fn(() => mocks.mockCtx),
  );
  vi.stubGlobal('AudioWorkletNode', mocks.MockAudioWorkletNode);
}

describe('AudioEngine', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── init ───────────────────────────────────────────────────────────────

  it('init() returns true when AudioContext starts in running state', async () => {
    const mocks = makeMockAudioContext('running');
    installMocks(mocks);

    const engine = new AudioEngine();
    const result = await engine.init();

    expect(result).toBe(true);
    expect(engine.suspended).toBe(false);
    expect(engine.ready).toBe(true);
  });

  it('init() returns false when AudioContext is suspended (autoplay blocked)', async () => {
    const mocks = makeMockAudioContext('suspended');
    // Override resume to keep state suspended (simulating autoplay block)
    mocks.mockCtx.resume = vi.fn(async () => {
      /* stays suspended */
    });
    installMocks(mocks);

    const engine = new AudioEngine();
    const result = await engine.init();

    expect(result).toBe(false);
    expect(engine.suspended).toBe(true);
  });

  it('init() returns false gracefully when AudioContext is unavailable', async () => {
    // Don't install mocks — no AudioContext in jsdom
    const engine = new AudioEngine();
    const result = await engine.init();

    expect(result).toBe(false);
  });

  it('init() only initialises once (idempotent)', async () => {
    const mocks = makeMockAudioContext('running');
    installMocks(mocks);

    const engine = new AudioEngine();
    await engine.init();
    await engine.init();

    // AudioContext constructor should only be called once
    expect(vi.mocked(AudioContext)).toHaveBeenCalledOnce();
  });

  it('loads the worklet processor module', async () => {
    const mocks = makeMockAudioContext('running');
    installMocks(mocks);

    const engine = new AudioEngine();
    await engine.init();

    expect(mocks.mockCtx.audioWorklet.addModule).toHaveBeenCalledOnce();
    expect(mocks.mockCtx.audioWorklet.addModule).toHaveBeenCalledWith(
      expect.stringContaining('audio-worklet-processor.js'),
    );
  });

  it('connects the audio graph: worklet → gain → destination', async () => {
    const mocks = makeMockAudioContext('running');
    installMocks(mocks);

    const engine = new AudioEngine();
    await engine.init();

    expect(mocks.mockWorkletNode.connect).toHaveBeenCalledWith(mocks.mockGainNode);
    expect(mocks.mockGainNode.connect).toHaveBeenCalledWith(mocks.mockCtx.destination);
  });

  // ── sampleRate ────────────────────────────────────────────────────────

  it('sampleRate returns AudioContext.sampleRate after init', async () => {
    const mocks = makeMockAudioContext('running');
    installMocks(mocks);

    const engine = new AudioEngine();
    expect(engine.sampleRate).toBe(44100); // default before init
    await engine.init();
    expect(engine.sampleRate).toBe(48000); // from mock AudioContext
  });

  // ── resume ────────────────────────────────────────────────────────────

  it('resume() transitions from suspended to running', async () => {
    const mocks = makeMockAudioContext('suspended');
    mocks.mockCtx.resume = vi.fn(async () => {
      /* stays suspended on first call */
    });
    installMocks(mocks);

    const engine = new AudioEngine();
    await engine.init();
    expect(engine.suspended).toBe(true);

    // Now allow resume to succeed
    mocks.mockCtx.resume = vi.fn(async () => {
      // Manually set state to running via the statechange listener path
    });
    // Simulate the AudioContext actually transitioning
    Object.defineProperty(mocks.mockCtx, 'state', { get: () => 'running', configurable: true });
    await engine.resume();

    expect(engine.suspended).toBe(false);
  });

  it('fires onStateChange when init completes', async () => {
    const mocks = makeMockAudioContext('running');
    installMocks(mocks);

    const engine = new AudioEngine();
    const cb = vi.fn();
    engine.onStateChange = cb;

    await engine.init();

    expect(cb).toHaveBeenCalled();
    const state = cb.mock.calls[0][0];
    expect(state).toEqual({ muted: false, volume: 0.75, suspended: false });
  });

  it('fires onStateChange when mute/volume changes', async () => {
    const mocks = makeMockAudioContext('running');
    installMocks(mocks);

    const engine = new AudioEngine();
    const cb = vi.fn();
    engine.onStateChange = cb;
    await engine.init();

    cb.mockClear();
    engine.setMuted(true);
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ muted: true }));

    cb.mockClear();
    engine.setVolume(0.5);
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ volume: 0.5 }));
  });

  it('setVolume clamps to [0, 1]', async () => {
    const mocks = makeMockAudioContext('running');
    installMocks(mocks);

    const engine = new AudioEngine();
    await engine.init();

    engine.setVolume(1.5);
    expect(engine.volume).toBe(1);
    expect(mocks.mockGainNode.gain.value).toBe(1);

    engine.setVolume(-0.5);
    expect(engine.volume).toBe(0);
    expect(mocks.mockGainNode.gain.value).toBe(0);
  });

  it('adjustVolume adds a delta to the current volume', async () => {
    const mocks = makeMockAudioContext('running');
    installMocks(mocks);

    const engine = new AudioEngine();
    await engine.init();

    engine.setVolume(0.5);
    engine.adjustVolume(0.1);
    expect(engine.volume).toBeCloseTo(0.6);

    engine.adjustVolume(-0.3);
    expect(engine.volume).toBeCloseTo(0.3);
  });

  it('setMuted(true) sets gain to 0, setMuted(false) restores volume', async () => {
    const mocks = makeMockAudioContext('running');
    installMocks(mocks);

    const engine = new AudioEngine();
    await engine.init();
    engine.setVolume(0.6);

    engine.setMuted(true);
    expect(engine.muted).toBe(true);
    expect(mocks.mockGainNode.gain.value).toBe(0);

    engine.setMuted(false);
    expect(engine.muted).toBe(false);
    expect(mocks.mockGainNode.gain.value).toBe(0.6);
  });

  it('toggleMute flips the muted state', async () => {
    const mocks = makeMockAudioContext('running');
    installMocks(mocks);

    const engine = new AudioEngine();
    await engine.init();

    expect(engine.muted).toBe(false);
    engine.toggleMute();
    expect(engine.muted).toBe(true);
    engine.toggleMute();
    expect(engine.muted).toBe(false);
  });

  it('setSidBufferReader registers a reader', async () => {
    const mocks = makeMockAudioContext('running');
    installMocks(mocks);

    const engine = new AudioEngine();
    await engine.init();

    const reader = vi.fn(() => new Float32Array(4096));
    engine.setSidBufferReader(reader);

    // Simulate the worklet requesting samples
    mocks.mockPort.onmessage?.({ data: 'need-samples' });

    expect(reader).toHaveBeenCalledOnce();
    expect(mocks.mockPort.postMessage).toHaveBeenCalled();
    const posted = mocks.mockPort.postMessage.mock.calls[0][0];
    expect(posted).toBeInstanceOf(Float32Array);
    expect(posted.length).toBe(4096);
  });

  it('does not feed worklet when suspended', async () => {
    const mocks = makeMockAudioContext('suspended');
    mocks.mockCtx.resume = vi.fn(async () => {});
    installMocks(mocks);

    const engine = new AudioEngine();
    await engine.init();

    const reader = vi.fn(() => new Float32Array(4096));
    engine.setSidBufferReader(reader);

    // Simulate pull request while suspended
    mocks.mockPort.onmessage?.({ data: 'need-samples' });

    expect(reader).not.toHaveBeenCalled();
  });

  it('does not feed worklet when no reader is registered', async () => {
    const mocks = makeMockAudioContext('running');
    installMocks(mocks);

    const engine = new AudioEngine();
    await engine.init();

    // Simulate pull request with no reader
    mocks.mockPort.onmessage?.({ data: 'need-samples' });

    // Only the connect call from init, no postMessage for samples
    expect(mocks.mockPort.postMessage).not.toHaveBeenCalled();
  });

  it('ignores reader returning null', async () => {
    const mocks = makeMockAudioContext('running');
    installMocks(mocks);

    const engine = new AudioEngine();
    await engine.init();

    engine.setSidBufferReader(() => null);

    mocks.mockPort.onmessage?.({ data: 'need-samples' });
    expect(mocks.mockPort.postMessage).not.toHaveBeenCalled();
  });

  it('destroy disconnects nodes and closes context', async () => {
    const mocks = makeMockAudioContext('running');
    installMocks(mocks);

    const engine = new AudioEngine();
    await engine.init();

    await engine.destroy();

    expect(mocks.mockWorkletNode.disconnect).toHaveBeenCalled();
    expect(mocks.mockGainNode.disconnect).toHaveBeenCalled();
    expect(mocks.mockCtx.close).toHaveBeenCalled();
    expect(engine.ready).toBe(false);
    expect(engine.suspended).toBe(true);
  });
});

