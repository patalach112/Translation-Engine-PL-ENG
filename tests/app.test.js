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
  visibleCharLength
} = require("../web/app.js");
const { normalizeLang, detectSourceLang } = require("../scripts/headless-translator.js");

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
    for (const language of SUPPORTED_LANGUAGES.map((entry) => entry.code)) {
      assert.ok(item.tracks[language], `${item.id} missing ${language} track path`);
      const trackPath = path.resolve(root, "web", item.tracks[language]);
      const vtt = fs.readFileSync(trackPath, "utf8");
      assert.ok(vtt.startsWith("WEBVTT\n\n"), `${item.id}/${language} missing WebVTT header`);
      assert.deepEqual(SubtitleParser.validateWebVTT(vtt, null, 42), []);
    }
  }
  const workflow = fs.readFileSync(path.join(root, ".github/workflows/auto-translate-pipeline.yml"), "utf8");
  assert.match(workflow, /assets\/raw/);
  assert.match(workflow, /git push origin/);
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.match(html, /url=web\//);
});
