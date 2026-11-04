/*
 * StreamPL live speech pipeline (dependency-free ES6).
 *
 * Layers are intentionally replaceable:
 *   AudioCaptureAdapter              obtains shared-tab audio or selects mic fallback
 *   BrowserSpeechRecognitionProvider adapts Web Speech events to typed callbacks
 *   SerialTranslationQueue            preserves cue order and cancels stale results
 *   LiveCaptionEngine                 owns the session/state machine
 *   CaptionOverlayRenderer            renders translated cues without app coupling
 *
 * This is our pipeline/orchestration code, not a trained acoustic model. The
 * default ASR adapter delegates decoding to the browser's Web Speech service.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.LiveCaptionEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SPEECH_LOCALES = Object.freeze({
    en: "en-US", pl: "pl-PL", es: "es-ES", ja: "ja-JP", "zh-CN": "zh-CN",
    de: "de-DE", fr: "fr-FR", ar: "ar-SA", hi: "hi-IN", pt: "pt-BR",
    ru: "ru-RU", bn: "bn-BD", id: "id-ID", ur: "ur-PK", tr: "tr-TR",
    it: "it-IT", ko: "ko-KR", vi: "vi-VN", fa: "fa-IR", sw: "sw-KE",
    nl: "nl-NL", th: "th-TH", ms: "ms-MY", uk: "uk-UA", ta: "ta-IN",
    mr: "mr-IN", pa: "pa-IN", tl: "fil-PH"
  });

  function createBrowserRecognitionFactory(windowRef) {
    const scope = windowRef || (typeof window !== "undefined" ? window : null);
    return () => {
      const Recognition = scope && (scope.SpeechRecognition || scope.webkitSpeechRecognition);
      if (!Recognition) {
        const error = new Error("Speech recognition is unavailable in this browser.");
        error.code = "recognition-unavailable";
        throw error;
      }
      return new Recognition();
    };
  }

  class AudioCaptureAdapter {
    constructor(mediaDevices, { onWarning = () => {} } = {}) {
      this.mediaDevices = mediaDevices || null;
      this.onWarning = onWarning;
      this.stream = null;
      this.audioTrack = null;
      this.fellBackToMicrophone = false;
    }

    async open(source = "tab", { captureMicrophone = false } = {}) {
      this.fellBackToMicrophone = false;
      if (source === "microphone") {
        if (!captureMicrophone) return { stream: null, audioTrack: null, fallback: false };
        return this._openMicrophone(false);
      }
      if (!this.mediaDevices || typeof this.mediaDevices.getDisplayMedia !== "function") {
        this.fellBackToMicrophone = true;
        this.onWarning({ code: "tab-capture-unavailable" });
        return captureMicrophone ? this._openMicrophone(true) : { stream: null, audioTrack: null, fallback: true };
      }
      try {
        this.stream = await this.mediaDevices.getDisplayMedia({ video: { frameRate: 1 }, audio: true });
        this.audioTrack = this.stream.getAudioTracks()[0] || null;
        if (this.audioTrack) return { stream: this.stream, audioTrack: this.audioTrack, fallback: false };
        this.close();
        this.fellBackToMicrophone = true;
        this.onWarning({ code: "tab-audio-not-shared" });
      } catch (error) {
        this.close();
        this.fellBackToMicrophone = true;
        this.onWarning({ code: "tab-capture-failed", error });
      }
      return captureMicrophone ? this._openMicrophone(true) : { stream: null, audioTrack: null, fallback: true };
    }

    async _openMicrophone(fallback) {
      if (!this.mediaDevices || typeof this.mediaDevices.getUserMedia !== "function") {
        const error = new Error("Microphone capture is unavailable in this browser.");
        error.code = "audio-capture";
        throw error;
      }
      this.stream = await this.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        video: false
      });
      this.audioTrack = this.stream.getAudioTracks()[0] || null;
      if (!this.audioTrack) {
        this.close();
        const error = new Error("Microphone stream contains no audio track.");
        error.code = "audio-capture";
        throw error;
      }
      this.fellBackToMicrophone = fallback;
      return { stream: this.stream, audioTrack: this.audioTrack, fallback };
    }

    close() {
      if (this.stream) {
        for (const track of this.stream.getTracks()) {
          try { track.stop(); } catch (_error) { /* already stopped */ }
        }
      }
      this.stream = null;
      this.audioTrack = null;
    }
  }

  class BrowserSpeechRecognitionProvider {
    constructor({
      recognitionFactory = createBrowserRecognitionFactory(),
      schedule = (fn, ms) => setTimeout(fn, ms),
      cancelSchedule = (id) => clearTimeout(id),
      maxRestartDelay = 2000
    } = {}) {
      this.recognitionFactory = recognitionFactory;
      this.schedule = schedule;
      this.cancelSchedule = cancelSchedule;
      this.maxRestartDelay = maxRestartDelay;
      this.recognition = null;
      this.active = false;
      this.session = 0;
      this.audioTrack = null;
      this.restartTimer = null;
      this.restartDelay = 250;
      this.callbacks = {};
      this.sourceLang = "ja";
    }

    start({ sourceLang = "ja", audioTrack = null, ...callbacks } = {}) {
      if (this.active) this.stop();
      this.session += 1;
      const session = this.session;
      this.active = true;
      this.sourceLang = sourceLang;
      this.audioTrack = audioTrack;
      this.callbacks = callbacks;
      this.restartDelay = 250;
      try {
        this.recognition = this.recognitionFactory();
      } catch (error) {
        this.active = false;
        throw error;
      }
      this.recognition.lang = SPEECH_LOCALES[sourceLang] || sourceLang;
      this.recognition.continuous = true;
      this.recognition.interimResults = true;
      this.recognition.maxAlternatives = 1;
      this.recognition.onstart = () => {
        if (!this._isCurrent(session)) return;
        this.restartDelay = 250;
        this.callbacks.onState?.("listening", { input: this.audioTrack ? "tab" : "microphone" });
      };
      this.recognition.onresult = (event) => this._handleResults(event, session);
      this.recognition.onerror = (event) => this._handleError(event, session);
      this.recognition.onend = () => this._scheduleRestart(session);
      return this._startRecognition(session);
    }

    _isCurrent(session) {
      return this.active && session === this.session;
    }

    _startRecognition(session) {
      if (!this._isCurrent(session) || !this.recognition) return;
      try {
        if (this.audioTrack) this.recognition.start(this.audioTrack);
        else this.recognition.start();
        return true;
      } catch (error) {
        if (this.audioTrack) {
          this._switchToMicrophone({ error, session });
          try {
            if (this._isCurrent(session)) {
              this.recognition.start();
              return true;
            }
          } catch (microphoneError) {
            this._fail({ code: "audio-capture", error: microphoneError }, session);
            return false;
          }
          return false;
        }
        this._fail({ code: "recognition-start-failed", error }, session);
        return false;
      }
    }

    _handleResults(event, session) {
      if (!this._isCurrent(session)) return;
      const interim = [];
      for (let index = event.resultIndex || 0; index < event.results.length; index += 1) {
        const result = event.results[index];
        const text = result && result[0] && String(result[0].transcript || "").trim();
        if (!text) continue;
        if (result.isFinal) this.callbacks.onFinal?.({ text, sourceLang: this.sourceLang });
        else interim.push(text);
      }
      this.callbacks.onInterim?.({ text: interim.join(" "), sourceLang: this.sourceLang });
    }

    _handleError(event, session) {
      if (!this._isCurrent(session)) return;
      const code = event && event.error ? event.error : "unknown";
      if (code === "aborted") return;
      if (code === "no-speech") {
        this.callbacks.onState?.("no-speech", { input: this.audioTrack ? "tab" : "microphone" });
        return;
      }
      if (code === "audio-capture" && this.audioTrack) {
        this._switchToMicrophone({ error: event, session });
        return;
      }
      this._fail({ code, error: event }, session);
    }

    _switchToMicrophone({ error, session }) {
      if (!this._isCurrent(session) || !this.audioTrack) return false;
      this.audioTrack = null;
      this.callbacks.onMicFallback?.({ error });
      return true;
    }

    fallbackToMicrophone() {
      if (!this.active || !this.audioTrack) return false;
      const session = this.session;
      if (!this._switchToMicrophone({ session })) return false;
      try { this.recognition?.stop(); } catch (_error) { /* let restart/backoff recover */ }
      this._scheduleRestart(session);
      return true;
    }

    _scheduleRestart(session) {
      if (!this._isCurrent(session) || this.restartTimer !== null) return;
      const delay = this.restartDelay;
      this.restartDelay = Math.min(this.maxRestartDelay, Math.round(this.restartDelay * 1.6));
      this.restartTimer = this.schedule(() => {
        this.restartTimer = null;
        this._startRecognition(session);
      }, delay);
    }

    _fail(details, session) {
      if (!this._isCurrent(session)) return;
      this.callbacks.onError?.(details);
      this.stop();
    }

    stop() {
      this.active = false;
      this.session += 1;
      if (this.restartTimer !== null) {
        this.cancelSchedule(this.restartTimer);
        this.restartTimer = null;
      }
      const recognition = this.recognition;
      this.recognition = null;
      this.audioTrack = null;
      if (recognition) {
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
        recognition.onstart = null;
        try { recognition.stop(); } catch (_error) { /* already stopped */ }
      }
    }
  }

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
      maxBufferedSeconds = 18
    } = {}) {
      this.modelId = modelId;
      this.pipelineLoader = pipelineLoader;
      this.runtimeLoader = runtimeLoader;
      this.audioSourceFactory = audioSourceFactory;
      this.chunkSeconds = chunkSeconds;
      this.overlapSeconds = overlapSeconds;
      this.maxBufferedSeconds = maxBufferedSeconds;
      this.session = 0;
      this.active = false;
      this.transcriber = null;
      this.audioSource = null;
      this.callbacks = {};
      this.sourceLang = "ja";
      this.sampleRate = 0;
      this.chunkSamples = 0;
      this.overlapSamples = 0;
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
        this.overlapSamples = Math.round(this.sampleRate * this.overlapSeconds);
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
      if (!this.active || session !== this.session || !this.transcriber || this.processing || !this.chunkSamples || this.bufferedSamples < this.chunkSamples) return;
      const audio = this._read(this.chunkSamples);
      this._discard(Math.max(1, this.chunkSamples - this.overlapSamples));
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

  class SerialTranslationQueue {
    constructor({ translate, onCaption, onError, maxPending = 24 }) {
      this.translate = translate;
      this.onCaption = onCaption;
      this.onError = onError;
      this.maxPending = maxPending;
      this.pending = Promise.resolve();
      this.epoch = 0;
      this.queued = 0;
    }

    reset() {
      this.epoch += 1;
      this.queued = 0;
      return this.epoch;
    }

    enqueue(segment, sessionEpoch) {
      if (!segment || !String(segment.text || "").trim()) return;
      if (this.queued >= this.maxPending) {
        this.onError({ code: "translation-queue-full", segment });
        return;
      }
      this.queued += 1;
      this.pending = this.pending.then(async () => {
        if (sessionEpoch !== this.epoch) return;
        try {
          const result = await this.translate(segment);
          if (sessionEpoch !== this.epoch || !result) return;
          this.onCaption({ ...segment, ...result });
        } catch (error) {
          if (sessionEpoch === this.epoch) this.onError({ code: "translation-failed", segment, error });
        } finally {
          this.queued = Math.max(0, this.queued - 1);
        }
      });
    }
  }

  class GlossaryLexicon {
    constructor(entries = []) {
      this.entries = Array.from(entries || [])
        .map((entry) => ({ source: String(entry.source || "").trim(), target: String(entry.target || "").trim() }))
        .filter((entry) => entry.source && entry.target)
        .sort((left, right) => right.source.length - left.source.length)
        .slice(0, 200);
    }

    protect(text) {
      let protectedText = String(text || "");
      const tokens = [];
      this.entries.forEach((entry) => {
        const escaped = entry.source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const expression = new RegExp(escaped, "giu");
        protectedText = protectedText.replace(expression, () => {
          let token = `{SPGLOSSARY${tokens.length}X}`;
          while (protectedText.includes(token)) token = `{S${token.slice(1)}`;
          tokens.push({ token, target: entry.target });
          return token;
        });
      });
      return { text: protectedText, tokens };
    }

    restore(text, protectedState) {
      let output = String(text || "");
      const tokens = Array.isArray(protectedState) ? protectedState : (protectedState && protectedState.tokens) || [];
      for (const entry of tokens) {
        output = output.split(entry.token).join(entry.target);
      }
      return output;
    }
  }

  class CaptionOverlayRenderer {
    constructor({ element, schedule = (fn, ms) => setTimeout(fn, ms), cancelSchedule = (id) => clearTimeout(id) } = {}) {
      this.element = element || null;
      this.schedule = schedule;
      this.cancelSchedule = cancelSchedule;
      this.timer = null;
    }

    show(text, { durationMs } = {}) {
      if (!this.element || !String(text || "").trim()) return false;
      this.clear();
      this.element.textContent = text;
      this.element.hidden = false;
      const duration = durationMs || Math.max(2800, Math.min(6500, String(text).length * 75));
      this.timer = this.schedule(() => {
        this.timer = null;
        if (this.element) this.element.hidden = true;
      }, duration);
      return true;
    }

    clear() {
      if (this.timer !== null) {
        this.cancelSchedule(this.timer);
        this.timer = null;
      }
      if (this.element) this.element.hidden = true;
    }
  }

  class LiveCaptionEngine {
    constructor({
      recognitionFactory = createBrowserRecognitionFactory(),
      speechProviderFactory,
      localWhisperOptions = {},
      mediaDevices = typeof navigator !== "undefined" ? navigator.mediaDevices : null,
      translate = async (segment) => ({ text: segment.text, providerUsed: "identity" }),
      onStatus = () => {},
      onInterim = () => {},
      onCaption = () => {},
      onError = () => {},
      onWarning = () => {},
      schedule = (fn, ms) => setTimeout(fn, ms),
      cancelSchedule = (id) => clearTimeout(id),
      maxPendingTranslations = 24
    } = {}) {
      this.mediaDevices = mediaDevices;
      this.schedule = schedule;
      this.cancelSchedule = cancelSchedule;
      this.onStatus = onStatus;
      this.onInterim = onInterim;
      this.onCaption = onCaption;
      this.onError = onError;
      this.onWarning = onWarning;
      this.capture = new AudioCaptureAdapter(mediaDevices, { onWarning });
      this.speechProviderFactory = speechProviderFactory;
      this.localWhisperOptions = localWhisperOptions;
      this.recognitionFactory = recognitionFactory;
      this.speechProvider = null;
      this.translate = translate;
      this.state = "idle";
      this.session = 0;
      this.sourceLang = "ja";
      this.targetLang = "pl";
      this.audioSource = "tab";
      this.audioTrack = null;
      this.fellBackToMicrophone = false;
      this.lastFinalText = "";
      this.lastFinalAt = 0;
      this.translationQueue = new SerialTranslationQueue({
        translate: (segment) => this.translate(segment),
        onCaption: (caption) => this.onCaption(caption),
        onError: (error) => this.onError(error),
        maxPending: maxPendingTranslations
      });
    }

    get isActive() {
      return ["starting", "loading-model", "listening", "transcribing", "no-speech"].includes(this.state);
    }

    _setState(state, details = {}) {
      this.state = state;
      this.onStatus({ state, sourceLang: this.sourceLang, targetLang: this.targetLang, ...details });
    }

    async start({ sourceLang = "ja", targetLang = "pl", audioSource = "tab", asrProvider = "browser", modelId } = {}) {
      if (this.isActive) return false;
      this.session += 1;
      const session = this.session;
      this.sourceLang = sourceLang;
      this.targetLang = targetLang;
      this.audioSource = audioSource;
      this.asrProvider = asrProvider;
      this.lastFinalText = "";
      this.lastFinalAt = 0;
      const queueEpoch = this.translationQueue.reset();
      this._setState("starting");

      let capture;
      try {
        capture = await this.capture.open(audioSource, { captureMicrophone: asrProvider === "local-whisper" });
      } catch (error) {
        this._fail(session, { code: error.code || "audio-capture-failed", error });
        return false;
      }
      if (session !== this.session) {
        this.capture.close();
        return false;
      }
      this.audioTrack = capture.audioTrack;
      this.fellBackToMicrophone = Boolean(capture.fallback);
      if (this.audioTrack && typeof this.audioTrack.addEventListener === "function") {
        const capturedTrack = this.audioTrack;
        capturedTrack.addEventListener("ended", () => {
          if (session === this.session && this.audioTrack === capturedTrack) {
            if (this.speechProvider && typeof this.speechProvider.fallbackToMicrophone === "function") {
              this.speechProvider.fallbackToMicrophone();
            } else {
              this._fail(session, { code: "audio-capture", error: new Error("Audio capture ended.") });
            }
          }
        }, { once: true });
      }

      try {
        this.speechProvider = this.speechProviderFactory
          ? this.speechProviderFactory(asrProvider)
          : asrProvider === "local-whisper"
            ? new LocalWhisperSpeechProvider({ ...this.localWhisperOptions, ...(modelId ? { modelId } : {}) })
            : new BrowserSpeechRecognitionProvider({ recognitionFactory: this.recognitionFactory, schedule: this.schedule, cancelSchedule: this.cancelSchedule });
        const providerStarted = await this.speechProvider.start({
          sourceLang,
          stream: capture.stream,
          audioTrack: this.audioTrack,
          onState: (state, details) => {
            if (session !== this.session) return;
            this._setState(state, details);
          },
          onInterim: (event) => {
            if (session === this.session) this.onInterim(event);
          },
          onFinal: (segment) => {
            if (session === this.session) this._enqueueFinal(segment, queueEpoch, session);
          },
          onMicFallback: () => {
            if (session === this.session) this._fallbackToMicrophone(session);
          },
          onError: (details) => {
            if (session === this.session) this._fail(session, details);
          }
        });
        if (!providerStarted || session !== this.session) return false;
        this._setState("listening", {
          input: asrProvider === "local-whisper"
            ? (this.fellBackToMicrophone ? "microphone-fallback" : "local-whisper")
            : (this.fellBackToMicrophone ? "microphone-fallback" : audioSource)
        });
        return true;
      } catch (error) {
        this._fail(session, { code: error.code || "recognition-start-failed", error });
        return false;
      }
    }

    _enqueueFinal(segment, queueEpoch, session) {
      const text = String(segment.text || "").trim();
      if (!text || session !== this.session) return;
      const now = Date.now();
      if (text === this.lastFinalText && now - this.lastFinalAt < 1200) return;
      this.lastFinalText = text;
      this.lastFinalAt = now;
      this.translationQueue.enqueue({ ...segment, targetLang: this.targetLang }, queueEpoch);
    }

    _fallbackToMicrophone(session) {
      if (session !== this.session || this.fellBackToMicrophone) return;
      this.fellBackToMicrophone = true;
      this.audioTrack = null;
      this.capture.close();
      this.onWarning({ code: "microphone-fallback" });
      this._setState("listening", { input: "microphone-fallback" });
    }

    _fail(session, details) {
      if (session !== this.session) return;
      this.onError(details);
      this.stop();
      this._setState("error", details);
    }

    stop() {
      this.session += 1;
      this.translationQueue.reset();
      if (this.speechProvider) {
        const stopped = this.speechProvider.stop();
        if (stopped && typeof stopped.catch === "function") stopped.catch(() => {});
      }
      this.speechProvider = null;
      this.capture.close();
      this.audioTrack = null;
      this.fellBackToMicrophone = false;
      this._setState("idle");
    }
  }

  return {
    SPEECH_LOCALES,
    createBrowserRecognitionFactory,
    AudioCaptureAdapter,
    BrowserSpeechRecognitionProvider,
    LocalWhisperSpeechProvider,
    SerialTranslationQueue,
    GlossaryLexicon,
    TranscriptOverlapFilter,
    AudioWorkletPcmSource,
    CaptionOverlayRenderer,
    loadLocalWhisperPipeline,
    resampleAudioLinear,
    conditionWhisperAudio,
    LiveCaptionEngine
  };
});
