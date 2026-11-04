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

    async open(source = "tab") {
      this.fellBackToMicrophone = false;
      if (source !== "tab") return { stream: null, audioTrack: null, fallback: false };
      if (!this.mediaDevices || typeof this.mediaDevices.getDisplayMedia !== "function") {
        this.fellBackToMicrophone = true;
        this.onWarning({ code: "tab-capture-unavailable" });
        return { stream: null, audioTrack: null, fallback: true };
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
      return { stream: null, audioTrack: null, fallback: true };
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
      this.speechProviderFactory = speechProviderFactory || (() => new BrowserSpeechRecognitionProvider({
        recognitionFactory, schedule, cancelSchedule
      }));
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
      return this.state === "starting" || this.state === "listening" || this.state === "no-speech";
    }

    _setState(state, details = {}) {
      this.state = state;
      this.onStatus({ state, sourceLang: this.sourceLang, targetLang: this.targetLang, ...details });
    }

    async start({ sourceLang = "ja", targetLang = "pl", audioSource = "tab" } = {}) {
      if (this.isActive) return false;
      this.session += 1;
      const session = this.session;
      this.sourceLang = sourceLang;
      this.targetLang = targetLang;
      this.audioSource = audioSource;
      this.lastFinalText = "";
      this.lastFinalAt = 0;
      const queueEpoch = this.translationQueue.reset();
      this._setState("starting");

      const capture = await this.capture.open(audioSource);
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
            if (this.speechProvider) this.speechProvider.fallbackToMicrophone();
            else this._fallbackToMicrophone(session);
          }
        }, { once: true });
      }

      try {
        this.speechProvider = this.speechProviderFactory();
        const providerStarted = this.speechProvider.start({
          sourceLang,
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
          input: this.fellBackToMicrophone ? "microphone-fallback" : audioSource
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
      if (this.speechProvider) this.speechProvider.stop();
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
    SerialTranslationQueue,
    CaptionOverlayRenderer,
    LiveCaptionEngine
  };
});
