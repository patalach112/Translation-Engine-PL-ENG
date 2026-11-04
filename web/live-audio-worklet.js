/* Sends mono PCM frames to the main-thread ASR provider. No audio is played back. */
class StreamPLPcmCapture extends AudioWorkletProcessor {
  process(inputs, outputs) {
    const channels = inputs[0] || [];
    const frameCount = channels[0]?.length || 0;
    if (frameCount) {
      const mono = new Float32Array(frameCount);
      for (const channel of channels) {
        for (let index = 0; index < frameCount; index += 1) mono[index] += channel[index] / channels.length;
      }
      this.port.postMessage(mono, [mono.buffer]);
    }
    for (const output of outputs) {
      for (const channel of output) channel.fill(0);
    }
    return true;
  }
}

registerProcessor("streampl-pcm-capture", StreamPLPcmCapture);
