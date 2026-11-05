/* Pure, dependency-free PCM preparation for browser speech recognition. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.StreamPLAudioSignal = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function resampleAudioLinear(input, inputRate, outputRate = 16000) {
    if (!(input instanceof Float32Array) || !input.length) return new Float32Array(0);
    if (!inputRate || inputRate === outputRate) return input;
    const outputLength = Math.max(1, Math.floor(input.length * outputRate / inputRate));
    const output = new Float32Array(outputLength);
    const ratio = inputRate / outputRate;
    for (let index = 0; index < outputLength; index += 1) {
      const sourcePosition = index * ratio;
      const left = Math.floor(sourcePosition);
      const right = Math.min(left + 1, input.length - 1);
      const fraction = sourcePosition - left;
      output[index] = input[left] * (1 - fraction) + input[right] * fraction;
    }
    return output;
  }

  function conditionWhisperAudio(input, { targetRms = 0.08, maxGain = 3, maxPeak = 0.95 } = {}) {
    if (!(input instanceof Float32Array) || !input.length) return new Float32Array(0);
    let mean = 0;
    for (const sample of input) mean += Number.isFinite(sample) ? sample : 0;
    mean /= input.length;
    const centered = new Float32Array(input.length);
    let squareSum = 0;
    let peak = 0;
    for (let index = 0; index < input.length; index += 1) {
      const sample = (Number.isFinite(input[index]) ? input[index] : 0) - mean;
      centered[index] = sample;
      squareSum += sample * sample;
      peak = Math.max(peak, Math.abs(sample));
    }
    const rms = Math.sqrt(squareSum / input.length);
    if (rms < 1e-7 || peak < 1e-7) return centered;
    const gain = Math.min(maxGain, targetRms / rms, maxPeak / peak);
    for (let index = 0; index < centered.length; index += 1) centered[index] *= gain;
    return centered;
  }

  return { resampleAudioLinear, conditionWhisperAudio };
});
