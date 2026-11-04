/* Buffers mono PCM before posting it to the main thread to reduce message/GC churn. */
class StreamPLPcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.batchSize = Math.max(4096, Math.round(sampleRate * 0.25));
    this.buffer = new Float32Array(this.batchSize);
    this.offset = 0;
  }

  process(inputs, outputs) {
    const channels = inputs[0] || [];
    const frameCount = channels[0]?.length || 0;
    for (let index = 0; index < frameCount; index += 1) {
      let sample = 0;
      for (const channel of channels) sample += channel[index] || 0;
      this.buffer[this.offset] = channels.length ? sample / channels.length : 0;
      this.offset += 1;
      if (this.offset === this.batchSize) {
        const completed = this.buffer;
        this.buffer = new Float32Array(this.batchSize);
        this.offset = 0;
        this.port.postMessage(completed, [completed.buffer]);
      }
    }
    for (const output of outputs) {
      for (const channel of output) channel.fill(0);
    }
    return true;
  }
}

registerProcessor("streampl-pcm-capture", StreamPLPcmCapture);
