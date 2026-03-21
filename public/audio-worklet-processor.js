/**
 * C64 Audio Worklet Processor
 *
 * Pull-based audio model that mirrors the original ScriptProcessorNode behaviour:
 *
 * 1. The processor runs on the audio thread at the hardware sample rate.
 * 2. When its ring buffer drops below a threshold it posts a 'need-samples'
 *    message to the main thread.
 * 3. The main thread reads the SID circular buffer and posts samples back.
 * 4. The processor writes incoming samples into the ring buffer and outputs
 *    them to the speakers.
 *
 * This keeps all timing locked to the audio hardware clock — no setInterval
 * drift or jitter.
 */
class C64AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    // Ring buffer — large enough to absorb main-thread latency
    this.bufferSize = 32768;
    this.buffer = new Float32Array(this.bufferSize);
    this.writePos = 0;
    this.readPos = 0;
    this.samplesAvailable = 0;

    // How many samples we request per batch (matches original 4096 ScriptProcessor)
    this.chunkSize = 4096;

    // Request when we have less than 2 chunks remaining
    this.lowWaterMark = this.chunkSize * 2;

    // Prevent flooding the main thread with requests
    this.requested = false;

    this.port.onmessage = (e) => {
      const samples = e.data;
      if (!(samples instanceof Float32Array)) return;

      for (let i = 0; i < samples.length; i++) {
        this.buffer[this.writePos] = samples[i];
        this.writePos = (this.writePos + 1) % this.bufferSize;
      }
      this.samplesAvailable = Math.min(
        this.samplesAvailable + samples.length,
        this.bufferSize,
      );
      this.requested = false;
    };
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;

    const channel = output[0];
    for (let i = 0; i < channel.length; i++) {
      if (this.samplesAvailable > 0) {
        channel[i] = this.buffer[this.readPos];
        this.readPos = (this.readPos + 1) % this.bufferSize;
        this.samplesAvailable--;
      } else {
        channel[i] = 0;
      }
    }

    // Copy mono to other channels if present
    for (let ch = 1; ch < output.length; ch++) {
      output[ch].set(channel);
    }

    // Ask the main thread for more samples when running low
    if (this.samplesAvailable < this.lowWaterMark && !this.requested) {
      this.requested = true;
      this.port.postMessage('need-samples');
    }

    return true;
  }
}

registerProcessor('c64-audio-processor', C64AudioProcessor);

