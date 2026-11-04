/*
 * StreamPL live speech pipeline.
 *
 * Owns capture lifecycle, recognition restarts, transcript ordering, cancellation,
 * and fallback policy. The ASR provider is intentionally injected: the default
 * browser adapter uses Web Speech Recognition; replacing it does not affect the
 * translation queue, caption renderer, or UI.
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

  class LiveCaptionEngine {
    constructor({
      recognitionFactory = createBrowserRecognitionFactory(),
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
      this.recognitionFactory = recognitionFactory;
      this.capture = new AudioCaptureAdapter(mediaDevices, { onWarning });
      this.translate = translate;
      this.onStatus = onStatus;
      this.onInterim = onInterim;
      this.onCaption = onCaption;
      this.onError = onError;
      this.onWarning = onWarning;
      this.schedule = schedule;
      this.cancelSchedule = cancelSchedule;
      this.state = "idle";
      this.session = 0;
      this.recognition = null;
      this.audioTrack = null;
      this.restartTimer = null;
      this.restartDelay = 250;
      this.sourceLang = "ja";
      this.targetLang = "pl";
      this.audioSource = "tab";
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
      this.restartDelay = 250;
      this.lastFinalText = "";
      this.lastFinalAt = 0;
      const queueEpoch = this.translationQueue.reset();
      this._setState("starting");

      let capture;
      try {
        capture = await this.capture.open(audioSource);
      } catch (error) {
        this._fail(session, { code: "audio-capture-failed", error });
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
            this._fallbackToMicrophone(session);
          }
        }, { once: true });
      }

      try {
        this.recognition = this.recognitionFactory();
      } catch (error) {
        this.capture.close();
        this._fail(session, { code: error.code || "recognition-unavailable", error });
        return false;
      }
      this._configureRecognition(this.recognition, session, queueEpoch);
      this._setState("listening", {
        input: this.fellBackToMicrophone ? "microphone-fallback" : audioSource
      });
      this._startRecognition(session);
      return true;
    }

    _configureRecognition(recognition, session, queueEpoch) {
      recognition.lang = SPEECH_LOCALES[this.sourceLang] || this.sourceLang;
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;
      recognition.onstart = () => {
        if (session !== this.session || !this.isActive) return;
        this.restartDelay = 250;
        this._setState("listening", {
          input: this.fellBackToMicrophone ? "microphone-fallback" : this.audioSource
        });
      };
      recognition.onresult = (event) => this._consumeResults(event, session, queueEpoch);
      recognition.onerror = (event) => this._consumeError(event, session);
      recognition.onend = () => this._scheduleRestart(session);
    }

    _consumeResults(event, session, queueEpoch) {
      if (session !== this.session || !this.isActive) return;
      const interim = [];
      for (let index = event.resultIndex || 0; index < event.results.length; index += 1) {
        const result = event.results[index];
        const text = result && result[0] && String(result[0].transcript || "").trim();
        if (!text) continue;
        if (!result.isFinal) {
          interim.push(text);
          continue;
        }
        this.onInterim({ text, final: true, sourceLang: this.sourceLang });
        const now = Date.now();
        if (text === this.lastFinalText && now - this.lastFinalAt < 1200) continue;
        this.lastFinalText = text;
        this.lastFinalAt = now;
        this.translationQueue.enqueue({ text, sourceLang: this.sourceLang, targetLang: this.targetLang }, queueEpoch);
      }
      if (interim.length) {
        this.onInterim({ text: interim.join(" "), final: false, sourceLang: this.sourceLang });
      }
    }

    _consumeError(event, session) {
      if (session !== this.session || !this.isActive) return;
      const code = event && event.error ? event.error : "unknown";
      if (code === "aborted") return;
      if (code === "no-speech") {
        this._setState("no-speech", { input: this.fellBackToMicrophone ? "microphone-fallback" : this.audioSource });
        return;
      }
      if (code === "audio-capture" && this.audioTrack) {
        this._fallbackToMicrophone(session);
        return;
      }
      this._fail(session, { code, error: event });
    }

    _fallbackToMicrophone(session) {
      if (session !== this.session || this.fellBackToMicrophone) return;
      this.fellBackToMicrophone = true;
      this.audioTrack = null;
      this.capture.close();
      this.onWarning({ code: "microphone-fallback" });
      this._setState("listening", { input: "microphone-fallback" });
      // The recognizer's end event restarts it using the microphone path.
    }

    _startRecognition(session) {
      if (session !== this.session || !this.isActive || !this.recognition) return;
      try {
        if (this.audioTrack) this.recognition.start(this.audioTrack);
        else this.recognition.start();
      } catch (error) {
        if (this.audioTrack) {
          this._fallbackToMicrophone(session);
          try {
            if (this.recognition) this.recognition.start();
          } catch (micError) {
            this._fail(session, { code: "audio-capture", error: micError });
          }
        } else {
          this._fail(session, { code: "recognition-start-failed", error });
        }
      }
    }

    _scheduleRestart(session) {
      if (session !== this.session || !this.isActive || this.restartTimer !== null) return;
      const delay = this.restartDelay;
      this.restartDelay = Math.min(2000, Math.round(this.restartDelay * 1.6));
      this.restartTimer = this.schedule(() => {
        this.restartTimer = null;
        this._startRecognition(session);
      }, delay);
    }

    _fail(session, details) {
      if (session !== this.session) return;
      this.onError(details);
      this.stop();
      this._setState("error", details);
    }

    stop() {
      if (this.restartTimer !== null) {
        this.cancelSchedule(this.restartTimer);
        this.restartTimer = null;
      }
      this.session += 1;
      this.translationQueue.reset();
      const recognition = this.recognition;
      this.recognition = null;
      if (recognition) {
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
        recognition.onstart = null;
        try { recognition.stop(); } catch (_error) { /* already stopped */ }
      }
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
    SerialTranslationQueue,
    LiveCaptionEngine
  };
});
