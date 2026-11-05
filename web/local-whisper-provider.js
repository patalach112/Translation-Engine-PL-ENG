/* Browser-local Whisper runtime, PCM capture, chunking, and transcript filtering. */
(function (root, factory) {
  const audioSignal = typeof module === "object" && module.exports
    ? require("./audio-signal-processor.js")
    : root && root.StreamPLAudioSignal;
  const api = factory(audioSignal);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.StreamPLLocalWhisper = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (audioSignal) {
  "use strict";

  if (!audioSignal) throw new Error("Audio signal processor must load before Local Whisper.");
  const { resampleAudioLinear, conditionWhisperAudio } = audioSignal;

  const WHISPER_LANGUAGES = Object.freeze({
    en: "english", pl: "polish", es: "spanish", ja: "japanese", "zh-CN": "chinese",
    de: "german", fr: "french", ar: "arabic", hi: "hindi", pt: "portuguese",
    ru: "russian", bn: "bengali", id: "indonesian", ur: "urdu", tr: "turkish",
    it: "italian", ko: "korean", vi: "vietnamese", fa: "persian", sw: "swahili",
    nl: "dutch", th: "thai", ms: "malay", uk: "ukrainian", ta: "tamil",
    mr: "marathi", pa: "punjabi", tl: "tagalog"
  });

  const MODEL_PIPELINE_CACHE = new Map();
  const TRANSFORMERS_CDN_URL = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2";

  async function loadTransformersRuntime() {
    return import(TRANSFORMERS_CDN_URL);
  }

  async function loadLocalWhisperPipeline({
    modelId = "onnx-community/whisper-base",
    runtimeLoader = loadTransformersRuntime,
    onProgress = () => {}
  } = {}) {
    if (MODEL_PIPELINE_CACHE.has(modelId)) return MODEL_PIPELINE_CACHE.get(modelId);
    const promise = (async () => {
      const runtime = await runtimeLoader();
      if (!runtime || typeof runtime.pipeline !== "function") {
        throw new Error("The local speech model runtime could not be loaded.");
      }
      if (runtime.env) runtime.env.useBrowserCache = true;
      const progress_callback = (event) => onProgress(event || {});
      const hasWebGPU = typeof navigator !== "undefined" && Boolean(navigator.gpu);
      if (hasWebGPU) {
        try {
          return await runtime.pipeline("automatic-speech-recognition", modelId, {
            device: "webgpu", dtype: "q8", progress_callback
          });
        } catch (error) {
          onProgress({ status: "backend-fallback", backend: "wasm", error });
        }
      }
      return runtime.pipeline("automatic-speech-recognition", modelId, {
        device: "wasm", dtype: "q8", progress_callback
      });
    })();
    MODEL_PIPELINE_CACHE.set(modelId, promise);
    try {
      const pipeline = await promise;
      MODEL_PIPELINE_CACHE.set(modelId, pipeline);
      return pipeline;
    } catch (error) {
      MODEL_PIPELINE_CACHE.delete(modelId);
      throw error;
    }
  }

  class TranscriptOverlapFilter {
    constructor({ minOverlap = 6, maxOverlap = 40 } = {}) {
      this.minOverlap = minOverlap;
      this.maxOverlap = maxOverlap;
      this.previous = "";
    }

    reset() { this.previous = ""; }

    push(value) {
      const current = String(value || "").trim();
      if (!current) return "";
      if (!this.previous) { this.previous = current; return current; }
      const normalized = (text) => Array.from(text).map((character, index) => ({
        character: character.toLocaleLowerCase(), end: index + 1
      })).filter((entry) => !/[\s、。，,.!?！？…]/u.test(entry.character));
      const before = normalized(this.previous);
      const after = normalized(current);
      const upperBound = Math.min(this.maxOverlap, before.length, after.length);
      let overlap = 0;
      for (let size = upperBound; size >= this.minOverlap; size -= 1) {
        let equal = true;
        for (let offset = 0; offset < size; offset += 1) {
          if (before[before.length - size + offset].character !== after[offset].character) {
            equal = false;
            break;
          }
        }
        if (equal) { overlap = size; break; }
      }
      const cutAt = overlap ? after[overlap - 1].end : 0;
      const result = current.slice(cutAt).replace(/^[\s、。，,.!?！？…]+/u, "").trim();
      this.previous = current;
      return result;
    }
  }

  class AudioWorkletPcmSource {
    constructor({
      stream,
      onSamples = () => {},
      onError = () => {},
      contextFactory,
      workletUrl
    } = {}) {
      this.stream = stream;
      this.onSamples = onSamples;
      this.onError = onError;
      this.contextFactory = contextFactory || (() => {
        const Ctor = globalThis.AudioContext || globalThis.webkitAudioContext;
        return Ctor ? new Ctor({ latencyHint: "interactive" }) : null;
      });
      this.workletUrl = workletUrl || new URL("./live-audio-worklet.js", document.baseURI).href;
      this.context = null;
      this.source = null;
      this.node = null;
      this.silentGain = null;
      this.sampleRate = 0;
      this.active = false;
    }

    async start() {
      this.context = this.contextFactory();
      if (!this.context || !this.context.audioWorklet) {
        const error = new Error("This browser does not support local audio processing (AudioWorklet).");
        error.code = "audio-worklet-unavailable";
        throw error;
      }
      if (typeof AudioWorkletNode !== "function") {
        const error = new Error("AudioWorkletNode is unavailable in this browser.");
        error.code = "audio-worklet-unavailable";
        throw error;
      }
      await this.context.audioWorklet.addModule(this.workletUrl);
      this.source = this.context.createMediaStreamSource(this.stream);
      this.node = new AudioWorkletNode(this.context, "streampl-pcm-capture", {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1]
      });
      this.node.port.onmessage = (event) => {
        if (this.active && event.data) this.onSamples(event.data);
      };
      this.node.onprocessorerror = (event) => this.onError({ code: "audio-worklet-error", error: event });
      this.silentGain = this.context.createGain();
      this.silentGain.gain.value = 0;
      this.source.connect(this.node);
      this.node.connect(this.silentGain);
      this.silentGain.connect(this.context.destination);
      this.sampleRate = this.context.sampleRate;
      await this.context.resume();
      this.active = true;
      return this.sampleRate;
    }

    async stop() {
      this.active = false;
      if (this.node) {
        this.node.port.onmessage = null;
        this.node.onprocessorerror = null;
        try { this.node.disconnect(); } catch (_error) { /* already disconnected */ }
      }
      if (this.source) { try { this.source.disconnect(); } catch (_error) { /* already disconnected */ } }
      if (this.silentGain) { try { this.silentGain.disconnect(); } catch (_error) { /* already disconnected */ } }
      this.node = null;
      this.source = null;
      this.silentGain = null;
      if (this.context && this.context.state !== "closed") {
        try { await this.context.close(); } catch (_error) { /* context already closed */ }
      }
      this.context = null;
    }
  }

  class LocalWhisperSpeechProvider {
    constructor({
      modelId = "onnx-community/whisper-base",
      pipelineLoader = loadLocalWhisperPipeline,
      runtimeLoader = loadTransformersRuntime,
      audioSourceFactory = (options) => new AudioWorkletPcmSource(options),
      chunkSeconds = 8,
      overlapSeconds = 1.2,
      minChunkSeconds = 3.6,
      endSilenceSeconds = 0.45,
      speechRmsThreshold = 0.0012,
      maxBufferedSeconds = 18
    } = {}) {
      this.modelId = modelId;
      this.pipelineLoader = pipelineLoader;
      this.runtimeLoader = runtimeLoader;
      this.audioSourceFactory = audioSourceFactory;
      this.chunkSeconds = chunkSeconds;
      this.overlapSeconds = overlapSeconds;
      this.minChunkSeconds = minChunkSeconds;
      this.endSilenceSeconds = endSilenceSeconds;
      this.speechRmsThreshold = speechRmsThreshold;
      this.maxBufferedSeconds = maxBufferedSeconds;
      this.session = 0;
      this.active = false;
      this.transcriber = null;
      this.audioSource = null;
      this.callbacks = {};
      this.sourceLang = "ja";
      this.sampleRate = 0;
      this.chunkSamples = 0;
      this.minChunkSamples = 0;
      this.overlapSamples = 0;
      this.endSilenceSamples = 0;
      this.speechSeen = false;
      this.silenceSamples = 0;
      this.blocks = [];
      this.bufferedSamples = 0;
      this.processing = false;
      this.overlapFilter = new TranscriptOverlapFilter();
    }

    async start({ sourceLang = "ja", stream, onState = () => {}, onFinal = () => {}, onError = () => {} } = {}) {
      if (!stream) {
        const error = new Error("Local Whisper needs an audio stream. Allow tab audio or microphone capture.");
        error.code = "audio-capture";
        throw error;
      }
      if (this.active) await this.stop();
      this.session += 1;
      const session = this.session;
      this.active = true;
      this.sourceLang = sourceLang;
      this.callbacks = { onState, onFinal, onError };
      this.blocks = [];
      this.bufferedSamples = 0;
      this.speechSeen = false;
      this.silenceSamples = 0;
      this.processing = false;
      this.overlapFilter.reset();
      try {
        this.audioSource = this.audioSourceFactory({
          stream,
          onSamples: (samples) => this._appendSamples(samples, session),
          onError: (error) => this._fail(error, session)
        });
        this.sampleRate = await this.audioSource.start();
        if (!this.active || session !== this.session) { await this.audioSource.stop(); return false; }
        this.chunkSamples = Math.round(this.sampleRate * this.chunkSeconds);
        this.minChunkSamples = Math.min(this.chunkSamples, Math.round(this.sampleRate * this.minChunkSeconds));
        this.overlapSamples = Math.min(this.chunkSamples - 1, Math.round(this.sampleRate * this.overlapSeconds));
        this.endSilenceSamples = Math.round(this.sampleRate * this.endSilenceSeconds);
        onState("loading-model", { modelId: this.modelId, progress: null });
        const transcriber = await this.pipelineLoader({
          modelId: this.modelId,
          runtimeLoader: this.runtimeLoader,
          onProgress: (progress) => {
            if (this.active && session === this.session) onState("loading-model", { modelId: this.modelId, progress });
          }
        });
        if (!this.active || session !== this.session) return false;
        if (typeof transcriber !== "function") throw new Error("Whisper pipeline did not return a callable transcriber.");
        this.transcriber = transcriber;
        onState("listening", { input: "local-whisper", modelId: this.modelId });
        this._drain(session);
        return true;
      } catch (error) {
        if (this.active && session === this.session) {
          onError({ code: error.code || "local-whisper-failed", error });
          await this.stop();
        }
        return false;
      }
    }

    _appendSamples(value, session) {
      if (!this.active || session !== this.session) return;
      const samples = value instanceof Float32Array ? value : Float32Array.from(value || []);
      if (!samples.length) return;
      let squareSum = 0;
      for (const sample of samples) squareSum += sample * sample;
      const rms = Math.sqrt(squareSum / samples.length);
      if (rms >= this.speechRmsThreshold) {
        this.speechSeen = true;
        this.silenceSamples = 0;
      } else if (this.speechSeen) this.silenceSamples += samples.length;
      this.blocks.push({ samples, offset: 0 });
      this.bufferedSamples += samples.length;
      const maximum = Math.max(this.chunkSamples, Math.round(this.sampleRate * this.maxBufferedSeconds));
      if (this.bufferedSamples > maximum) {
        this._discard(this.bufferedSamples - maximum);
        this.callbacks.onState("transcribing", { input: "local-whisper", backlogTrimmed: true });
      }
      this._drain(session);
    }

    _read(count) {
      const output = new Float32Array(count);
      let written = 0;
      for (const block of this.blocks) {
        if (written >= count) break;
        const available = block.samples.length - block.offset;
        const copyCount = Math.min(available, count - written);
        output.set(block.samples.subarray(block.offset, block.offset + copyCount), written);
        written += copyCount;
      }
      return written === count ? output : output.subarray(0, written);
    }

    _discard(count) {
      let remaining = count;
      while (remaining > 0 && this.blocks.length) {
        const block = this.blocks[0];
        const available = block.samples.length - block.offset;
        const discardCount = Math.min(available, remaining);
        block.offset += discardCount;
        remaining -= discardCount;
        this.bufferedSamples -= discardCount;
        if (block.offset >= block.samples.length) this.blocks.shift();
      }
    }

    async _drain(session) {
      if (!this.active || session !== this.session || !this.transcriber || this.processing || !this.chunkSamples) return;
      const readyAtMaxLength = this.bufferedSamples >= this.chunkSamples;
      const readyAfterSilence = this.speechSeen
        && this.bufferedSamples >= this.minChunkSamples
        && this.silenceSamples >= this.endSilenceSamples;
      if (!readyAtMaxLength && !readyAfterSilence) return;
      const sampleCount = readyAtMaxLength ? this.chunkSamples : this.bufferedSamples;
      const audio = this._read(sampleCount);
      this._discard(Math.max(1, sampleCount - this.overlapSamples));
      const containsSpeech = this.speechSeen;
      this.speechSeen = false;
      this.silenceSamples = 0;
      if (!containsSpeech) {
        this.callbacks.onState("no-speech", { input: "local-whisper", reason: "quiet-window" });
        if (this.bufferedSamples >= this.chunkSamples) this._drain(session);
        return;
      }
      this.processing = true;
      this.callbacks.onState("transcribing", { input: "local-whisper", modelId: this.modelId });
      try {
        const waveform = conditionWhisperAudio(resampleAudioLinear(audio, this.sampleRate, 16000));
        const result = await this.transcriber(waveform, {
          sampling_rate: 16000,
          language: WHISPER_LANGUAGES[this.sourceLang] || this.sourceLang,
          task: "transcribe",
          return_timestamps: true,
          num_beams: 2
        });
        if (!this.active || session !== this.session) return;
        const modelChunks = result && Array.isArray(result.chunks) ? result.chunks : [];
        const raw = Array.isArray(result)
          ? result.map((item) => item.text || "").join(" ")
          : (result && result.text) || modelChunks.map((chunk) => chunk.text || "").join(" ");
        const text = this.overlapFilter.push(raw);
        if (text) this.callbacks.onFinal({
          text,
          sourceLang: this.sourceLang,
          asrProvider: "local-whisper",
          asrSegments: modelChunks.map((chunk) => ({ text: chunk.text || "", timestamp: chunk.timestamp || null }))
        });
      } catch (error) {
        if (this.active && session === this.session) this.callbacks.onError({ code: "local-whisper-inference-failed", error });
      } finally {
        this.processing = false;
        if (this.active && session === this.session) {
          this.callbacks.onState("listening", { input: "local-whisper", modelId: this.modelId });
          if (this.bufferedSamples >= this.chunkSamples) this._drain(session);
        }
      }
    }

    _fail(error, session) {
      if (!this.active || session !== this.session) return;
      this.callbacks.onError(error);
      this.stop();
    }

    async stop() {
      this.active = false;
      this.session += 1;
      this.blocks = [];
      this.bufferedSamples = 0;
      this.processing = false;
      if (this.audioSource) await this.audioSource.stop();
      this.audioSource = null;
      this.transcriber = null;
    }
  }

  return {
    LocalWhisperSpeechProvider,
    TranscriptOverlapFilter,
    AudioWorkletPcmSource,
    loadLocalWhisperPipeline
  };
});
