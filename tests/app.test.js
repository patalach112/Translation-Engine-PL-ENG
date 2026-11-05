const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  SAMPLE_SUBTITLES,
  SUPPORTED_LANGUAGES,
  UI_DICTIONARY,
  LocalizationManager,
  SubtitleCacheStore,
  SubtitleParser,
  TokenShield,
  TextFormatter,
  ClientTranslator,
  translateSubtitlePayload,
  translateSubtitleToLanguage,
  translateLiveTranscript,
  visibleCharLength
} = require("../web/app.js");
const { normalizeLang, detectSourceLang } = require("../scripts/headless-translator.js");
const {
  LiveCaptionEngine,
  CaptionOverlayRenderer,
  BrowserSpeechRecognitionProvider,
  LocalWhisperSpeechProvider,
  AudioCaptureAdapter,
  GlossaryLexicon,
  TranscriptOverlapFilter,
  loadLocalWhisperPipeline,
  resampleAudioLinear,
  conditionWhisperAudio
} = require("../web/live-caption-engine.js");

class FakeSpeechRecognition {
  constructor({ rejectAudioTrack = false } = {}) {
    this.rejectAudioTrack = rejectAudioTrack;
    this.startCalls = [];
    this.stopCalls = 0;
  }
  start(track) {
    this.startCalls.push(track || null);
    if (track && this.rejectAudioTrack) throw new Error("Audio-track input is unsupported");
  }
  stop() { this.stopCalls += 1; }
  emit(text, isFinal = true) {
    this.onresult?.({
      resultIndex: 0,
      results: [{ 0: { transcript: text }, isFinal }]
    });
  }
}

function createMockStorage() {
  const map = new Map();
  return {
    getItem(k) {
      return map.has(k) ? map.get(k) : null;
    },
    setItem(k, v) {
      map.set(k, String(v));
    },
    removeItem(k) {
      map.delete(k);
    }
  };
}

test("SubtitleParser parses SRT & WebVTT with frozen timestamps and serializes W3C WebVTT", () => {
  const rawSrt = [
    "1",
    "00:00:01,205 --> 00:00:04,890",
    "Hello world!",
    "",
    "2",
    "01:02:03,004 --> 01:02:06,999",
    "Second cue."
  ].join("\n");

  const doc = SubtitleParser.parse(rawSrt, "demo.srt");
  assert.equal(doc.cues.length, 2);
  assert.equal(Object.isFrozen(doc.cues[0].timing), true);
  assert.equal(doc.cues[0].timing.startMs, 1205);
  assert.equal(doc.cues[0].timing.endMs, 4890);

  const vtt = SubtitleParser.serializeWebVTT(doc);
  assert.ok(vtt.startsWith("WEBVTT\n\n"));
  assert.ok(vtt.includes("00:00:01.205 --> 00:00:04.890"));
  assert.ok(vtt.includes("01:02:03.004 --> 01:02:06.999"));
  assert.deepEqual(SubtitleParser.validateWebVTT(vtt, doc, 42), []);
});

test("TokenShield masks and restores formatting tags, URLs, and placeholders cleanly", () => {
  const input =
    "- Visit https://example.com/docs or press <b>CC</b> and <i>play</i> for {user_id}.";
  const masked = TokenShield.mask(input);

  assert.equal(masked.leadingDash, "- ");
  assert.ok(!masked.cleanText.includes("<b>"));
  assert.ok(!masked.cleanText.includes("<i>"));
  assert.ok(!masked.cleanText.includes("https://example.com/docs"));
  assert.ok(!masked.cleanText.includes("{user_id}"));

  const mutatedTranslation = masked.cleanText
    .replace("Visit", "Odwiedź")
    .replace("⟦T0⟧", "⟦ t0 ⟧")
    .replace("⟦T1⟧", "[[T1]]");

  const restored = TokenShield.unmask(mutatedTranslation, masked);
  assert.ok(restored.startsWith("- "));
  assert.ok(restored.includes("https://example.com/docs"));
  assert.ok(restored.includes("<b>CC</b>"));
  assert.ok(restored.includes("<i>play</i>"));
  assert.ok(restored.includes("{user_id}"));
});

test("TextFormatter binds Polish single-letter prepositions (w, z, i, o, u, a) with \\u00A0 and enforces <= 42 CPL", () => {
  const plSample =
    "Witamy wszystkich widzów i gości w naszym nowym studiu z Warszawy a także o poranku u nas.";
  const bound = TextFormatter.bindPolishPrepositions(plSample);

  assert.ok(bound.includes("i\u00A0gości"));
  assert.ok(bound.includes("w\u00A0naszym"));
  assert.ok(bound.includes("z\u00A0Warszawy"));
  assert.ok(bound.includes("a\u00A0także"));
  assert.ok(bound.includes("o\u00A0poranku"));
  assert.ok(bound.includes("u\u00A0nas"));

  const lines = TextFormatter.wrapLines(plSample, { maxCpl: 42, lang: "pl" });
  assert.ok(lines.length >= 2);
  for (const ln of lines) {
    assert.ok(ln.length <= 42, `Line exceeded 42 CPL (${ln.length}): "${ln}"`);
    assert.ok(visibleCharLength(ln) <= 42);
    assert.equal(/\s[wzioua]$/i.test(ln), false, `Hanging preposition on line: "${ln}"`);
  }

  const overlongUrl =
    "https://cdn.example-video-platform.org/assets/2026/keynote/subtitles/tracks/polish.vtt";
  const urlLines = TextFormatter.wrapLines(overlongUrl, { maxCpl: 42, lang: "en" });
  for (const ln of urlLines) {
    assert.ok(ln.length <= 42);
  }
});

test("Tone/Register modes (Formal Feminine, Formal Masculine, Informal Plural, Auto 5-Cue) inflect Polish accurately", async () => {
  const sampleCue = [
    "1",
    "00:00:01,000 --> 00:00:04,000",
    "Were you surprised when latency dropped by fifty percent?"
  ].join("\n");

  const femRes = await translateSubtitlePayload(sampleCue, {
    registerMode: "formal_fem",
    settings: { provider: "offline" }
  });
  assert.ok(femRes.plVtt.includes("Czy była Pani zaskoczona"));

  const mascRes = await translateSubtitlePayload(sampleCue, {
    registerMode: "formal_masc",
    settings: { provider: "offline" }
  });
  assert.ok(mascRes.plVtt.includes("Czy był Pan zaskoczony"));

  const pluralRes = await translateSubtitlePayload(sampleCue, {
    registerMode: "informal_plural",
    settings: { provider: "offline" }
  });
  assert.ok(pluralRes.plVtt.includes("Czy byliście zaskoczeni"));

  const autoKeynote = await translateSubtitlePayload(SAMPLE_SUBTITLES.en_keynote, {
    registerMode: "auto",
    settings: { provider: "offline" }
  });
  assert.equal(autoKeynote.cueCount, 10);
  assert.ok(autoKeynote.maxCplEn <= 42);
  assert.ok(autoKeynote.maxCplPl <= 42);
  assert.ok(autoKeynote.plVtt.includes("Czy mogłaby Pani wyjaśnić"));
  assert.ok(autoKeynote.plVtt.includes("Czy możecie teraz przetestować"));
  assert.deepEqual(
    SubtitleParser.validateWebVTT(autoKeynote.plVtt, autoKeynote.plDoc, 42),
    []
  );
});

test("LocalizationManager detects Polish vs non-Polish browser language and persists viewer track preferences", () => {
  const storage = createMockStorage();

  // Polish browser locale -> defaults to Polish UI & Polish subtitle track
  assert.equal(
    LocalizationManager.detectBrowserLanguage({ language: "pl-PL", languages: ["pl-PL", "en-US"] }),
    "pl"
  );
  assert.equal(
    LocalizationManager.resolveUiLanguage(storage, { language: "pl" }),
    "pl"
  );
  assert.deepEqual(
    LocalizationManager.resolvePreferredSubtitleTrack(storage, { language: "pl-PL" }),
    { trackLang: "pl", source: "browser" }
  );

  // German or English browser locale -> defaults to English
  assert.equal(
    LocalizationManager.detectBrowserLanguage({ language: "de-DE", languages: ["de-DE"] }),
    "en"
  );
  assert.deepEqual(
    LocalizationManager.resolvePreferredSubtitleTrack(storage, { language: "fr-FR" }),
    { trackLang: "fr", source: "browser" }
  );
  assert.deepEqual(
    LocalizationManager.resolvePreferredSubtitleTrack(storage, { language: "de-DE" }),
    { trackLang: "de", source: "browser" }
  );
  assert.deepEqual(
    LocalizationManager.resolvePreferredSubtitleTrack(storage, { language: "ja-JP" }),
    { trackLang: "ja", source: "browser" }
  );

  // Saved user track preference overrides browser locale across sessions/videos
  LocalizationManager.savePreferredSubtitleTrack("pl", storage);
  assert.deepEqual(
    LocalizationManager.resolvePreferredSubtitleTrack(storage, { language: "en-US" }),
    { trackLang: "pl", source: "saved" }
  );

  LocalizationManager.savePreferredSubtitleTrack("ja", storage);
  assert.deepEqual(
    LocalizationManager.resolvePreferredSubtitleTrack(storage, { language: "en-US" }),
    { trackLang: "ja", source: "saved" }
  );
  assert.ok(SUPPORTED_LANGUAGES.length >= 25);
  assert.ok(SUPPORTED_LANGUAGES.some((language) => language.code === "zh-CN"));
  assert.ok(SUPPORTED_LANGUAGES.some((language) => language.code === "de"));

  // Ensure complete parity between EN and PL UI dictionaries
  assert.deepEqual(
    Object.keys(UI_DICTIONARY.en).sort(),
    Object.keys(UI_DICTIONARY.pl).sort()
  );
});

test("SubtitleCacheStore delivers sub-second cache hits and persists across reloads", async () => {
  const storage = createMockStorage();
  const cacheStore = new SubtitleCacheStore({ storage, maxEntries: 10 });

  let apiCalls = 0;
  const countingTranslator = {
    lastUsedProvider: "counted-mock",
    resetCircuit() {},
    async translateSegment(text) {
      apiCalls += 1;
      return `PL: ${text}`;
    }
  };

  // First load populates cache
  const first = await translateSubtitlePayload(SAMPLE_SUBTITLES.vertical_short, {
    videoKey: "local:clip.mp4:1024",
    filename: "vertical_short.srt",
    cacheStore,
    translator: countingTranslator
  });
  assert.equal(first.fromCache, false);
  assert.equal(apiCalls, 4);
  assert.equal(cacheStore.size(), 1);

  // Hydrate a brand-new SubtitleCacheStore from localStorage (simulates browser refresh)
  const rehydratedStore = new SubtitleCacheStore({ storage, maxEntries: 10 });
  const failingTranslator = {
    async translateSegment() {
      throw new Error("Should not call network when cached!");
    }
  };

  const t0 = performance.now();
  const second = await translateSubtitlePayload(SAMPLE_SUBTITLES.vertical_short, {
    videoKey: "local:clip.mp4:1024",
    filename: "vertical_short.srt",
    cacheStore: rehydratedStore,
    translator: failingTranslator
  });
  const elapsedMs = performance.now() - t0;

  assert.equal(second.fromCache, true);
  assert.equal(second.providerUsed, "instant-local-cache");
  assert.equal(second.plVtt, first.plVtt);
  assert.ok(elapsedMs < 50, `Expected sub-second cache lookup, took ${elapsedMs}ms`);
  assert.ok(rehydratedStore.getByVideoKey("local:clip.mp4:1024"));
});

test("ClientTranslator gracefully handles HTTP 429 rate limits, trips circuit breaker, and triggers fallback toast once", async () => {
  const originalFetch = global.fetch;
  const originalNavigator = global.navigator;
  let fetchCount = 0;
  let fallbackAlerts = 0;
  let capturedInfo = null;

  try {
    Object.defineProperty(global, "navigator", {
      value: { onLine: true, language: "en-US" },
      configurable: true
    });

    global.fetch = async () => {
      fetchCount += 1;
      return {
        ok: false,
        status: 429,
        async json() {
          return {};
        }
      };
    };

    const result = await translateSubtitlePayload(SAMPLE_SUBTITLES.vertical_short, {
      settings: { provider: "auto" },
      onFallback(info) {
        fallbackAlerts += 1;
        capturedInfo = info;
      }
    });

    // Circuit breaker must trip on cue 1 (1 Google GTX + 1 MyMemory = 2 fetches total, NOT 8!)
    assert.equal(fetchCount, 2);
    assert.equal(fallbackAlerts, 1);
    assert.deepEqual(capturedInfo.failedEndpoints, ["Google GTX", "MyMemory"]);
    assert.equal(result.providerUsed, "offline-smart-dictionary");
    assert.equal(result.fallbackOccurred, true);
    assert.ok(result.plVtt.startsWith("WEBVTT\n\n"));
  } finally {
    global.fetch = originalFetch;
    Object.defineProperty(global, "navigator", {
      value: originalNavigator,
      configurable: true
    });
  }
});

test("Production HTML includes SEO/OpenGraph/Twitter meta tags, prominent CC buttons, and hidden Creator Studio", () => {
  const html = fs.readFileSync(path.join(__dirname, "../web/index.html"), "utf8");

  // OpenGraph & Twitter Cards
  assert.match(html, /property="og:title"/);
  assert.match(html, /property="og:description"/);
  assert.match(html, /property="og:image"/);
  assert.match(html, /name="twitter:card"/);
  assert.match(html, /name="viewport"/);

  // Prominent viewer CC pills & Creator Studio hidden by default
  assert.match(html, /data-track-select="pl"[\s\S]*?Polski \(CC\)/);
  assert.match(html, /data-track-select="en"[\s\S]*?English \(CC\)/);
  assert.match(html, /id="creator-studio-backdrop"[^>]*\bhidden\b/);
  assert.match(html, /id="btn-aspect-9-16"/);
  assert.match(html, /id="catalog-language-select"/);
  assert.match(html, /id="live-source-language"/);
  assert.match(html, /id="live-target-language"/);
  assert.match(html, /id="btn-live-captions"/);
  assert.match(html, /id="live-caption-overlay"/);
  assert.match(html, /id="live-caption-heard"/);
  assert.match(html, /id="live-asr-provider"/);
  assert.match(html, /id="live-asr-model"/);
  assert.match(html, /id="live-caption-glossary"/);
  assert.match(html, /id="live-model-progress"/);
  assert.match(html, /id="btn-live-subtitle-file"/);
  assert.match(html, /value="onnx-community\/whisper-base"/);
  assert.match(html, /value="onnx-community\/whisper-small"/);
  assert.match(html, /\.ass,\.ssa/);
  assert.match(html, /live-caption-engine\.js" defer/);
  assert.ok(fs.existsSync(path.join(__dirname, "../web/live-audio-worklet.js")));
});

test("Generic language translator creates timestamp-preserving tracks for any supported locale", async () => {
  const raw = ["1", "00:00:01,200 --> 00:00:03,500", "<i>Hello, world.</i>"].join("\n");
  const translator = {
    lastUsedProvider: "test-mock",
    resetCircuit() {},
    async translateSegment(text, source, target) {
      assert.equal(source, "en");
      assert.equal(target, "ja");
      return `こんにちは ${text}`;
    }
  };
  const result = await translateSubtitleToLanguage(raw, "ja", {
    filename: "sample.srt", sourceLang: "en", translator
  });
  assert.equal(result.targetLang, "ja");
  assert.equal(result.providerUsed, "test-mock");
  assert.ok(result.vtt.startsWith(`WEBVTT\n\n`));
  assert.ok(result.vtt.includes("00:00:01.200 --> 00:00:03.500"));
  assert.ok(result.vtt.includes("<i>こんにちは Hello, world.</i>"));
  assert.deepEqual(SubtitleParser.validateWebVTT(result.vtt, result.doc, 42), []);
});

test("Live speech transcripts translate from Japanese into a selected subtitle language", async () => {
  const translator = {
    lastUsedProvider: "test-mock",
    async translateSegment(text, source, target, context) {
      assert.equal(text, "こんにちは、世界！");
      assert.equal(source, "ja");
      assert.equal(target, "pl");
      assert.equal(context.activeRegister, "default");
      return "Cześć, świecie!";
    }
  };
  const result = await translateLiveTranscript("こんにちは、世界！", "ja", "pl", translator);
  assert.equal(result.text, "Cześć, świecie!");
  assert.equal(result.providerUsed, "test-mock");
  await assert.rejects(translateLiveTranscript("hello", "xx", "pl", translator), /Unsupported live caption/);
});

test("Live translation applies explicit register and infers it from continuing speech", async () => {
  const contexts = [];
  const translator = {
    lastUsedProvider: "register-mock",
    async translateSegment(text, _source, _target, context) {
      contexts.push(context);
      return text;
    }
  };
  await translateLiveTranscript("Sir, would you help me?", "en", "pl", translator, [], "auto");
  assert.equal(contexts[0].activeRegister, "formal_masc");
  await translateLiveTranscript("Hello, everyone.", "en", "pl", translator, [], "informal_plural");
  assert.equal(contexts[1].activeRegister, "informal_plural");
});

test("OpenAI-compatible translation prompt localizes naturally and includes live context", async () => {
  const originalFetch = global.fetch;
  let requestBody;
  try {
    global.fetch = async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return { ok: true, async json() { return { choices: [{ message: { content: "To było na YouTube Shorts." } }] }; } };
    };
    const translator = new ClientTranslator({
      provider: "openai_compat",
      customEndpoint: "https://translation.example/v1",
      llmModel: "test-model"
    });
    const result = await translator.translateSegment("I watched ⟦T0⟧.", "en", "pl", {
      activeRegister: "default",
      history: [{ cueIndex: 1, sourceText: "We talked about the video.", translatedText: "Rozmawialiśmy o filmie." }]
    });
    assert.equal(result, "To było na YouTube Shorts.");
    assert.match(requestBody.messages[0].content, /meaning and speaker intent, not word-for-word/i);
    assert.match(requestBody.messages[0].content, /⟦T0⟧/);
    assert.match(requestBody.messages[1].content, /Recent 5-cue context/);
    assert.match(requestBody.messages[1].content, /Rozmawialiśmy o filmie/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("Natural live translation preserves platform names and carries recent conversational context", async () => {
  const calls = [];
  const translator = {
    lastUsedProvider: "context-mock",
    async translateSegment(text, source, target, context) {
      assert.equal(source, "en");
      assert.equal(target, "pl");
      assert.match(text, /⟦T0⟧/);
      calls.push({ text, context });
      return "Widziałem to na ⟦T0⟧.";
    }
  };
  const first = await translateLiveTranscript("I watched it on youtube shorts.", "en", "pl", translator);
  const second = await translateLiveTranscript("Everyone is sharing it on YouTube Shorts.", "en", "pl", translator);
  assert.equal(first.text, "Widziałem to na YouTube Shorts.");
  assert.equal(second.text, "Widziałem to na YouTube Shorts.");
  assert.equal(calls[0].context.history.length, 0);
  assert.equal(calls[1].context.history.length, 1);
  assert.equal(calls[1].context.history[0].sourceText, "I watched it on youtube shorts.");

  const custom = await translateLiveTranscript("YouTube Shorts", "en", "pl", translator, [
    { source: "YouTube Shorts", target: "Shorty YouTube" }
  ]);
  assert.equal(custom.text, "Widziałem to na Shorty YouTube.");
});

test("Live translation protects custom anime glossary terms and Whisper overlap is removed", async () => {
  const translator = {
    lastUsedProvider: "test-mock",
    async translateSegment(text, source, target) {
      assert.equal(source, "ja");
      assert.equal(target, "pl");
      assert.match(text, /⟦T0⟧/);
      assert.doesNotMatch(text, /ピカチュウ/);
      return "⟦T0⟧ nadchodzi";
    }
  };
  const result = await translateLiveTranscript("ピカチュウが来た", "ja", "pl", translator, [
    { source: "ピカチュウ", target: "Pikachu" }
  ]);
  assert.equal(result.text, "Pikachu nadchodzi");

  const glossary = new GlossaryLexicon([{ source: "C++", target: "C plus plus" }]);
  const protectedText = glossary.protect("C++ is a language");
  assert.equal(glossary.restore(protectedText.text, protectedText.tokens), "C plus plus is a language");
  const overlap = new TranscriptOverlapFilter({ minOverlap: 4 });
  assert.equal(overlap.push("Good morning everyone"), "Good morning everyone");
  assert.equal(overlap.push("everyone, welcome back"), "welcome back");
  assert.equal(overlap.push("sword attack"), "sword attack");
  assert.deepEqual(Array.from(resampleAudioLinear(new Float32Array([0, 1, 0, -1]), 32000, 16000)), [0, 0]);
});

test("Whisper audio conditioning removes DC offset, levels quiet voice, and limits peaks", () => {
  const input = new Float32Array([0.10, 0.11, 0.09, 0.10]);
  const conditioned = conditionWhisperAudio(input);
  const mean = conditioned.reduce((sum, sample) => sum + sample, 0) / conditioned.length;
  const peak = Math.max(...conditioned.map(Math.abs));
  assert.ok(Math.abs(mean) < 1e-6);
  assert.ok(peak > 0.02, "quiet speech should receive modest gain");
  assert.ok(peak <= 0.95);
  assert.deepEqual(Array.from(conditionWhisperAudio(new Float32Array(16))), Array(16).fill(0));
});

test("Whisper pipeline uses a quantized browser runtime and caches the model", async () => {
  const calls = [];
  const pipelineInstance = async () => ({ text: "" });
  const runtime = {
    env: {},
    async pipeline(...args) {
      calls.push(args);
      return pipelineInstance;
    }
  };
  const options = {
    modelId: "test/unique-whisper-runtime-cache",
    runtimeLoader: async () => runtime
  };
  assert.equal(await loadLocalWhisperPipeline(options), pipelineInstance);
  assert.equal(runtime.env.useBrowserCache, true);
  assert.deepEqual(calls[0].slice(0, 2), ["automatic-speech-recognition", options.modelId]);
  assert.ok(["wasm", "webgpu"].includes(calls[0][2].device));
  assert.equal(calls[0][2].dtype, "q8");
  assert.equal(await loadLocalWhisperPipeline({ ...options, runtimeLoader: async () => { throw new Error("must use cache"); } }), pipelineInstance);
  assert.equal(calls.length, 1);
});

test("Local Whisper provider loads on-device ASR and emits timestamp-window transcripts", async () => {
  const states = [];
  const transcripts = [];
  let capturedSource;
  let inferenceCount = 0;
  const provider = new LocalWhisperSpeechProvider({
    modelId: "test/whisper",
    pipelineLoader: async ({ modelId }) => {
      assert.equal(modelId, "test/whisper");
      return async (waveform, options) => {
        assert.ok(waveform instanceof Float32Array);
        assert.equal(options.sampling_rate, 16000);
        assert.equal(options.language, "japanese");
        assert.equal(options.task, "transcribe");
        assert.equal(options.return_timestamps, true);
        assert.equal(options.num_beams, 2);
        inferenceCount += 1;
        return { text: inferenceCount === 1 ? "こんにちは世界" : "こんにちは世界今日はいい天気です" };
      };
    },
    audioSourceFactory: (options) => {
      capturedSource = {
        sampleRate: 16000,
        start: async () => 16000,
        stop: async () => {},
        emit: options.onSamples
      };
      return capturedSource;
    },
    chunkSeconds: 1,
    overlapSeconds: 0.25
  });
  const started = await provider.start({
    sourceLang: "ja",
    stream: {},
    onState: (state) => states.push(state),
    onFinal: (segment) => transcripts.push(segment),
    onError: (error) => assert.fail(error.code || "Whisper provider emitted an unexpected error")
  });
  assert.equal(started, true);
  assert.ok(states.includes("loading-model"));
  capturedSource.emit(new Float32Array(16000).fill(0.05));
  await new Promise((resolve) => setImmediate(resolve));
  capturedSource.emit(new Float32Array(16000).fill(0.05));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(transcripts.length, 2);
  assert.equal(transcripts[0].text, "こんにちは世界");
  assert.equal(transcripts[1].text, "今日はいい天気です");
  assert.ok(states.includes("transcribing"));
  await provider.stop();
});

test("Whisper uses trailing silence to flush phrases and skips silent windows", async () => {
  let source;
  let inferenceCount = 0;
  const transcripts = [];
  const states = [];
  const provider = new LocalWhisperSpeechProvider({
    modelId: "test/voice-activity",
    pipelineLoader: async () => async () => {
      inferenceCount += 1;
      return { text: "recognized phrase" };
    },
    audioSourceFactory: ({ onSamples }) => {
      source = { start: async () => 16000, stop: async () => {}, emit: onSamples };
      return source;
    },
    chunkSeconds: 2,
    overlapSeconds: 0.2,
    minChunkSeconds: 0.8,
    endSilenceSeconds: 0.25,
    speechRmsThreshold: 0.01
  });
  await provider.start({
    sourceLang: "en",
    stream: {},
    onState: (state) => states.push(state),
    onFinal: (segment) => transcripts.push(segment),
    onError: (error) => assert.fail(error.code || "unexpected local ASR error")
  });
  source.emit(new Float32Array(32000));
  assert.equal(inferenceCount, 0, "silence should not trigger Whisper inference");
  assert.ok(states.includes("no-speech"), "quiet windows should be reported to the UI");
  source.emit(new Float32Array(9600).fill(0.08));
  assert.equal(inferenceCount, 0, "phrase waits for a pause or maximum chunk length");
  source.emit(new Float32Array(4000));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(inferenceCount, 1);
  assert.equal(transcripts[0].text, "recognized phrase");
  await provider.stop();
});

test("Live caption engine selects local Whisper and forwards the selected model id", async () => {
  let requestedModel;
  let selectedStream;
  const track = { stop() {}, addEventListener() {} };
  const stream = { getAudioTracks: () => [track], getTracks: () => [track] };
  const engine = new LiveCaptionEngine({
    mediaDevices: { async getUserMedia() { return stream; } },
    localWhisperOptions: {
      pipelineLoader: async ({ modelId }) => {
        requestedModel = modelId;
        return async () => ({ text: "" });
      },
      audioSourceFactory: ({ stream: inputStream }) => {
        selectedStream = inputStream;
        return { start: async () => 16000, stop: async () => {} };
      }
    }
  });
  assert.equal(await engine.start({
    sourceLang: "ja", targetLang: "pl", audioSource: "microphone",
    asrProvider: "local-whisper", modelId: "test/whisper-base"
  }), true);
  assert.equal(selectedStream, stream);
  assert.equal(requestedModel, "test/whisper-base");
  engine.stop();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(engine.state, "idle");
});

test("Audio capture adapter obtains tab or mono microphone streams for local ASR", async () => {
  const track = { stop() {} };
  const stream = { getAudioTracks: () => [track], getTracks: () => [track] };
  let microphoneOptions;
  const adapter = new AudioCaptureAdapter({
    async getDisplayMedia(options) {
      assert.equal(options.audio, true);
      return stream;
    },
    async getUserMedia(options) {
      microphoneOptions = options;
      return stream;
    }
  });
  const tabCapture = await adapter.open("tab", { captureMicrophone: true });
  assert.equal(tabCapture.audioTrack, track);
  assert.equal(tabCapture.fallback, false);
  adapter.close();
  const microphoneCapture = await adapter.open("microphone", { captureMicrophone: true });
  assert.equal(microphoneCapture.audioTrack, track);
  assert.equal(microphoneOptions.audio.channelCount, 1);
  assert.equal(microphoneOptions.audio.echoCancellation, false);
  assert.equal(microphoneOptions.audio.noiseSuppression, false);
  adapter.close();
});

test("Browser ASR adapter normalizes locales, restarts safely, and renderer owns cue expiry", () => {
  let recognition;
  const timers = [];
  const interim = [];
  const finals = [];
  const states = [];
  const provider = new BrowserSpeechRecognitionProvider({
    recognitionFactory: () => (recognition = new FakeSpeechRecognition()),
    schedule: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    cancelSchedule: (id) => { timers[id - 1] = null; }
  });
  provider.start({
    sourceLang: "ja",
    onInterim: (event) => interim.push(event),
    onFinal: (event) => finals.push(event),
    onState: (state) => states.push(state)
  });
  assert.equal(recognition.lang, "ja-JP");
  recognition.onstart();
  recognition.emit("こ", false);
  recognition.emit("こんにちは", true);
  assert.equal(interim.at(-1).text, "");
  assert.equal(finals[0].text, "こんにちは");
  recognition.onend();
  assert.equal(timers[0].ms, 250);
  timers[0].fn();
  assert.equal(recognition.startCalls.length, 2);
  provider.stop();
  assert.equal(provider.active, false);

  const element = { hidden: true, textContent: "" };
  let expire;
  const renderer = new CaptionOverlayRenderer({
    element,
    schedule: (fn) => { expire = fn; return 1; },
    cancelSchedule() {}
  });
  assert.equal(renderer.show("Cześć!", { durationMs: 1234 }), true);
  assert.equal(element.hidden, false);
  assert.equal(element.textContent, "Cześć!");
  expire();
  assert.equal(element.hidden, true);
  assert.ok(states.includes("listening"));
});

test("Live caption engine serializes speech, falls back from tab capture, and cancels stale work", async () => {
  let recognition;
  const captions = [];
  const statuses = [];
  let resolveTranslation;
  const track = {
    stop() {},
    addEventListener() {}
  };
  const stream = {
    getAudioTracks: () => [track],
    getTracks: () => [track]
  };
  const engine = new LiveCaptionEngine({
    recognitionFactory: () => (recognition = new FakeSpeechRecognition({ rejectAudioTrack: true })),
    mediaDevices: { async getDisplayMedia() { return stream; } },
    translate: (segment) => new Promise((resolve) => {
      assert.equal(segment.sourceLang, "ja");
      assert.equal(segment.targetLang, "pl");
      resolveTranslation = resolve;
    }),
    onCaption: (caption) => captions.push(caption),
    onStatus: (status) => statuses.push(status)
  });

  assert.equal(await engine.start({ sourceLang: "ja", targetLang: "pl", audioSource: "tab" }), true);
  assert.equal(recognition.lang, "ja-JP");
  assert.equal(recognition.startCalls.length, 2);
  assert.equal(recognition.startCalls[0], track);
  assert.equal(recognition.startCalls[1], null, "unsupported tab-track input should fall back to microphone");
  assert.equal(engine.fellBackToMicrophone, true);

  recognition.emit("こんにちは", true);
  await new Promise((resolve) => setImmediate(resolve));
  engine.stop();
  resolveTranslation({ text: "Cześć", providerUsed: "mock" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(captions.length, 0, "late translation from a stopped session must be discarded");
  assert.equal(engine.state, "idle");
  assert.ok(statuses.some((status) => status.input === "microphone-fallback"));
});

test("Live caption engine reports interim speech and emits ordered final translations", async () => {
  let recognition;
  const captions = [];
  const interim = [];
  const engine = new LiveCaptionEngine({
    recognitionFactory: () => (recognition = new FakeSpeechRecognition()),
    mediaDevices: {},
    translate: async (segment) => ({ text: `PL:${segment.text}`, providerUsed: "mock" }),
    onCaption: (caption) => captions.push(caption),
    onInterim: (event) => interim.push(event)
  });
  await engine.start({ sourceLang: "ja", targetLang: "pl", audioSource: "microphone" });
  recognition.emit("こ", false);
  recognition.emit("こんにちは", true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(interim.some((event) => !event.final && event.text === "こ"));
  assert.equal(captions.length, 1);
  assert.equal(captions[0].text, "PL:こんにちは");
  engine.stop();
});

test("Offline demo memory provides real Japanese, Chinese, and German translations", async () => {
  const raw = ["1", "00:00:01,200 --> 00:00:03,500", "Good evening, Dr. Anna Kowalska. Welcome to our live broadcast."].join("\n");
  for (const [lang, expression] of [
    ["ja", /アンナ・コワルスカ博士/],
    ["zh-CN", /晚上好，安娜/],
    ["de", /Guten Abend, Frau Dr\./]
  ]) {
    const result = await translateSubtitleToLanguage(raw, lang, {
      filename: "demo.srt",
      sourceLang: "en",
      settings: { provider: "offline" }
    });
    assert.match(result.vtt, expression);
  }
});

test("Global source-language detection and locale normalization cover major writing systems", () => {
  const doc = (text) => ({ cues: [{ text }] });
  assert.equal(normalizeLang("zh-TW"), "zh-CN");
  assert.equal(normalizeLang("de-DE"), "de");
  assert.equal(detectSourceLang(doc("Das ist nicht für die neue Welt.")), "de");
  assert.equal(detectSourceLang(doc("今日は日本語の字幕をテストします。")), "ja");
  assert.equal(detectSourceLang(doc("这是一个中文字幕测试。")), "zh-CN");
  assert.equal(detectSourceLang(doc("Привет, как ваши дела сегодня?")), "ru");
});

test("SubtitleParser imports ASS/SSA cues, keeps override positions, and converts basic style tags", () => {
  const ass = [
    "[Script Info]",
    "PlayResX: 1920",
    "PlayResY: 1080",
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    "Dialogue: 0,0:00:01.20,0:00:03.50,Default,,0,0,0,,{\\an8\\i1}Translation note{\\i0}\\NDialogue below"
  ].join("\n");
  const doc = SubtitleParser.parse(ass, "anime.ass");
  assert.equal(doc.sourceFormat, "ass");
  assert.equal(doc.cues.length, 1);
  assert.equal(doc.cues[0].timing.startMs, 1200);
  assert.equal(doc.cues[0].timing.endMs, 3500);
  assert.match(doc.cues[0].timing.settings, /line:0\.0%/);
  assert.match(doc.cues[0].timing.settings, /align:center/);
  assert.equal(doc.cues[0].text, "<i>Translation note</i>\nDialogue below");
  assert.equal(TokenShield.splitDialogueTurns(doc.cues[0].text).turns[0], doc.cues[0].text);
  assert.equal(TextFormatter.formatCueText(doc.cues[0].text, { lang: "en", maxCpl: 42 }), doc.cues[0].text);
  const vtt = SubtitleParser.serializeWebVTT(doc);
  assert.match(vtt, /STYLE\n::cue/);
  assert.match(vtt, /line:0\.0% position:50\.0% align:center/);
  assert.deepEqual(SubtitleParser.validateWebVTT(vtt, doc, 42), []);
});

test("Headless localization workflow and CMS catalog are zero-dependency and statically deployable", () => {
  const { execFileSync } = require("node:child_process");
  const path = require("node:path");
  const root = path.join(__dirname, "..");
  const help = execFileSync(process.execPath, ["scripts/headless-translator.js", "--help"], {
    cwd: root,
    encoding: "utf8"
  });
  assert.match(help, /--input assets\/raw/);
  const catalog = JSON.parse(fs.readFileSync(path.join(root, "web/data/catalog.json"), "utf8"));
  assert.equal(catalog.schemaVersion, 1);
  assert.ok(catalog.items.length >= 3);
  for (const item of catalog.items) {
    assert.ok(item.title && item.description && item.tracks);
    assert.ok(item.sourceSubtitle);
    assert.ok(fs.existsSync(path.resolve(root, "web", item.sourceSubtitle)));
    for (const language of SUPPORTED_LANGUAGES.map((entry) => entry.code)) {
      assert.ok(item.tracks[language], `${item.id} missing ${language} track path`);
      const trackPath = path.resolve(root, "web", item.tracks[language]);
      const vtt = fs.readFileSync(trackPath, "utf8");
      assert.ok(vtt.startsWith("WEBVTT\n\n"), `${item.id}/${language} missing WebVTT header`);
      assert.deepEqual(SubtitleParser.validateWebVTT(vtt, null, 42), []);
    }
  }
  const keynote = catalog.items.find((item) => item.id === "keynote");
  assert.ok(keynote, "bundled keynote demo is required");
  for (const [language, expression] of [
    ["ja", /アンナ・コワルスカ博士/],
    ["zh-CN", /晚上好，安娜/],
    ["de", /Guten Abend/],
    ["es", /Buenas (?:tardes|noches)/],
    ["fr", /Bonsoir,/]
  ]) {
    const track = fs.readFileSync(path.resolve(root, "web", keynote.tracks[language]), "utf8");
    assert.match(track, expression, `keynote/${language} must contain localized subtitle text`);
  }
  const workflow = fs.readFileSync(path.join(root, ".github/workflows/auto-translate-pipeline.yml"), "utf8");
  assert.match(workflow, /assets\/raw/);
  assert.match(workflow, /git push origin/);
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.match(html, /url=web\//);
});
