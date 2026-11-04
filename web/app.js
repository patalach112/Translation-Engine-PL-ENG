/**
 * StreamPL / Translation-Engine-PL-ENG — Production Client-Side Localization & Video Hub
 *
 * 100% Serverless Vanilla JavaScript (ES6+) Engine:
 * - Separate Public Streaming Hub (Viewer UI) & Slide-Over Creator Studio (Admin Panel)
 * - Auto-Localization (`navigator.language` Polish detection for UI + default `<track>`)
 * - Persistent Viewer Subtitle Track Preference (`localStorage`) across sessions & videos
 * - Sub-Second Offline Subtitle Cache (`SubtitleCacheStore`: Memory + LRU `localStorage`)
 * - Graceful API Rate-Limit / Offline Circuit Breaker + Toast Notifications
 * - `SubtitleParser` (W3C WebVTT + SRT, `Object.freeze` immutable timestamps)
 * - `TokenShield` (regex protection for `<i>`, `<b>`, `<c>`, `<v>`, URLs, `{vars}`)
 * - `TextFormatter` (strict <= 42 CPL DP wrapper + `\u00A0` Polish `w, z, i, o, u, a` binding)
 * - `RollingContextWindow` (5-cue history) + `PolishRegisterHarmonizer` (`Pani`, `Pan`, `wy`)
 */

(function (root, factory) {
  const exportsObj = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = exportsObj;
  }
  if (typeof window !== "undefined") {
    window.SubtitleEngine = exportsObj;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* ==========================================================================
   * 1. SUPPORTED LOCALES, SAMPLE SUBTITLES & UI TRANSLATIONS
   * ========================================================================== */

  const SUPPORTED_LANGUAGES = [
    { code: "en", name: "English", nativeName: "English" },
    { code: "pl", name: "Polish", nativeName: "Polski" },
    { code: "es", name: "Spanish", nativeName: "Español" },
    { code: "ja", name: "Japanese", nativeName: "日本語" },
    { code: "zh-CN", name: "Chinese (Simplified)", nativeName: "简体中文" },
    { code: "de", name: "German", nativeName: "Deutsch" },
    { code: "fr", name: "French", nativeName: "Français" },
    { code: "ar", name: "Arabic", nativeName: "العربية" },
    { code: "hi", name: "Hindi", nativeName: "हिन्दी" },
    { code: "pt", name: "Portuguese", nativeName: "Português" },
    { code: "ru", name: "Russian", nativeName: "Русский" },
    { code: "bn", name: "Bengali", nativeName: "বাংলা" },
    { code: "id", name: "Indonesian", nativeName: "Bahasa Indonesia" },
    { code: "ur", name: "Urdu", nativeName: "اردو" },
    { code: "tr", name: "Turkish", nativeName: "Türkçe" },
    { code: "it", name: "Italian", nativeName: "Italiano" },
    { code: "ko", name: "Korean", nativeName: "한국어" },
    { code: "vi", name: "Vietnamese", nativeName: "Tiếng Việt" },
    { code: "fa", name: "Persian", nativeName: "فارسی" },
    { code: "sw", name: "Swahili", nativeName: "Kiswahili" },
    { code: "nl", name: "Dutch", nativeName: "Nederlands" },
    { code: "th", name: "Thai", nativeName: "ไทย" },
    { code: "ms", name: "Malay", nativeName: "Bahasa Melayu" },
    { code: "uk", name: "Ukrainian", nativeName: "Українська" },
    { code: "ta", name: "Tamil", nativeName: "தமிழ்" },
    { code: "mr", name: "Marathi", nativeName: "मराठी" },
    { code: "pa", name: "Punjabi", nativeName: "ਪੰਜਾਬੀ" },
    { code: "tl", name: "Filipino", nativeName: "Filipino" }
  ];
  const SUPPORTED_LANGUAGE_CODES = new Set(SUPPORTED_LANGUAGES.map((language) => language.code));

  const SAMPLE_SUBTITLES = {
    en_keynote: [
      "1",
      "00:00:01,200 --> 00:00:04,800",
      "Good evening, Dr. Anna Kowalska. Welcome to our live broadcast.",
      "",
      "2",
      "00:00:05,100 --> 00:00:08,900",
      "<i>Thank you for having me in Warsaw today.</i>",
      "",
      "3",
      "00:00:09,300 --> 00:00:13,400",
      "Could you explain how you built the new translation engine",
      "",
      "4",
      "00:00:13,600 --> 00:00:17,250",
      "for real-time video streaming on our platform?",
      "",
      "5",
      "00:00:17,600 --> 00:00:21,500",
      "Were you surprised when latency dropped by fifty percent?",
      "",
      "6",
      "00:00:21,900 --> 00:00:26,400",
      "- Honestly, due to the fact that our team optimized every model layer,",
      "- the results exceeded expectations.",
      "",
      "7",
      "00:00:26,800 --> 00:00:30,500",
      "Hey everyone! Thanks for watching this episode with us.",
      "",
      "8",
      "00:00:30,900 --> 00:00:34,900",
      "Can you test these subtitles in your browser right now?",
      "",
      "9",
      "00:00:35,300 --> 00:00:39,800",
      "At this point in time a large number of viewers are able to switch tracks instantly.",
      "",
      "10",
      "00:00:40,200 --> 00:00:43,900",
      "Visit https://example.com/docs or press <b>CC</b> to begin."
    ].join("\n"),

    pl_interview: [
      "1",
      "00:00:01,000 --> 00:00:04,500",
      "Dzień dobry, Panie Marku. Witamy w naszym studiu w Warszawie.",
      "",
      "2",
      "00:00:04,800 --> 00:00:08,600",
      "Czy może Pan opowiedzieć, jak powstał ten projekt wideo?",
      "",
      "3",
      "00:00:09,000 --> 00:00:13,200",
      "Ze względu na to, że w chwili obecnej publikujemy filmy codziennie,",
      "",
      "4",
      "00:00:13,500 --> 00:00:17,400",
      "potrzebowaliśmy automatycznego systemu napisów dla widzów.",
      "",
      "5",
      "00:00:17,800 --> 00:00:21,600",
      "<i>Cześć wszystkim! Wybierzcie język napisów bezpośrednio w odtwarzaczu.</i>",
      "",
      "6",
      "00:00:22,000 --> 00:00:25,500",
      "Dziękujemy za uwagę i do zobaczenia w kolejnym odcinku!"
    ].join("\n"),

    vertical_short: [
      "1",
      "00:00:00,800 --> 00:00:04,200",
      "Hey everyone! Watching vertical shorts on your phone?",
      "",
      "2",
      "00:00:04,500 --> 00:00:08,800",
      "Can you switch between Polish and English subtitles in one tap?",
      "",
      "3",
      "00:00:09,100 --> 00:00:13,500",
      "<i>Every line stays under 42 characters so text never overflows!</i>",
      "",
      "4",
      "00:00:13,800 --> 00:00:17,600",
      "Tap <b>Polski (CC)</b> below the player to try it right now."
    ].join("\n")
  };

  const VIDEO_CATALOG = {
    keynote: {
      id: "keynote",
      aspect: "16:9",
      videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4",
      subtitleFilename: "sample_keynote_en.srt",
      subtitlesRaw: SAMPLE_SUBTITLES.en_keynote,
      title: {
        en: "AI Localization Keynote: Real-Time Streaming Architecture",
        pl: "Prezentacja AI Localization: Architektura strumieniowania na żywo"
      },
      description: {
        en: "Explore how rolling 5-cue context windows, TokenShield tag protection, and 42-CPL typography deliver broadcast-grade Polish and English subtitles directly in the browser.",
        pl: "Zobacz, jak 5-blokowe okno kontekstu, ochrona znaczników TokenShield oraz limit 42 znaków w linii zapewniają profesjonalne napisy PL i EN bezpośrednio w przeglądarce."
      }
    },
    interview: {
      id: "interview",
      aspect: "16:9",
      videoUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
      subtitleFilename: "sample_interview_pl.srt",
      subtitlesRaw: SAMPLE_SUBTITLES.pl_interview,
      title: {
        en: "Warsaw Studio: Automated Video Captions (PL → EN)",
        pl: "Studio Warszawa: Automatyczne napisy wideo (PL → EN)"
      },
      description: {
        en: "A Polish-language studio conversation translated dynamically into English while binding Polish single-letter prepositions with non-breaking spaces.",
        pl: "Rozmowa w warszawskim studiu tłumaczona dynamicznie na język angielski z twardymi spacjami przy jednoliterowych przyimkach."
      }
    },
    vertical_short: {
      id: "vertical_short",
      aspect: "9:16",
      videoUrl: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
      usePortraitStudio: true,
      subtitleFilename: "vertical_short_en.srt",
      subtitlesRaw: SAMPLE_SUBTITLES.vertical_short,
      title: {
        en: "Mobile Vertical Short: Instant Bilingual Captions (9:16)",
        pl: "Wideo pionowe 9:16: Błyskawiczne napisy dwujęzyczne"
      },
      description: {
        en: "Responsive 9:16 portrait player skin tailored for mobile Reels and Shorts with strict 42-character line wrapping.",
        pl: "Responsywny pionowy odtwarzacz 9:16 zaprojektowany dla formatu Shorts i Reels ze ścisłym limitem 42 znaków w linii."
      }
    }
  };

  const UI_DICTIONARY = {
    en: {
      navTagline: "Bilingual Video Hub • EN ⇄ PL",
      btnCreatorStudio: "Creator Studio",
      subtitlesLabel: "Subtitles:",
      liveCaptionHeading: "Live audio captions",
      liveCaptionDescription: "Transcribe speech and translate it into subtitles while this video plays.",
      liveCaptionIdle: "Not listening",
      liveCaptionListening: "Listening and translating…",
      liveCaptionNoSpeech: "No speech heard yet — check the audio source and volume.",
      liveCaptionUsingMicFallback: "Tab audio recognition unavailable; listening through microphone.",
      recognizedSpeechLabel: "Heard:",
      liveCaptionStopping: "Stopping…",
      spokenLanguageLabel: "Spoken language",
      captionLanguageLabel: "Subtitle language",
      audioSourceLabel: "Audio source",
      audioSourceTab: "This browser tab’s audio",
      audioSourceMic: "Microphone / speakers",
      btnStartListening: "Start live captions",
      btnStopListening: "Stop live captions",
      liveCaptionPrivacy: "For subtitles over the anime, play its video in this player and share this tab with audio enabled. Microphone mode hears nearby speakers. Browser speech recognition and the selected translation provider may process audio or transcript data online.",
      liveCaptionUnsupported: "Live speech recognition is not available in this browser. Try a current version of Chrome or Edge.",
      liveCaptionNetworkError: "The browser speech-recognition service could not be reached. Check your internet connection and try again.",
      liveCaptionAudioError: "No usable audio input was found. Check the shared tab or microphone permission.",
      liveCaptionLanguageError: "This browser speech service does not support the selected spoken language.",
      liveCaptionNoTabAudio: "No tab audio was shared. Choose this tab and enable Share tab audio, or use microphone mode with speakers.",
      liveCaptionTabUnsupported: "This browser cannot send shared-tab audio to speech recognition. Choose Microphone / speakers, or try an up-to-date Chrome build that supports audio-track recognition.",
      liveCaptionTranslated: "Live captions are active.",
      liveCaptionTranslationFailed: "Speech was recognized, but translation failed. Check your connection or translation provider.",
      captionsOff: "Off",
      moreLanguages: "More languages…",
      badgeCached: "Instant Cache",
      btnTheater: "Theater",
      featuredVideosHeading: "Featured Streams",
      card1Title: "AI Localization Keynote: Live Broadcast",
      card1Sub: "Formal “Pani” & group “wy” context shift",
      card2Title: "Warsaw Studio: Automated Video Captions",
      card2Sub: "Polish source captions translated to English",
      card3Title: "Mobile Short: Instant Bilingual Captions",
      card3Sub: "Vertical 9:16 portrait framing & quick CC toggle",
      transcriptHeading: "Interactive Transcript",
      studioTitle: "Creator Dashboard & Localization Studio",
      btnCloseStudio: "Back to Viewer",
      tabIngest: "1. Upload & Translate",
      tabSettings: "2. API Keys & Cache",
      tabInspector: "3. WebVTT Diagnostics",
      ingestHeading: "Media & Subtitle Ingestion",
      btnOfflineStream: "Use Offline Studio Stream",
      dropVideoTitle: "Load Local Video",
      dropVideoHint: "Drop .mp4 / .webm or click",
      dropSubTitle: "Load Subtitle File",
      dropSubHint: "Drop .srt / .vtt or click",
      videoUrlPlaceholder: "Paste public .mp4 / .webm video URL...",
      btnLoadUrl: "Load URL",
      registerHeading: "Tone / Register (Polish Grammar Context)",
      regAutoTitle: "Auto (5-Cue Context)",
      regAutoDesc: "Infers Pan / Pani / wy from dialogue",
      regFemTitle: "Formal Feminine",
      regFemDesc: "Polite “Pani” + feminine verbs",
      regMascTitle: "Formal Masculine",
      regMascDesc: "Polite “Pan” + masculine verbs",
      regPluralTitle: "Informal Plural",
      regPluralDesc: "Group “wy” (możecie / wasz)",
      sourceEditorHeading: "Source Subtitles (.srt or .vtt)",
      btnTranslateNow: "Translate & Publish EN / PL Tracks",
      btnBypassCache: "Re-run (Bypass Cache)",
      apiSettingsHeading: "Client-Side Translation Provider & API Keys",
      providerLabel: "Translation Endpoint Mode",
      apiKeyLabel: "Optional Free API Key / MyMemory Email",
      corsProxyLabel: "Optional Custom Endpoint or CORS Proxy Prefix",
      btnReset: "Reset Defaults",
      btnSave: "Save & Apply",
      cacheSectionHeading: "Sub-Second Offline Subtitle Cache",
      cacheSectionDesc:
        "Maps video & subtitle fingerprints in localStorage/memory so previously translated videos load instantaneously in <1ms without network calls.",
      btnClearCache: "Clear Subtitle Cache",
      toastFallbackTitle: "Switched to Offline Smart Dictionary",
      toastFallbackMsg:
        "Public translation API was unreachable or rate-limited. Subtitles were translated locally without interruption.",
      toastCacheClearedTitle: "Subtitle Cache Cleared",
      toastCacheClearedMsg: "All cached WebVTT tracks have been removed from localStorage.",
      toastTranslatedTitle: "Subtitles Ready",
      toastTranslatedMsg: "English & Polish WebVTT tracks are active in the player.",
      prefIndicatorPrefix: "Saved CC"
    },
    pl: {
      navTagline: "Dwujęzyczna Platforma Wideo • PL ⇄ EN",
      btnCreatorStudio: "Panel Twórcy",
      subtitlesLabel: "Napisy:",
      liveCaptionHeading: "Napisy na żywo z dźwięku",
      liveCaptionDescription: "Rozpoznawaj mowę i tłumacz ją na napisy podczas odtwarzania filmu.",
      liveCaptionIdle: "Nie nasłuchuje",
      liveCaptionListening: "Nasłuchiwanie i tłumaczenie…",
      liveCaptionNoSpeech: "Nie słychać mowy — sprawdź źródło i głośność dźwięku.",
      liveCaptionUsingMicFallback: "Rozpoznawanie dźwięku karty niedostępne; nasłuchiwanie przez mikrofon.",
      recognizedSpeechLabel: "Rozpoznano:",
      liveCaptionStopping: "Zatrzymywanie…",
      spokenLanguageLabel: "Język mówiony",
      captionLanguageLabel: "Język napisów",
      audioSourceLabel: "Źródło dźwięku",
      audioSourceTab: "Dźwięk z tej karty przeglądarki",
      audioSourceMic: "Mikrofon / głośniki",
      btnStartListening: "Włącz napisy na żywo",
      btnStopListening: "Zatrzymaj napisy na żywo",
      liveCaptionPrivacy: "Aby wyświetlać napisy na anime, odtwórz film w tym odtwarzaczu i udostępnij dźwięk tej karty. Tryb mikrofonu nasłuchuje pobliskich głośników. Przeglądarka i dostawca tłumaczeń mogą przetwarzać dźwięk lub transkrypcję online.",
      liveCaptionUnsupported: "Rozpoznawanie mowy na żywo nie jest dostępne w tej przeglądarce. Użyj aktualnej wersji Chrome lub Edge.",
      liveCaptionNetworkError: "Nie można połączyć się z usługą rozpoznawania mowy przeglądarki. Sprawdź internet i spróbuj ponownie.",
      liveCaptionAudioError: "Brak działającego źródła dźwięku. Sprawdź udostępnioną kartę lub dostęp do mikrofonu.",
      liveCaptionLanguageError: "Usługa rozpoznawania mowy przeglądarki nie obsługuje wybranego języka.",
      liveCaptionNoTabAudio: "Nie udostępniono dźwięku karty. Wybierz tę kartę i włącz udostępnianie dźwięku albo użyj mikrofonu i głośników.",
      liveCaptionTabUnsupported: "Ta przeglądarka nie przekazuje dźwięku karty do rozpoznawania mowy. Wybierz mikrofon i głośniki albo zaktualizowaną wersję Chrome z obsługą ścieżki audio.",
      liveCaptionTranslated: "Napisy na żywo są aktywne.",
      liveCaptionTranslationFailed: "Rozpoznano mowę, ale tłumaczenie się nie powiodło. Sprawdź połączenie lub dostawcę tłumaczeń.",
      captionsOff: "Wyłącz",
      moreLanguages: "Więcej języków…",
      badgeCached: "Pamięć podręczna",
      btnTheater: "Tryb kinowy",
      featuredVideosHeading: "Polecane materiały",
      card1Title: "Prezentacja AI Localization: Transmisja na żywo",
      card1Sub: "Zmiana rejestru „Pani” → „wy” w oknie 5 kwestii",
      card2Title: "Studio Warszawa: Automatyczne napisy wideo",
      card2Sub: "Polskie napisy źródłowe tłumaczone na angielski",
      card3Title: "Wideo pionowe 9:16: Szybkie napisy mobilne",
      card3Sub: "Format pionowy Shorts oraz przełącznik CC",
      transcriptHeading: "Interaktywny transkrypt",
      studioTitle: "Panel Twórcy i Studio Lokalizacji",
      btnCloseStudio: "Wróć do odtwarzacza",
      tabIngest: "1. Wgraj i przetłumacz",
      tabSettings: "2. Klucze API i Cache",
      tabInspector: "3. Diagnostyka WebVTT",
      ingestHeading: "Wgrywanie wideo i napisów",
      btnOfflineStream: "Strumień studyjny Offline",
      dropVideoTitle: "Wybierz plik wideo",
      dropVideoHint: "Upuść .mp4 / .webm lub kliknij",
      dropSubTitle: "Wybierz plik napisów",
      dropSubHint: "Upuść .srt / .vtt lub kliknij",
      videoUrlPlaceholder: "Wklej publiczny adres URL wideo .mp4 / .webm...",
      btnLoadUrl: "Wczytaj URL",
      registerHeading: "Ton / Rejestr (Kontekst gramatyczny PL)",
      regAutoTitle: "Auto (Kontekst 5 kwestii)",
      regAutoDesc: "Wykrywa Pan / Pani / wy z dialogu",
      regFemTitle: "Formalny żeński (Pani)",
      regFemDesc: "Zwrot grzecznościowy „Pani”",
      regMascTitle: "Formalny męski (Pan)",
      regMascDesc: "Zwrot grzecznościowy „Pan”",
      regPluralTitle: "Nieformalny mnogi (wy)",
      regPluralDesc: "Zwrot do grupy „wy” (możecie / wasz)",
      sourceEditorHeading: "Źródłowe napisy (.srt lub .vtt)",
      btnTranslateNow: "Przetłumacz i opublikuj ścieżki PL / EN",
      btnBypassCache: "Przetłumacz ponownie (bez cache)",
      apiSettingsHeading: "Silnik tłumaczeń i opcjonalne klucze API",
      providerLabel: "Tryb dostawcy tłumaczeń",
      apiKeyLabel: "Opcjonalny darmowy klucz API / e-mail MyMemory",
      corsProxyLabel: "Opcjonalny adres endpointu lub prefiks CORS Proxy",
      btnReset: "Przywróć domyślne",
      btnSave: "Zapisz ustawienia",
      cacheSectionHeading: "Błyskawiczna pamięć podręczna napisów",
      cacheSectionDesc:
        "Zapisuje skróty wideo i napisów w localStorage, ładując przetłumaczone ścieżki WebVTT w <1 ms bez zapytań sieciowych.",
      btnClearCache: "Wyczyść pamięć podręczną",
      toastFallbackTitle: "Przełączono na Słownik Offline",
      toastFallbackMsg:
        "Publiczne API tłumaczeń było niedostępne lub przekroczono limit zapytań. Napisy przetłumaczono lokalnie bez przerw.",
      toastCacheClearedTitle: "Wyczyszczono pamięć podręczną",
      toastCacheClearedMsg: "Zapisane ścieżki WebVTT zostały usunięte z przeglądarki.",
      toastTranslatedTitle: "Napisy gotowe",
      toastTranslatedMsg: "Ścieżki Polski i English są aktywne w odtwarzaczu.",
      prefIndicatorPrefix: "Preferowane CC"
    }
  };

  /* ==========================================================================
   * 2. OFFLINE SMART DICTIONARY & PHRASE LEXICON
   * ========================================================================== */

  const OFFLINE_MEMORY_EN_TO_PL = {
    "good evening, dr. anna kowalska. welcome to our live broadcast.": {
      default: "Dobry wieczór, Pani Doktor Anno Kowalska. Witamy w naszej transmisji na żywo."
    },
    "thank you for having me in warsaw today.": {
      default: "Dziękuję za dzisiejsze zaproszenie do Warszawy."
    },
    "could you explain how you built the new translation engine": {
      formal_fem: "Czy mogłaby Pani wyjaśnić, jak zbudowała Pani nowy silnik tłumaczeń",
      formal_masc: "Czy mógłby Pan wyjaśnić, jak zbudował Pan nowy silnik tłumaczeń",
      informal_plural: "Czy moglibyście wyjaśnić, jak zbudowaliście nowy silnik tłumaczeń",
      default: "Czy możesz wyjaśnić, jak zbudowałeś nowy silnik tłumaczeń"
    },
    "for real-time video streaming on our platform?": {
      default: "do strumieniowania wideo w czasie rzeczywistym na naszej platformie?"
    },
    "were you surprised when latency dropped by fifty percent?": {
      formal_fem: "Czy była Pani zaskoczona, gdy opóźnienie spadło o 50%?",
      formal_masc: "Czy był Pan zaskoczony, gdy opóźnienie spadło o 50%?",
      informal_plural: "Czy byliście zaskoczeni, gdy opóźnienie spadło o 50%?",
      default: "Czy byłeś zaskoczony, gdy opóźnienie spadło o 50%?"
    },
    "were you surprised when latency dropped by 50%?": {
      formal_fem: "Czy była Pani zaskoczona, gdy opóźnienie spadło o 50%?",
      formal_masc: "Czy był Pan zaskoczony, gdy opóźnienie spadło o 50%?",
      informal_plural: "Czy byliście zaskoczeni, gdy opóźnienie spadło o 50%?",
      default: "Czy byłeś zaskoczony, gdy opóźnienie spadło o 50%?"
    },
    "honestly, due to the fact that our team optimized every model layer,": {
      default: "Szczerze mówiąc, ponieważ nasz zespół zoptymalizował każdą warstwę,"
    },
    "the results exceeded expectations.": {
      default: "wyniki przerosły oczekiwania."
    },
    "hey everyone! thanks for watching this episode with us.": {
      default: "Cześć wszystkim! Dziękujemy za oglądanie tego odcinka z nami."
    },
    "can you test these subtitles in your browser right now?": {
      formal_fem: "Czy może Pani teraz przetestować te napisy w swojej przeglądarce?",
      formal_masc: "Czy może Pan teraz przetestować te napisy w swojej przeglądarce?",
      informal_plural: "Czy możecie teraz przetestować te napisy w waszej przeglądarce?",
      default: "Czy możesz teraz przetestować te napisy w twojej przeglądarce?"
    },
    "at this point in time a large number of viewers are able to switch tracks instantly.": {
      default: "Teraz wielu widzów może natychmiast przełączać ścieżki."
    },
    "visit ⟦t0⟧ or press ⟦t1⟧cc⟦t2⟧ to begin.": {
      formal_fem: "Proszę odwiedzić ⟦T0⟧ lub kliknąć ⟦T1⟧CC⟦T2⟧, aby zacząć.",
      formal_masc: "Proszę odwiedzić ⟦T0⟧ lub kliknąć ⟦T1⟧CC⟦T2⟧, aby zacząć.",
      informal_plural: "Odwiedźcie ⟦T0⟧ lub kliknijcie ⟦T1⟧CC⟦T2⟧, aby zacząć.",
      default: "Odwiedź ⟦T0⟧ lub naciśnij ⟦T1⟧CC⟦T2⟧, aby zacząć."
    },
    "hey everyone! watching vertical shorts on your phone?": {
      default: "Cześć wszystkim! Oglądacie pionowe wideo na telefonie?"
    },
    "can you switch between polish and english subtitles in one tap?": {
      formal_fem: "Czy może Pani przełączać napisy polskie i angielskie jednym dotknięciem?",
      formal_masc: "Czy może Pan przełączać napisy polskie i angielskie jednym dotknięciem?",
      informal_plural: "Czy możecie przełączać napisy polskie i angielskie jednym dotknięciem?",
      default: "Czy możesz przełączać napisy polskie i angielskie jednym dotknięciem?"
    },
    "every line stays under 42 characters so text never overflows!": {
      default: "Każda linia ma poniżej 42 znaków, więc tekst zawsze się mieści!"
    },
    "tap ⟦t0⟧polski (cc)⟦t1⟧ below the player to try it right now.": {
      informal_plural: "Kliknijcie ⟦T0⟧Polski (CC)⟦T1⟧ pod odtwarzaczem, aby sprawdzić teraz.",
      default: "Kliknij ⟦T0⟧Polski (CC)⟦T1⟧ pod odtwarzaczem, aby sprawdzić teraz."
    }
  };

  const OFFLINE_MEMORY_PL_TO_EN = {
    "dzień dobry, panie marku. witamy w naszym studiu w warszawie.": {
      default: "Good morning, Mr. Marek. Welcome to our studio in Warsaw."
    },
    "czy może pan opowiedzieć, jak powstał ten projekt wideo?": {
      default: "Could you tell us how this video project started?"
    },
    "ze względu na to, że w chwili obecnej publikujemy filmy codziennie,": {
      default: "Because right now we publish videos daily,"
    },
    "potrzebowaliśmy automatycznego systemu napisów dla widzów.": {
      default: "we needed an automated subtitle system for our viewers."
    },
    "cześć wszystkim! wybierzcie język napisów bezpośrednio w odtwarzaczu.": {
      default: "Hey everyone! Choose your subtitle language right in the player."
    },
    "dziękujemy za uwagę i do zobaczenia w kolejnym odcinku!": {
      default: "Thank you for watching and see you in the next episode!"
    }
  };

  // Reliable no-network phrase memory for the bundled demo episodes. This keeps
  // the visible Japanese, Simplified Chinese, German, Spanish, and French tracks
  // genuinely translated even when browser-facing public APIs are unavailable.
  const OFFLINE_MEMORY_MULTILINGUAL = {
    en: {
      de: {
        "good evening, dr. anna kowalska. welcome to our live broadcast.": "Guten Abend, Frau Dr. Anna Kowalska. Willkommen zu unserer Liveübertragung.",
        "thank you for having me in warsaw today.": "Vielen Dank, dass ich heute in Warschau sein darf.",
        "could you explain how you built the new translation engine": "Könnten Sie erklären, wie Sie die neue Übersetzungs-Engine entwickelt haben",
        "for real-time video streaming on our platform?": "für das Echtzeit-Video-Streaming auf unserer Plattform?",
        "were you surprised when latency dropped by fifty percent?": "Waren Sie überrascht, als die Latenz um fünfzig Prozent sank?",
        "honestly, due to the fact that our team optimized every model layer,": "Ehrlich gesagt: Unser Team hat jede Modellebene optimiert,",
        "the results exceeded expectations.": "und die Ergebnisse haben unsere Erwartungen übertroffen.",
        "hey everyone! thanks for watching this episode with us.": "Hallo zusammen! Danke, dass ihr diese Folge mit uns gesehen habt.",
        "can you test these subtitles in your browser right now?": "Können Sie diese Untertitel jetzt in Ihrem Browser testen?",
        "at this point in time a large number of viewers are able to switch tracks instantly.": "Inzwischen können viele Zuschauer sofort zwischen den Spuren wechseln.",
        "visit ⟦t0⟧ or press ⟦t1⟧cc⟦t2⟧ to begin.": "Besuchen Sie ⟦T0⟧ oder drücken Sie ⟦T1⟧CC⟦T2⟧, um zu beginnen.",
        "hey everyone! watching vertical shorts on your phone?": "Hallo zusammen! Seht ihr euch Hochkantvideos auf dem Handy an?",
        "can you switch between polish and english subtitles in one tap?": "Könnt ihr mit einem Fingertipp zwischen polnischen und englischen Untertiteln wechseln?",
        "every line stays under 42 characters so text never overflows!": "Jede Zeile bleibt unter 42 Zeichen, damit der Text nicht überläuft!",
        "tap ⟦t0⟧polski (cc)⟦t1⟧ below the player to try it right now.": "Tippe unten im Player auf ⟦T0⟧Polski (CC)⟦T1⟧ und probiere es gleich aus."
      },
      ja: {
        "good evening, dr. anna kowalska. welcome to our live broadcast.": "アンナ・コワルスカ博士、こんばんは。ライブ配信へようこそ。",
        "thank you for having me in warsaw today.": "本日はワルシャワにお招きいただき、ありがとうございます。",
        "could you explain how you built the new translation engine": "新しい翻訳エンジンをどのように開発したのか、説明していただけますか",
        "for real-time video streaming on our platform?": "このプラットフォームでリアルタイム動画配信を実現するために？",
        "were you surprised when latency dropped by fifty percent?": "遅延が50パーセント減ったとき、驚きましたか？",
        "honestly, due to the fact that our team optimized every model layer,": "率直に言うと、チームがモデルのすべての層を最適化した結果、",
        "the results exceeded expectations.": "期待を上回る成果が得られました。",
        "hey everyone! thanks for watching this episode with us.": "皆さん、ご視聴ありがとうございます。一緒にこのエピソードを楽しんでいただけましたか。",
        "can you test these subtitles in your browser right now?": "今すぐブラウザーでこの字幕を試せますか？",
        "at this point in time a large number of viewers are able to switch tracks instantly.": "今では多くの視聴者が字幕トラックをすぐに切り替えられます。",
        "visit ⟦t0⟧ or press ⟦t1⟧cc⟦t2⟧ to begin.": "⟦T0⟧にアクセスするか、⟦T1⟧CC⟦T2⟧を押して始めてください。",
        "hey everyone! watching vertical shorts on your phone?": "皆さん、スマートフォンで縦型ショート動画を見ていますか？",
        "can you switch between polish and english subtitles in one tap?": "ワンタップでポーランド語と英語の字幕を切り替えられますか？",
        "every line stays under 42 characters so text never overflows!": "各行は42文字以内なので、字幕が画面からはみ出しません！",
        "tap ⟦t0⟧polski (cc)⟦t1⟧ below the player to try it right now.": "プレーヤーの下にある⟦T0⟧Polski (CC)⟦T1⟧をタップして、今すぐ試してください。"
      },
      "zh-CN": {
        "good evening, dr. anna kowalska. welcome to our live broadcast.": "晚上好，安娜·科瓦尔斯卡博士。欢迎收看我们的现场直播。",
        "thank you for having me in warsaw today.": "感谢您今天邀请我来到华沙。",
        "could you explain how you built the new translation engine": "您能介绍一下新翻译引擎是如何开发的吗",
        "for real-time video streaming on our platform?": "它如何在我们的平台上实现实时视频流传输？",
        "were you surprised when latency dropped by fifty percent?": "延迟降低百分之五十时，您感到惊讶吗？",
        "honestly, due to the fact that our team optimized every model layer,": "说实话，由于团队优化了模型的每一层，",
        "the results exceeded expectations.": "最终效果超出了预期。",
        "hey everyone! thanks for watching this episode with us.": "大家好！感谢和我们一起收看本期节目。",
        "can you test these subtitles in your browser right now?": "您现在可以在浏览器中测试这些字幕吗？",
        "at this point in time a large number of viewers are able to switch tracks instantly.": "现在，许多观众都可以即时切换字幕轨道。",
        "visit ⟦t0⟧ or press ⟦t1⟧cc⟦t2⟧ to begin.": "访问⟦T0⟧，或按⟦T1⟧CC⟦T2⟧开始。",
        "hey everyone! watching vertical shorts on your phone?": "大家好！你正在手机上观看竖屏短视频吗？",
        "can you switch between polish and english subtitles in one tap?": "只需轻点一下，就能切换波兰语和英语字幕吗？",
        "every line stays under 42 characters so text never overflows!": "每行不超过42个字符，字幕不会溢出屏幕！",
        "tap ⟦t0⟧polski (cc)⟦t1⟧ below the player to try it right now.": "点击播放器下方的⟦T0⟧Polski (CC)⟦T1⟧，立即体验。"
      },
      es: {
        "good evening, dr. anna kowalska. welcome to our live broadcast.": "Buenas tardes, doctora Anna Kowalska. Le damos la bienvenida a nuestra transmisión en directo.",
        "thank you for having me in warsaw today.": "Gracias por invitarme hoy a Varsovia.",
        "could you explain how you built the new translation engine": "¿Podría explicar cómo desarrollaron el nuevo motor de traducción",
        "for real-time video streaming on our platform?": "para transmitir vídeo en tiempo real en nuestra plataforma?",
        "were you surprised when latency dropped by fifty percent?": "¿Le sorprendió que la latencia bajara un cincuenta por ciento?",
        "honestly, due to the fact that our team optimized every model layer,": "Sinceramente, como nuestro equipo optimizó cada capa del modelo,",
        "the results exceeded expectations.": "los resultados superaron las expectativas.",
        "hey everyone! thanks for watching this episode with us.": "¡Hola a todos! Gracias por ver este episodio con nosotros.",
        "can you test these subtitles in your browser right now?": "¿Puede probar estos subtítulos ahora mismo en su navegador?",
        "at this point in time a large number of viewers are able to switch tracks instantly.": "Ahora muchos espectadores pueden cambiar de pista al instante.",
        "visit ⟦t0⟧ or press ⟦t1⟧cc⟦t2⟧ to begin.": "Visite ⟦T0⟧ o pulse ⟦T1⟧CC⟦T2⟧ para empezar.",
        "hey everyone! watching vertical shorts on your phone?": "¡Hola a todos! ¿Ven vídeos verticales cortos en el móvil?",
        "can you switch between polish and english subtitles in one tap?": "¿Puedes cambiar entre subtítulos en polaco e inglés con un solo toque?",
        "every line stays under 42 characters so text never overflows!": "¡Cada línea tiene menos de 42 caracteres para que el texto no se desborde!",
        "tap ⟦t0⟧polski (cc)⟦t1⟧ below the player to try it right now.": "Pulsa ⟦T0⟧Polski (CC)⟦T1⟧ debajo del reproductor para probarlo ahora."
      },
      fr: {
        "good evening, dr. anna kowalska. welcome to our live broadcast.": "Bonsoir, docteure Anna Kowalska. Bienvenue dans notre émission en direct.",
        "thank you for having me in warsaw today.": "Merci de m'accueillir aujourd'hui à Varsovie.",
        "could you explain how you built the new translation engine": "Pourriez-vous expliquer comment vous avez conçu le nouveau moteur de traduction",
        "for real-time video streaming on our platform?": "pour la diffusion vidéo en temps réel sur notre plateforme ?",
        "were you surprised when latency dropped by fifty percent?": "Avez-vous été surprise lorsque la latence a diminué de cinquante pour cent ?",
        "honestly, due to the fact that our team optimized every model layer,": "Pour être honnête, comme notre équipe a optimisé chaque couche du modèle,",
        "the results exceeded expectations.": "les résultats ont dépassé nos attentes.",
        "hey everyone! thanks for watching this episode with us.": "Bonjour à toutes et à tous ! Merci d'avoir regardé cet épisode avec nous.",
        "can you test these subtitles in your browser right now?": "Pouvez-vous tester ces sous-titres dans votre navigateur dès maintenant ?",
        "at this point in time a large number of viewers are able to switch tracks instantly.": "Désormais, de nombreux spectateurs peuvent changer de piste instantanément.",
        "visit ⟦t0⟧ or press ⟦t1⟧cc⟦t2⟧ to begin.": "Visitez ⟦T0⟧ ou appuyez sur ⟦T1⟧CC⟦T2⟧ pour commencer.",
        "hey everyone! watching vertical shorts on your phone?": "Bonjour ! Vous regardez des vidéos courtes verticales sur votre téléphone ?",
        "can you switch between polish and english subtitles in one tap?": "Peux-tu passer des sous-titres polonais aux sous-titres anglais en un geste ?",
        "every line stays under 42 characters so text never overflows!": "Chaque ligne reste sous 42 caractères pour éviter tout débordement !",
        "tap ⟦t0⟧polski (cc)⟦t1⟧ below the player to try it right now.": "Appuyez sur ⟦T0⟧Polski (CC)⟦T1⟧ sous le lecteur pour essayer tout de suite."
      }
    },
    pl: {
      de: {
        "dzień dobry, panie marku. witamy w naszym studiu w warszawie.": "Guten Tag, Herr Marek. Willkommen in unserem Studio in Warschau.",
        "czy może pan opowiedzieć, jak powstał ten projekt wideo?": "Könnten Sie erzählen, wie dieses Videoprojekt entstanden ist?",
        "ze względu na to, że w chwili obecnej publikujemy filmy codziennie,": "Da wir derzeit täglich Videos veröffentlichen,",
        "potrzebowaliśmy automatycznego systemu napisów dla widzów.": "brauchten wir ein automatisches Untertitelsystem für unsere Zuschauer.",
        "cześć wszystkim! wybierzcie język napisów bezpośrednio w odtwarzaczu.": "Hallo zusammen! Wählt die Untertitelsprache direkt im Player.",
        "dziękujemy za uwagę i do zobaczenia w kolejnym odcinku!": "Vielen Dank fürs Zuschauen. Bis zur nächsten Folge!"
      },
      ja: {
        "dzień dobry, panie marku. witamy w naszym studiu w warszawie.": "マレクさん、こんにちは。ワルシャワのスタジオへようこそ。",
        "czy może pan opowiedzieć, jak powstał ten projekt wideo?": "この動画プロジェクトがどのように始まったのか、教えていただけますか？",
        "ze względu na to, że w chwili obecnej publikujemy filmy codziennie,": "現在、毎日動画を公開しているため、",
        "potrzebowaliśmy automatycznego systemu napisów dla widzów.": "視聴者向けの自動字幕システムが必要でした。",
        "cześć wszystkim! wybierzcie język napisów bezpośrednio w odtwarzaczu.": "皆さん、こんにちは！プレーヤーで字幕の言語を選んでください。",
        "dziękujemy za uwagę i do zobaczenia w kolejnym odcinku!": "ご視聴ありがとうございました。また次回お会いしましょう！"
      },
      "zh-CN": {
        "dzień dobry, panie marku. witamy w naszym studiu w warszawie.": "早上好，马雷克先生。欢迎来到我们在华沙的演播室。",
        "czy może pan opowiedzieć, jak powstał ten projekt wideo?": "您能介绍一下这个视频项目是如何开始的吗？",
        "ze względu na to, że w chwili obecnej publikujemy filmy codziennie,": "由于我们目前每天都会发布视频，",
        "potrzebowaliśmy automatycznego systemu napisów dla widzów.": "我们需要一套面向观众的自动字幕系统。",
        "cześć wszystkim! wybierzcie język napisów bezpośrednio w odtwarzaczu.": "大家好！请直接在播放器中选择字幕语言。",
        "dziękujemy za uwagę i do zobaczenia w kolejnym odcinku!": "感谢收看，我们下期再见！"
      },
      es: {
        "dzień dobry, panie marku. witamy w naszym studiu w warszawie.": "Buenos días, señor Marek. Le damos la bienvenida a nuestro estudio en Varsovia.",
        "czy może pan opowiedzieć, jak powstał ten projekt wideo?": "¿Podría contarnos cómo empezó este proyecto de vídeo?",
        "ze względu na to, że w chwili obecnej publikujemy filmy codziennie,": "Como actualmente publicamos vídeos todos los días,",
        "potrzebowaliśmy automatycznego systemu napisów dla widzów.": "necesitábamos un sistema automático de subtítulos para nuestros espectadores.",
        "cześć wszystkim! wybierzcie język napisów bezpośrednio w odtwarzaczu.": "¡Hola a todos! Elijan el idioma de los subtítulos directamente en el reproductor.",
        "dziękujemy za uwagę i do zobaczenia w kolejnym odcinku!": "¡Gracias por acompañarnos y hasta el próximo episodio!"
      },
      fr: {
        "dzień dobry, panie marku. witamy w naszym studiu w warszawie.": "Bonjour, monsieur Marek. Bienvenue dans notre studio à Varsovie.",
        "czy może pan opowiedzieć, jak powstał ten projekt wideo?": "Pourriez-vous nous raconter comment ce projet vidéo a vu le jour ?",
        "ze względu na to, że w chwili obecnej publikujemy filmy codziennie,": "Comme nous publions actuellement des vidéos tous les jours,",
        "potrzebowaliśmy automatycznego systemu napisów dla widzów.": "nous avions besoin d'un système de sous-titrage automatique pour notre public.",
        "cześć wszystkim! wybierzcie język napisów bezpośrednio w odtwarzaczu.": "Bonjour à tous ! Choisissez la langue des sous-titres directement dans le lecteur.",
        "dziękujemy za uwagę i do zobaczenia w kolejnym odcinku!": "Merci de votre attention et à bientôt pour un prochain épisode !"
      }
    }
  };

  const PHRASE_LEXICON_EN_PL = [
    ["good morning", "dzień dobry"],
    ["good evening", "dobry wieczór"],
    ["welcome to", "witamy w"],
    ["thank you for watching", "dziękujemy za oglądanie"],
    ["thank you", "dziękuję"],
    ["thanks", "dzięki"],
    ["could you explain", "czy możesz wyjaśnić"],
    ["could you", "czy możesz"],
    ["can you", "czy możesz"],
    ["were you surprised", "czy byłeś zaskoczony"],
    ["are you ready", "czy jesteś gotowy"],
    ["translation engine", "silnik tłumaczeń"],
    ["video player", "odtwarzacz wideo"],
    ["live broadcast", "transmisja na żywo"],
    ["in real time", "w czasie rzeczywistym"],
    ["right now", "teraz"],
    ["subtitles", "napisy"],
    ["subtitle", "napis"],
    ["browser", "przeglądarka"],
    ["hello", "cześć"]
  ];

  const PHRASE_LEXICON_PL_EN = [
    ["dzień dobry", "good morning"],
    ["dobry wieczór", "good evening"],
    ["cześć wszystkim", "hey everyone"],
    ["witamy w", "welcome to"],
    ["dziękujemy za oglądanie", "thank you for watching"],
    ["dziękujemy", "thank you"],
    ["dziękuję", "thank you"],
    ["czy może pani", "could you"],
    ["czy może pan", "could you"],
    ["czy możecie", "can you"],
    ["czy możesz", "can you"],
    ["silnik tłumaczeń", "translation engine"],
    ["odtwarzacz wideo", "video player"],
    ["w czasie rzeczywistym", "in real time"],
    ["transmisja na żywo", "live broadcast"],
    ["napisy", "subtitles"],
    ["przeglądarka", "browser"],
    ["do zobaczenia", "see you"],
    ["cześć", "hello"]
  ];

  /* ==========================================================================
   * 3. INTELLIGENT AUTO-LOCALIZATION & PERSISTENT PREFERENCES MANAGER
   * ========================================================================== */

  const STORAGE_KEYS = {
    PREFERRED_TRACK: "streampl_preferred_sub_lang_v1",
    UI_LANGUAGE: "streampl_ui_lang_v1",
    THEME: "streampl_theme_v1",
    SETTINGS: "translation_engine_pl_eng_settings_v1",
    SUBTITLE_CACHE: "streampl_vtt_cache_v1"
  };

  const LocalizationManager = {
    STORAGE_KEYS,

    /**
     * Detect whether the viewer's browser locale is Polish (`"pl"`) or should
     * default to English (`"en"`).
     */
    detectBrowserLanguage(nav = typeof navigator !== "undefined" ? navigator : null) {
      if (!nav) return "en";
      const candidates = [];
      if (Array.isArray(nav.languages) && nav.languages.length > 0) candidates.push(...nav.languages);
      if (nav.language) candidates.push(nav.language);
      return candidates.some((locale) => String(locale || "").trim().toLowerCase().startsWith("pl")) ? "pl" : "en";
    },

    detectBrowserSubtitleLanguage(nav = typeof navigator !== "undefined" ? navigator : null) {
      if (!nav) return "en";
      const candidates = [];
      if (Array.isArray(nav.languages) && nav.languages.length > 0) candidates.push(...nav.languages);
      if (nav.language) candidates.push(nav.language);
      for (const locale of candidates) {
        const normalized = String(locale || "").trim().toLowerCase();
        if (normalized.startsWith("zh")) return "zh-CN";
        const match = SUPPORTED_LANGUAGES.find((language) =>
          normalized === language.code.toLowerCase() || normalized.startsWith(`${language.code.toLowerCase()}-`)
        );
        if (match) return match.code;
      }
      return "en";
    },

    /**
     * Resolve initial UI language: user's saved UI toggle if present, otherwise
     * automatic detection via `navigator.language` (Polish -> `"pl"`, else `"en"`).
     */
    resolveUiLanguage(
      storage = typeof localStorage !== "undefined" ? localStorage : null,
      nav = typeof navigator !== "undefined" ? navigator : null
    ) {
      try {
        const saved = storage && storage.getItem(STORAGE_KEYS.UI_LANGUAGE);
        if (saved === "pl" || saved === "en") return saved;
      } catch (_e) {
        // Ignore storage errors
      }
      return LocalizationManager.detectBrowserLanguage(nav);
    },

    saveUiLanguage(lang, storage = typeof localStorage !== "undefined" ? localStorage : null) {
      if (lang !== "pl" && lang !== "en") return;
      try {
        if (storage) storage.setItem(STORAGE_KEYS.UI_LANGUAGE, lang);
      } catch (_e) {
        // Ignore private browsing restrictions
      }
    },

    /**
     * Resolve active subtitle `<track>` language:
     * 1. Saved preference in `localStorage` (`"pl"`, `"en"`, or `"off"`) if present.
     * 2. Otherwise auto-detected browser language (`"pl"` if Polish browser, else `"en"`).
     */
    resolvePreferredSubtitleTrack(
      storage = typeof localStorage !== "undefined" ? localStorage : null,
      nav = typeof navigator !== "undefined" ? navigator : null
    ) {
      try {
        const saved = storage && storage.getItem(STORAGE_KEYS.PREFERRED_TRACK);
        if (SUPPORTED_LANGUAGE_CODES.has(saved) || saved === "off") {
          return { trackLang: saved, source: "saved" };
        }
      } catch (_e) {
        // Ignore storage errors
      }
      const detected = LocalizationManager.detectBrowserSubtitleLanguage(nav);
      return { trackLang: detected, source: "browser" };
    },

    savePreferredSubtitleTrack(
      trackLang,
      storage = typeof localStorage !== "undefined" ? localStorage : null
    ) {
      if (!SUPPORTED_LANGUAGE_CODES.has(trackLang) && trackLang !== "off") return;
      try {
        if (storage) storage.setItem(STORAGE_KEYS.PREFERRED_TRACK, trackLang);
      } catch (_e) {
        // Ignore quota/security exceptions
      }
    },

    t(lang, key) {
      const table = UI_DICTIONARY[lang] || UI_DICTIONARY.en;
      return table[key] || UI_DICTIONARY.en[key] || key;
    }
  };

  /* ==========================================================================
   * 4. SUB-SECOND OFFLINE SUBTITLE CACHE (`SubtitleCacheStore`)
   * ========================================================================== */

  /**
   * Fast deterministic 64-bit FNV-1a-inspired hex hash for video/subtitle keys.
   */
  function hashFingerprint(input) {
    const str = String(input || "");
    let h1 = 0x811c9dc5;
    let h2 = 0xcbf29ce4;
    for (let i = 0; i < str.length; i += 1) {
      const code = str.charCodeAt(i);
      h1 ^= code;
      h1 = Math.imul(h1, 0x01000193) >>> 0;
      h2 ^= code;
      h2 = Math.imul(h2, 0x01000197) >>> 0;
    }
    return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
  }

  class SubtitleCacheStore {
    constructor(options = {}) {
      this.maxEntries = Number(options.maxEntries) || 25;
      this.storageKey = options.storageKey || STORAGE_KEYS.SUBTITLE_CACHE;
      this.storage =
        options.storage !== undefined
          ? options.storage
          : typeof localStorage !== "undefined"
          ? localStorage
          : null;
      this.memoryMap = new Map();
      this.videoIndex = new Map();
      this._hydrateFromStorage();
    }

    _hydrateFromStorage() {
      if (!this.storage) return;
      try {
        const raw = this.storage.getItem(this.storageKey);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const entry of parsed) {
            if (entry && entry.cacheKey && entry.enVtt && entry.plVtt) {
              this.memoryMap.set(entry.cacheKey, entry);
              if (entry.videoKey) {
                this.videoIndex.set(entry.videoKey, entry.cacheKey);
              }
            }
          }
        }
      } catch (_e) {
        // Corrupted localStorage cache is safely ignored
      }
    }

    _persistToStorage() {
      if (!this.storage) return;
      const entries = Array.from(this.memoryMap.values()).sort(
        (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)
      );
      const trimmed = entries.slice(0, this.maxEntries);

      // Evict oldest entries on QuotaExceededError until write succeeds
      while (trimmed.length > 0) {
        try {
          this.storage.setItem(this.storageKey, JSON.stringify(trimmed));
          return;
        } catch (_quotaErr) {
          trimmed.pop();
        }
      }
      try {
        this.storage.removeItem(this.storageKey);
      } catch (_e) {
        // Ignore
      }
    }

    computeKey({
      videoKey = "default-video",
      subtitleName = "subtitles.srt",
      rawText = "",
      registerMode = "auto",
      maxCpl = 42
    }) {
      const normalizedSubs = String(rawText).replace(/\r\n/g, "\n").trim();
      const composite = `${videoKey}|${subtitleName}|${registerMode}|${maxCpl}|${normalizedSubs}`;
      return `vtt_${hashFingerprint(composite)}`;
    }

    get(cacheKey) {
      const hit = this.memoryMap.get(cacheKey);
      if (!hit) return null;
      hit.updatedAt = Date.now();
      return hit;
    }

    getByVideoKey(videoKey) {
      if (!videoKey) return null;
      const key = this.videoIndex.get(videoKey);
      return key ? this.get(key) : null;
    }

    set(cacheKey, record) {
      const payload = {
        ...record,
        cacheKey,
        updatedAt: Date.now()
      };
      this.memoryMap.set(cacheKey, payload);
      if (payload.videoKey) {
        this.videoIndex.set(payload.videoKey, cacheKey);
      }
      if (this.memoryMap.size > this.maxEntries) {
        const oldestKey = Array.from(this.memoryMap.entries()).sort(
          (a, b) => (a[1].updatedAt || 0) - (b[1].updatedAt || 0)
        )[0][0];
        this.memoryMap.delete(oldestKey);
      }
      this._persistToStorage();
      return payload;
    }

    size() {
      return this.memoryMap.size;
    }

    clear() {
      this.memoryMap.clear();
      this.videoIndex.clear();
      if (this.storage) {
        try {
          this.storage.removeItem(this.storageKey);
        } catch (_e) {
          // Ignore
        }
      }
    }
  }

  /* ==========================================================================
   * 5. SUBTITLE PARSER, W3C WEBVTT SERIALIZER & LANGUAGE DETECTOR
   * ========================================================================== */

  const TIMING_LINE_REGEX =
    /^\s*((?:\d{1,2}:)?\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*((?:\d{1,2}:)?\d{2}:\d{2}[,.]\d{1,3})(?:[ \t]+(.*))?$/;

  const INLINE_TAG_STRIP_REGEX = /<[^>]+>|\{\\[^}]+\}/g;

  function visibleCharLength(line) {
    return String(line || "").replace(INLINE_TAG_STRIP_REGEX, "").length;
  }

  function parseTimestampToMs(rawTs) {
    const cleaned = String(rawTs).trim().replace(",", ".");
    const [mainPart, msPart = "0"] = cleaned.split(".");
    const millis = parseInt(msPart.padEnd(3, "0").slice(0, 3), 10);
    const segments = mainPart.split(":").map((n) => parseInt(n, 10));

    let hours = 0;
    let minutes = 0;
    let seconds = 0;
    if (segments.length === 3) {
      [hours, minutes, seconds] = segments;
    } else if (segments.length === 2) {
      [minutes, seconds] = segments;
    } else {
      throw new Error(`Invalid subtitle timestamp: "${rawTs}"`);
    }
    return (hours * 3600 + minutes * 60 + seconds) * 1000 + millis;
  }

  function formatMsTimestamp(totalMs, separator = ".") {
    if (totalMs < 0 || Number.isNaN(totalMs)) {
      throw new Error(`Invalid millisecond timestamp: ${totalMs}`);
    }
    const hours = Math.floor(totalMs / 3600000);
    const rem1 = totalMs % 3600000;
    const minutes = Math.floor(rem1 / 60000);
    const rem2 = rem1 % 60000;
    const seconds = Math.floor(rem2 / 1000);
    const millis = rem2 % 1000;

    const hh = String(hours).padStart(2, "0");
    const mm = String(minutes).padStart(2, "0");
    const ss = String(seconds).padStart(2, "0");
    const mmm = String(millis).padStart(3, "0");
    return `${hh}:${mm}:${ss}${separator}${mmm}`;
  }

  function formatShortTimecode(totalMs) {
    const totalSec = Math.max(0, Math.floor(totalMs / 1000));
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  function parseAssSubtitle(normalized) {
    const lines = normalized.split("\n");
    let eventFormat = [];
    let playResX = 384;
    let playResY = 288;
    let inEvents = false;
    const cues = [];

    for (const line of lines) {
      const trimmed = line.trim();
      const res = /^PlayRes([XY]):\s*(\d+)/i.exec(trimmed);
      if (res) {
        if (res[1].toUpperCase() === "X") playResX = Number(res[2]) || playResX;
        else playResY = Number(res[2]) || playResY;
      }
      if (/^\[Events\]/i.test(trimmed)) { inEvents = true; continue; }
      if (/^\[[^\]]+\]/.test(trimmed)) { inEvents = false; continue; }
      if (!inEvents) continue;
      const formatMatch = /^Format:\s*(.+)$/i.exec(trimmed);
      if (formatMatch) { eventFormat = formatMatch[1].split(",").map((x) => x.trim().toLowerCase()); continue; }
      if (!/^Dialogue:/i.test(trimmed) || !eventFormat.length) continue;

      // ASS dialogue's final Text field may contain commas; preserve them verbatim.
      const raw = trimmed.slice(trimmed.indexOf(":") + 1).trim();
      const columns = raw.split(",");
      if (columns.length < eventFormat.length) continue;
      const fields = {};
      for (let i = 0; i < eventFormat.length; i += 1) {
        fields[eventFormat[i]] = i === eventFormat.length - 1
          ? columns.slice(i).join(",") : columns[i];
      }
      const startMs = parseTimestampToMs(fields.start);
      const endMs = parseTimestampToMs(fields.end);
      let alignment = 2;
      let position = null;
      const formatted = fields.text.replace(/\{([^}]*)\}/g, (_whole, override) => {
        const an = /\\an([1-9])/.exec(override);
        if (an) alignment = Number(an[1]);
        const pos = /\\pos\(\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/.exec(override);
        if (pos) position = { x: Number(pos[1]), y: Number(pos[2]) };
        let markup = "";
        for (const match of override.matchAll(/\\([ibu])([01])/g)) {
          markup += match[2] === "1" ? `<${match[1]}>` : `</${match[1]}>`;
        }
        return markup;
      }).replace(/\\[Nn]/g, "\n").replace(/\\h/g, "\u00a0");
      const row = Math.floor((alignment - 1) / 3);
      const col = (alignment - 1) % 3;
      const linePct = position ? Math.max(0, Math.min(100, position.y / playResY * 100))
        : row === 2 ? 0 : row === 1 ? 50 : 100;
      const positionPct = position ? Math.max(0, Math.min(100, position.x / playResX * 100))
        : col === 0 ? 0 : col === 1 ? 50 : 100;
      const align = col === 0 ? "start" : col === 2 ? "end" : "center";
      const settings = `line:${linePct.toFixed(1)}% position:${positionPct.toFixed(1)}% align:${align}`;
      const timing = Object.freeze({
        startMs, endMs,
        startRaw: fields.start,
        endRaw: fields.end,
        settings
      });
      cues.push({ index: cues.length + 1, identifier: String(cues.length + 1), timing, text: formatted.trim() });
    }
    return {
      cues,
      headerBlocks: cues.length ? ["STYLE\n::cue { font-family: Arial, sans-serif; }"] : [],
      sourceFormat: "ass"
    };
  }

  const SubtitleParser = {
    parseTimestampToMs,
    formatMsTimestamp,
    formatShortTimecode,
    parseASS: parseAssSubtitle,

    parse(rawContent, filenameHint = "") {
      const normalized = String(rawContent || "")
        .replace(/^\uFEFF/, "")
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .trim();

      if (!normalized) {
        return { cues: [], headerBlocks: [], sourceFormat: "srt" };
      }
      if (/\.(?:ass|ssa)$/i.test(String(filenameHint)) || /^\[Script Info\]/im.test(normalized)) {
        return parseAssSubtitle(normalized);
      }

      const isVtt =
        normalized.startsWith("WEBVTT") ||
        String(filenameHint).toLowerCase().endsWith(".vtt");

      const blocks = normalized.split(/\n{2,}/);
      const headerBlocks = [];
      const cues = [];

      blocks.forEach((rawBlock, blockIdx) => {
        let block = rawBlock.trim();
        if (!block) return;

        if (blockIdx === 0 && block.startsWith("WEBVTT")) {
          const lines = block.split("\n");
          const timingIdx = lines.findIndex((ln) => TIMING_LINE_REGEX.test(ln));
          if (timingIdx === -1) {
            if (lines.length > 1) {
              headerBlocks.push(lines.slice(1).join("\n"));
            }
            return;
          }
          block = lines.slice(Math.max(1, timingIdx - 1)).join("\n");
        }

        if (
          isVtt &&
          (block.startsWith("NOTE") ||
            block.startsWith("STYLE") ||
            block.startsWith("REGION"))
        ) {
          headerBlocks.push(block);
          return;
        }

        const lines = block.split("\n");
        let timingLineIdx = -1;
        let match = null;
        for (let i = 0; i < lines.length; i += 1) {
          const m = TIMING_LINE_REGEX.exec(lines[i]);
          if (m) {
            timingLineIdx = i;
            match = m;
            break;
          }
        }
        if (timingLineIdx === -1 || !match) return;

        const identifier =
          timingLineIdx > 0
            ? lines.slice(0, timingLineIdx).join(" ").trim()
            : String(cues.length + 1);

        const startRaw = match[1];
        const endRaw = match[2];
        const settings = (match[3] || "").trim();

        const timing = Object.freeze({
          startMs: parseTimestampToMs(startRaw),
          endMs: parseTimestampToMs(endRaw),
          startRaw,
          endRaw,
          settings
        });

        const payloadText = lines.slice(timingLineIdx + 1).join("\n").trim();

        cues.push({
          index: cues.length + 1,
          identifier: identifier || String(cues.length + 1),
          timing,
          text: payloadText
        });
      });

      return {
        cues,
        headerBlocks,
        sourceFormat: isVtt ? "vtt" : "srt"
      };
    },

    serializeWebVTT(doc, { preserveIdentifiers = true } = {}) {
      const sections = ["WEBVTT"];

      for (const note of doc.headerBlocks || []) {
        if (note && note.trim()) {
          sections.push(note.trim());
        }
      }

      for (const cue of doc.cues) {
        const lines = [];
        if (preserveIdentifiers && cue.identifier) {
          lines.push(String(cue.identifier));
        }
        const start = formatMsTimestamp(cue.timing.startMs, ".");
        const end = formatMsTimestamp(cue.timing.endMs, ".");
        const arrow = cue.timing.settings
          ? `${start} --> ${end} ${cue.timing.settings}`
          : `${start} --> ${end}`;
        lines.push(arrow);
        lines.push(cue.text);
        sections.push(lines.join("\n"));
      }

      return sections.join("\n\n") + "\n";
    },

    detectLanguage(doc) {
      const sample = (doc.cues || [])
        .slice(0, 40)
        .map((c) => c.text)
        .join(" ");
      const diacritics = (sample.match(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/g) || []).length;
      const words = (
        sample.toLowerCase().match(/[a-ząćęłńóśźż]+/gi) || []
      ).map((w) => w.toLowerCase());

      const plStop = new Set([
        "nie", "się", "jest", "jak", "czy", "ale", "dla", "tylko", "przez",
        "żeby", "który", "która", "będzie", "dzień", "dobry", "witamy",
        "dziękuję", "dziękujemy", "proszę", "pani", "panie", "państwo", "napisy"
      ]);
      const enStop = new Set([
        "the", "and", "you", "that", "with", "for", "this", "have", "from",
        "are", "was", "were", "could", "would", "welcome", "everyone", "thanks"
      ]);

      let plScore = diacritics * 2;
      let enScore = 0;
      for (const w of words) {
        if (plStop.has(w)) plScore += 1;
        if (enStop.has(w)) enScore += 1;
      }
      return plScore > enScore ? "pl" : "en";
    },

    validateWebVTT(vttText, referenceDoc = null, maxCpl = 42) {
      const errors = [];
      if (!String(vttText).startsWith("WEBVTT\n")) {
        errors.push("Missing mandatory 'WEBVTT' header.");
      }
      const parsed = SubtitleParser.parse(vttText, "check.vtt");

      if (referenceDoc) {
        if (parsed.cues.length !== referenceDoc.cues.length) {
          errors.push(
            `Cue count mismatch: expected ${referenceDoc.cues.length}, got ${parsed.cues.length}`
          );
        } else {
          for (let i = 0; i < referenceDoc.cues.length; i += 1) {
            const src = referenceDoc.cues[i];
            const out = parsed.cues[i];
            if (
              src.timing.startMs !== out.timing.startMs ||
              src.timing.endMs !== out.timing.endMs
            ) {
              errors.push(`Timestamp mutated at cue ${src.index}.`);
            }
          }
        }
      }

      for (const cue of parsed.cues) {
        const lines = cue.text.split("\n");
        lines.forEach((ln, idx) => {
          const visLen = visibleCharLength(ln);
          if (visLen > maxCpl) {
            errors.push(
              `Cue ${cue.index} line ${idx + 1} exceeds ${maxCpl} CPL (${visLen}): "${ln}"`
            );
          }
        });
      }
      return errors;
    }
  };

  /* ==========================================================================
   * 6. TOKEN SHIELD (INLINE HTML / WEBVTT FORMATTING TAG MASKING)
   * ========================================================================== */

  const PROTECTED_TOKEN_REGEX =
    /<\/?[A-Za-z][^>]*>|<\d{2}:\d{2}(?::\d{2})?[.,]\d{3}>|\{\\[^}]+\}|https?:\/\/\S+|\{[A-Za-z0-9_]+\}|%[sdif]/g;

  const OUTER_TAG_REGEX = /^\s*<(i|b|u)>([\s\S]*)<\/\1>\s*$/i;

  const TokenShield = {
    splitDialogueTurns(cueText) {
      const lines = String(cueText || "")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      const isMultiDialogue =
        lines.length >= 2 && lines.every((l) => /^[-–—]/.test(l));
      if (isMultiDialogue) {
        return { turns: lines, isMultiDialogue: true };
      }
      // Preserve authored line breaks (notably ASS/SSA \\N) as layout boundaries.
      return { turns: [String(cueText || "").trim()], isMultiDialogue: false };
    },

    mask(segment) {
      let working = String(segment || "").trim();
      let leadingDash = "";

      const dashMatch = /^([-–—]\s*)/.exec(working);
      if (dashMatch) {
        leadingDash = "- ";
        working = working.slice(dashMatch[0].length).trim();
      }

      const outerTags = [];
      let outerMatch = OUTER_TAG_REGEX.exec(working);
      while (outerMatch) {
        const tag = outerMatch[1].toLowerCase();
        const inner = outerMatch[2];
        if (inner.toLowerCase().includes(`</${tag}>`)) {
          break;
        }
        outerTags.push(tag);
        working = inner.trim();
        outerMatch = OUTER_TAG_REGEX.exec(working);
      }

      const tokenMap = [];
      const cleanText = working.replace(PROTECTED_TOKEN_REGEX, (matchedToken) => {
        const idx = tokenMap.length;
        tokenMap.push(matchedToken);
        return `⟦T${idx}⟧`;
      });

      return { cleanText, outerTags, leadingDash, tokenMap };
    },

    unmask(translatedText, maskState) {
      let restored = String(translatedText || "").trim();

      maskState.tokenMap.forEach((originalToken, idx) => {
        const tokenRe = new RegExp(
          `(?:⟦\\s*T${idx}\\s*⟧|\\[\\[\\s*T${idx}\\s*\\]\\]|\\[\\s*T${idx}\\s*\\])`,
          "gi"
        );
        if (tokenRe.test(restored)) {
          restored = restored.replace(tokenRe, () => originalToken);
        } else if (originalToken.startsWith("</")) {
          restored = `${restored}${originalToken}`;
        } else if (originalToken.startsWith("<")) {
          restored = `${originalToken}${restored}`;
        }
      });

      restored = restored.replace(/[ \t]{2,}/g, " ").trim();

      for (let i = maskState.outerTags.length - 1; i >= 0; i -= 1) {
        const tag = maskState.outerTags[i];
        restored = `<${tag}>${restored}</${tag}>`;
      }

      if (maskState.leadingDash && !/^[-–—]/.test(restored)) {
        restored = `${maskState.leadingDash}${restored}`;
      }

      return restored;
    }
  };

  /* ==========================================================================
   * 7. HARD <= 42 CPL FORMATTER & POLISH `\u00A0` PREPOSITION BINDER
   * ========================================================================== */

  const TextFormatter = {
    bindPolishPrepositions(text) {
      const savedTags = [];
      let safe = String(text || "").replace(/<[^>]+>/g, (tag) => {
        const idx = savedTags.length;
        savedTags.push(tag);
        return `⟪HTMLTAG_${idx}⟫`;
      });

      const prepRegex = /(^|[\s\u00A0([{"„«—–-])([wziouaWZIOUA])[ \t]+(?=\S)/g;
      let prev;
      do {
        prev = safe;
        safe = safe.replace(prepRegex, "$1$2\u00A0");
      } while (safe !== prev);

      return safe.replace(/⟪HTMLTAG_(\d+)⟫/g, (_m, i) => savedTags[Number(i)]);
    },

    compressSemantics(text, lang = "pl", maxCpl = 42) {
      let s = String(text || "").replace(/[ \t]+/g, " ").trim();
      if (visibleCharLength(s) <= maxCpl) return s;

      const enRules = [
        [/\bdue to the fact that\b/gi, "because"],
        [/\bat this point in time\b/gi, "now"],
        [/\bin order to\b/gi, "to"],
        [/\ba large number of\b/gi, "many"],
        [/\bare able to\b/gi, "can"],
        [/\bis able to\b/gi, "can"],
        [/\bfifty percent\b/gi, "50%"],
        [/\bone hundred percent\b/gi, "100%"],
        [/\b(\d+)\s+percent\b/gi, "$1%"]
      ];

      const plRules = [
        [/\bze względu na fakt,?\s*że\b/gi, "ponieważ"],
        [/\bze względu na to,?\s*że\b/gi, "ponieważ"],
        [/\bz powodu tego,?\s*że\b/gi, "bo"],
        [/\bw chwili obecnej\b/gi, "teraz"],
        [/\bw tym momencie\b/gi, "teraz"],
        [/\bw celu\b/gi, "aby"],
        [/\bduża liczba\b/gi, "wielu"],
        [/\bsą w stanie\b/gi, "mogą"],
        [/\bjest w stanie\b/gi, "może"],
        [/\bna przykład\b/gi, "np."],
        [/\bmiędzy innymi\b/gi, "m.in."],
        [/\bpięćdziesiąt procent\b/gi, "50%"],
        [/\bsto procent\b/gi, "100%"],
        [/\b(\d+)\s+procent\b/gi, "$1%"]
      ];

      const rules = lang === "pl" ? plRules : enRules;
      for (const [pattern, repl] of rules) {
        s = s.replace(pattern, repl);
      }

      if (visibleCharLength(s) > maxCpl * 2 - 4 && lang === "pl") {
        s = s.replace(/\bponieważ\b/g, "bo").replace(/\bPonieważ\b/g, "Bo");
      }

      if (s && text && /^[A-ZŚĆŻŹŁ]/.test(text.trim()) && /^[a-ząćęłńóśźż]/.test(s)) {
        s = s.charAt(0).toUpperCase() + s.slice(1);
      }
      return s.replace(/[ \t]{2,}/g, " ").trim();
    },

    _splitOverlongToken(token, limit) {
      if (token.length <= limit && visibleCharLength(token) <= limit) {
        return [token];
      }
      if (/<[^>]+>/.test(token) && visibleCharLength(token) <= limit) {
        return [token];
      }
      if (token.includes("\u00A0")) {
        const subParts = token.split("\u00A0");
        if (subParts.every((p) => p.length <= limit)) {
          return subParts;
        }
      }
      const chunks = [];
      let rem = token;
      while (rem.length > limit) {
        let cut = -1;
        for (const sep of ["/", "-", "_", "."]) {
          const idx = rem.lastIndexOf(sep, limit - 1);
          if (idx > Math.floor(limit / 2)) {
            cut = idx + 1;
            break;
          }
        }
        if (cut === -1) {
          cut = limit - 1;
          chunks.push(`${rem.slice(0, cut)}-`);
          rem = rem.slice(cut);
        } else {
          chunks.push(rem.slice(0, cut));
          rem = rem.slice(cut);
        }
      }
      if (rem) chunks.push(rem);
      return chunks;
    },

    _wrapSingleTurn(rawTurn, { maxCpl = 42, lang = "pl" } = {}) {
      let text = TextFormatter.compressSemantics(rawTurn, lang, maxCpl);
      if (lang === "pl") {
        text = TextFormatter.bindPolishPrepositions(text);
      }

      let outerTag = null;
      const outerMatch = /^<(i|b|u)>([\s\S]*)<\/\1>$/i.exec(text);
      let innerText = text;
      if (
        outerMatch &&
        !outerMatch[2].toLowerCase().includes(`</${outerMatch[1].toLowerCase()}>`)
      ) {
        outerTag = outerMatch[1].toLowerCase();
        innerText = outerMatch[2].trim();
      }

      const tagOverhead = outerTag ? outerTag.length + 3 : 0;
      const effectiveLimit =
        maxCpl - tagOverhead >= 16 ? maxCpl - tagOverhead : maxCpl;

      const rawWords = innerText.split(/[ \t]+/).filter(Boolean);
      if (rawWords.length === 0) return [""];

      const words = [];
      for (const w of rawWords) {
        words.push(...TextFormatter._splitOverlongToken(w, effectiveLimit));
      }

      const singleLine = words.join(" ");
      if (
        singleLine.length <= effectiveLimit &&
        visibleCharLength(singleLine) <= effectiveLimit
      ) {
        return outerTag ? [`<${outerTag}>${singleLine}</${outerTag}>`] : [singleLine];
      }

      const n = words.length;
      const dpLines = new Array(n + 1).fill(1e9);
      const dpCost = new Array(n + 1).fill(Infinity);
      const nextBreak = new Array(n + 1).fill(-1);
      dpLines[n] = 0;
      dpCost[n] = 0;

      const estLines = Math.max(
        2,
        Math.ceil(singleLine.length / Math.max(1, effectiveLimit - 2))
      );
      const idealWidth = singleLine.length / estLines;
      const enWeakEnd = new Set([
        "a", "an", "the", "to", "of", "in", "on", "at", "for", "and", "or"
      ]);

      const measureSeg = (i, j) => {
        const seg = words.slice(i, j).join(" ");
        return Math.max(seg.length, visibleCharLength(seg));
      };

      for (let i = n - 1; i >= 0; i -= 1) {
        for (let j = i + 1; j <= n; j += 1) {
          const segLen = measureSeg(i, j);
          if (segLen > effectiveLimit) break;

          const candLines = 1 + dpLines[j];
          let penalty = Math.pow(segLen - idealWidth, 2);

          if (j < n) {
            const lastWord = words[j - 1];
            const cleanLast = lastWord
              .replace(/^[^\wąćęłńóśźż]+|[^\wąćęłńóśźż]+$/gi, "")
              .toLowerCase();
            if (lang === "en" && enWeakEnd.has(cleanLast)) {
              penalty += 120;
            }
            if (/[,;:.?!—–]$/.test(lastWord)) {
              penalty -= 35;
            }
          }

          const candCost = penalty + dpCost[j];
          if (
            candLines < dpLines[i] ||
            (candLines === dpLines[i] && candCost < dpCost[i])
          ) {
            dpLines[i] = candLines;
            dpCost[i] = candCost;
            nextBreak[i] = j;
          }
        }
      }

      const lines = [];
      let cur = 0;
      while (cur < n) {
        let nxt = nextBreak[cur];
        if (nxt <= cur) nxt = cur + 1;
        lines.push(words.slice(cur, nxt).join(" "));
        cur = nxt;
      }

      if (outerTag && lines.length > 0) {
        lines[0] = `<${outerTag}>${lines[0]}`;
        lines[lines.length - 1] = `${lines[lines.length - 1]}</${outerTag}>`;
      }

      return lines;
    },

    wrapLines(cueText, { maxCpl = 42, lang = "pl" } = {}) {
      const rawLines = String(cueText || "")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      if (rawLines.length === 0) return [""];

      // Explicit source line breaks are meaningful for ASS positioning/effects and
      // author-intended subtitle layout. Wrap each authored line independently.
      const turns = rawLines;

      const out = [];
      for (const turn of turns) {
        out.push(...TextFormatter._wrapSingleTurn(turn, { maxCpl, lang }));
      }
      return out;
    },

    formatCueText(cueText, options = {}) {
      return TextFormatter.wrapLines(cueText, options).join("\n");
    }
  };

  /* ==========================================================================
   * 8. ROLLING 5-CUE CONTEXT WINDOW & POLISH REGISTER HARMONIZER
   * ========================================================================== */

  const FEMALE_GIVEN_NAMES = new Set([
    "anna", "ania", "marta", "katarzyna", "kasia", "magda", "ewa", "maria",
    "joanna", "agnieszka", "monika", "natalia", "karolina", "zofia", "julia",
    "sarah", "emma", "claire", "elena"
  ]);

  const MALE_GIVEN_NAMES = new Set([
    "piotr", "marek", "marku", "jan", "tomasz", "tomek", "paweł", "krzysztof",
    "michał", "adam", "łukasz", "marcin", "jakub", "john", "david", "michael"
  ]);

  function inferRegisterSignal(text) {
    const clean = String(text || "").replace(/<[^>]+>/g, "");

    if (
      /\b(?:hey everyone|hi everyone|hello everyone|you guys|folks|all of you|watching this episode with us|watching vertical shorts|cześć wszystkim|moi drodzy|kochani|widzicie|możecie)\b/i.test(
        clean
      )
    ) {
      return "informal_plural";
    }

    if (/\b(?:Mrs\.?|Ms\.?|Miss|Madam|Ma'am|Pani|Panią)\b/.test(clean)) {
      return "formal_fem";
    }
    if (/\b(?:Mr\.?|Sir|Pan|Pana|Panu|Panie)\b/.test(clean)) {
      return "formal_masc";
    }

    const titleMatch =
      /\b(?:Dr\.?|Doctor|Prof\.?|Professor)\s+([A-ZŚĆŻŹŁ][a-ząćęłńóśźż]+)(?:\s+([A-ZŚĆŻŹŁ][a-ząćęłńóśźż]+))?/.exec(
        clean
      );
    if (titleMatch) {
      const first = (titleMatch[1] || "").toLowerCase();
      const last = (titleMatch[2] || "").toLowerCase();
      if (
        FEMALE_GIVEN_NAMES.has(first) ||
        /(?:ska|cka|dzka)$/.test(first) ||
        /(?:ska|cka|dzka)$/.test(last)
      ) {
        return "formal_fem";
      }
      if (
        MALE_GIVEN_NAMES.has(first) ||
        /(?:ski|cki|dzki)$/.test(first) ||
        /(?:ski|cki|dzki)$/.test(last)
      ) {
        return "formal_masc";
      }
      return "formal_masc";
    }
    return null;
  }

  class RollingContextWindow {
    constructor(maxBlocks = 5, mode = "auto") {
      this.maxBlocks = maxBlocks;
      this.mode = mode;
      this.history = [];
    }

    evaluate(currentSourceText) {
      if (this.mode && this.mode !== "auto") {
        return {
          activeRegister: this.mode,
          history: this.history.slice()
        };
      }

      let inferred = "default";
      for (const item of this.history) {
        if (item.register && item.register !== "default") {
          inferred = item.register;
        }
        const sigSrc = inferRegisterSignal(item.sourceText);
        const sigTrn = inferRegisterSignal(item.translatedText);
        if (sigSrc) inferred = sigSrc;
        if (sigTrn) inferred = sigTrn;
      }

      const curSig = inferRegisterSignal(currentSourceText);
      if (curSig) inferred = curSig;

      return {
        activeRegister: inferred,
        history: this.history.slice()
      };
    }

    push(cueIndex, sourceText, translatedText, activeRegister) {
      this.history.push({
        cueIndex,
        sourceText,
        translatedText,
        register: activeRegister
      });
      if (this.history.length > this.maxBlocks) {
        this.history.shift();
      }
    }
  }

  const PolishRegisterHarmonizer = {
    harmonize(polishText, activeRegister) {
      let out = String(polishText || "");
      if (!activeRegister || activeRegister === "default") return out;

      const rulesByRegister = {
        formal_fem: [
          [/\bCzy mógłbyś\b/gi, "Czy mogłaby Pani"],
          [/\bCzy mogłabyś\b/gi, "Czy mogłaby Pani"],
          [/\bCzy możesz\b/g, "Czy może Pani"],
          [/\bczy możesz\b/g, "czy może Pani"],
          [/\bMożesz\b/g, "Może Pani"],
          [/\bmożesz\b/g, "może Pani"],
          [/\bCzy byłeś zaskoczony\b/gi, "Czy była Pani zaskoczona"],
          [/\bCzy byłaś zaskoczona\b/gi, "Czy była Pani zaskoczona"],
          [/\bByłeś zaskoczony\b/g, "Była Pani zaskoczona"],
          [/\bbyłeś zaskoczony\b/g, "była Pani zaskoczona"],
          [/\bzbudowałeś\b/g, "zbudowała Pani"],
          [/\bzbudowałaś\b/g, "zbudowała Pani"],
          [/\bstworzyłeś\b/g, "stworzyła Pani"],
          [/\bwidzisz\b/g, "widzi Pani"],
          [/\bchcesz\b/g, "chce Pani"],
          [/\bmasz\b/g, "ma Pani"],
          [/\bjesteś\b/g, "jest Pani"],
          [/\bw twojej\b/gi, "w swojej"],
          [/\b(?:twój|twoja|twoje|twojego|twojej|twoim)\b/gi, "Pani"]
        ],
        formal_masc: [
          [/\bCzy mógłbyś\b/gi, "Czy mógłby Pan"],
          [/\bCzy mogłabyś\b/gi, "Czy mógłby Pan"],
          [/\bCzy możesz\b/g, "Czy może Pan"],
          [/\bczy możesz\b/g, "czy może Pan"],
          [/\bMożesz\b/g, "Może Pan"],
          [/\bmożesz\b/g, "może Pan"],
          [/\bCzy byłeś zaskoczony\b/gi, "Czy był Pan zaskoczony"],
          [/\bByłeś zaskoczony\b/g, "Był Pan zaskoczony"],
          [/\bbyłeś zaskoczony\b/g, "był Pan zaskoczony"],
          [/\bzbudowałeś\b/g, "zbudował Pan"],
          [/\bstworzyłeś\b/g, "stworzył Pan"],
          [/\bwidzisz\b/g, "widzi Pan"],
          [/\bchcesz\b/g, "chce Pan"],
          [/\bmasz\b/g, "ma Pan"],
          [/\bjesteś\b/g, "jest Pan"],
          [/\bw twojej\b/gi, "w swojej"],
          [/\b(?:twój|twoja|twoje|twojego|twojej|twoim)\b/gi, "Pana"]
        ],
        informal_plural: [
          [/\bCzy mógłbyś\b/gi, "Czy moglibyście"],
          [/\bCzy mogłabyś\b/gi, "Czy mogłybyście"],
          [/\bCzy możesz\b/g, "Czy możecie"],
          [/\bczy możesz\b/g, "czy możecie"],
          [/\bMożesz\b/g, "Możecie"],
          [/\bmożesz\b/g, "możecie"],
          [/\bCzy byłeś zaskoczony\b/gi, "Czy byliście zaskoczeni"],
          [/\bzbudowałeś\b/g, "zbudowaliście"],
          [/\bwidzisz\b/g, "widzicie"],
          [/\bchcesz\b/g, "chcecie"],
          [/\bmasz\b/g, "macie"],
          [/\bjesteś\b/g, "jesteście"],
          [/\bOdwiedź\b/g, "Odwiedźcie"],
          [/\bnaciśnij\b/g, "kliknijcie"],
          [/\btwojej\b/gi, "waszej"],
          [/\btwoim\b/gi, "waszym"],
          [/\btwój\b/gi, "wasz"],
          [/\btwoje\b/gi, "wasze"]
        ]
      };

      const rules = rulesByRegister[activeRegister] || [];
      for (const [pattern, repl] of rules) {
        out = out.replace(pattern, repl);
      }
      return out;
    }
  };

  /* ==========================================================================
   * 9. CLIENT-SIDE TRANSLATOR WITH CIRCUIT BREAKER & FALLBACK TELEMETRY
   * ========================================================================== */

  class ClientTranslator {
    constructor(settings = {}) {
      this.provider = settings.provider || "auto";
      this.apiKey = (settings.apiKey || "").trim();
      this.customEndpoint = (settings.customEndpoint || "").trim();
      this.llmModel = (settings.llmModel || "gpt-4o-mini").trim();
      this.onFallback = typeof settings.onFallback === "function" ? settings.onFallback : null;
      this.lastUsedProvider = "offline-smart-dictionary";

      // Per-batch circuit breakers so rate-limited/offline endpoints fail fast once
      this._circuit = {
        googleGtxTripped: false,
        myMemoryTripped: false,
        deeplTripped: false,
        llmTripped: false,
        notifiedFallback: false,
        failedEndpoints: []
      };
    }

    resetCircuit() {
      this._circuit = {
        googleGtxTripped: false,
        myMemoryTripped: false,
        deeplTripped: false,
        llmTripped: false,
        notifiedFallback: false,
        failedEndpoints: []
      };
    }

    _recordEndpointFailure(endpointName, errorObj) {
      if (!this._circuit.failedEndpoints.includes(endpointName)) {
        this._circuit.failedEndpoints.push(endpointName);
      }
      this._circuit.lastError = errorObj ? errorObj.message : "Network/Rate limit";
    }

    _notifyFallbackOnce() {
      if (this._circuit.notifiedFallback) return;
      this._circuit.notifiedFallback = true;
      if (this.onFallback) {
        this.onFallback({
          failedEndpoints: this._circuit.failedEndpoints.slice(),
          reason: this._circuit.lastError || "Public endpoint unavailable",
          fallbackProvider: "offline-smart-dictionary"
        });
      }
    }

    _withRegisterContextAnchor(text, sourceLang, targetLang, activeRegister) {
      if (sourceLang !== "en" || targetLang !== "pl") {
        return { query: text, hasAnchor: false };
      }
      const anchors = {
        formal_fem: "Madam Anna Kowalska: ||| ",
        formal_masc: "Mr. Jan Kowalski: ||| ",
        informal_plural: "Everyone, dear friends: ||| "
      };
      const prefix = anchors[activeRegister];
      if (!prefix || !/\byou|your\b/i.test(text)) {
        return { query: text, hasAnchor: false };
      }
      return { query: `${prefix}${text}`, hasAnchor: true };
    }

    _stripRegisterContextAnchor(translated, hasAnchor) {
      if (!hasAnchor) return translated;
      const parts = String(translated).split(/\|\|\|/);
      if (parts.length >= 2) {
        return parts.slice(1).join(" ").trim();
      }
      return translated;
    }

    async _fetchWithTimeout(url, options = {}, timeoutMs = 4000) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        return await fetch(url, { ...options, signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
    }

    async _translateGoogleGtx(text, sourceLang, targetLang, activeRegister) {
      const { query, hasAnchor } = this._withRegisterContextAnchor(
        text,
        sourceLang,
        targetLang,
        activeRegister
      );
      const rawUrl =
        `https://translate.googleapis.com/translate_a/single?client=gtx` +
        `&sl=${encodeURIComponent(sourceLang)}` +
        `&tl=${encodeURIComponent(targetLang)}` +
        `&dt=t&q=${encodeURIComponent(query)}`;

      const finalUrl =
        this.customEndpoint && !this.customEndpoint.includes("/chat/completions")
          ? `${this.customEndpoint}${encodeURIComponent(rawUrl)}`
          : rawUrl;

      const res = await this._fetchWithTimeout(finalUrl, { method: "GET" });
      if (!res.ok) {
        throw new Error(`Google GTX HTTP ${res.status}`);
      }
      const data = await res.json();
      if (!Array.isArray(data) || !Array.isArray(data[0])) {
        throw new Error("Unexpected Google GTX payload");
      }
      const combined = data[0].map((chunk) => (chunk && chunk[0]) || "").join("");
      this.lastUsedProvider = "google-gtx-client";
      return this._stripRegisterContextAnchor(combined.trim(), hasAnchor);
    }

    async _translateMyMemory(text, sourceLang, targetLang, activeRegister) {
      const { query, hasAnchor } = this._withRegisterContextAnchor(
        text,
        sourceLang,
        targetLang,
        activeRegister
      );
      let url =
        `https://api.mymemory.translated.net/get?q=${encodeURIComponent(query)}` +
        `&langpair=${encodeURIComponent(sourceLang)}|${encodeURIComponent(targetLang)}`;
      if (this.apiKey && this.apiKey.includes("@")) {
        url += `&de=${encodeURIComponent(this.apiKey)}`;
      }
      const res = await this._fetchWithTimeout(url, { method: "GET" });
      if (!res.ok) {
        throw new Error(`MyMemory HTTP ${res.status}`);
      }
      const data = await res.json();
      const out = data && data.responseData && data.responseData.translatedText;
      if (!out || Number(data.responseStatus) >= 400) {
        throw new Error("MyMemory rate limit or quota exceeded");
      }
      this.lastUsedProvider = "mymemory-cors-api";
      return this._stripRegisterContextAnchor(String(out).trim(), hasAnchor);
    }

    async _translateDeepLFree(text, sourceLang, targetLang, activeRegister) {
      if (!this.apiKey) {
        throw new Error("DeepL Free API key not provided");
      }
      const endpoint =
        this.customEndpoint || "https://api-free.deepl.com/v2/translate";
      const params = new URLSearchParams();
      params.append("text", text);
      params.append("source_lang", sourceLang.toUpperCase());
      params.append("target_lang", targetLang.toUpperCase());
      if (targetLang === "pl") {
        if (activeRegister === "formal_fem" || activeRegister === "formal_masc") {
          params.append("formality", "prefer_more");
        } else if (activeRegister === "informal_plural") {
          params.append("formality", "prefer_less");
        }
      }

      const res = await this._fetchWithTimeout(
        endpoint,
        {
          method: "POST",
          headers: {
            Authorization: `DeepL-Auth-Key ${this.apiKey}`,
            "Content-Type": "application/x-www-form-urlencoded"
          },
          body: params.toString()
        },
        6500
      );
      if (!res.ok) {
        throw new Error(`DeepL HTTP ${res.status}`);
      }
      const data = await res.json();
      this.lastUsedProvider = "deepl-free-api";
      return data.translations[0].text.trim();
    }

    async _translateOpenAICompat(text, sourceLang, targetLang, contextEval) {
      const base = (this.customEndpoint || "https://api.openai.com/v1").replace(
        /\/+$/,
        ""
      );
      const url = base.endsWith("/chat/completions")
        ? base
        : `${base}/chat/completions`;

      const registerNote =
        targetLang === "pl"
          ? `Use Polish address register: ${contextEval.activeRegister}.`
          : "";
      const historyLines = (contextEval.history || [])
        .map((h) => `[${h.cueIndex}] ${h.sourceText} => ${h.translatedText}`)
        .join("\n");

      const headers = { "Content-Type": "application/json" };
      if (this.apiKey) {
        headers.Authorization = `Bearer ${this.apiKey}`;
      }

      const res = await this._fetchWithTimeout(
        url,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: this.llmModel || "gpt-4o-mini",
            temperature: 0.1,
            messages: [
              {
                role: "system",
                content:
                  `Translate subtitle from ${sourceLang.toUpperCase()} to ${targetLang.toUpperCase()}. ` +
                  `Preserve tokens like ⟦T0⟧ untouched. ${registerNote} Return ONLY the translated line.`
              },
              {
                role: "user",
                content: historyLines
                  ? `Recent 5-cue context:\n${historyLines}\n\nTranslate cue:\n${text}`
                  : text
              }
            ]
          })
        },
        9000
      );
      if (!res.ok) {
        throw new Error(`LLM HTTP ${res.status}`);
      }
      const data = await res.json();
      this.lastUsedProvider = "openai-compat-llm";
      return data.choices[0].message.content.trim();
    }

    translateOffline(text, sourceLang, targetLang, activeRegister) {
      this.lastUsedProvider = "offline-smart-dictionary";
      if (!text.trim() || sourceLang === targetLang) return text;

      const key = text.trim().replace(/\s+/g, " ").toLowerCase();
      const multilingualEntry = OFFLINE_MEMORY_MULTILINGUAL[sourceLang]?.[targetLang]?.[key];
      if (multilingualEntry) {
        this.lastUsedProvider = "offline-multilingual-memory";
        return multilingualEntry;
      }
      const table =
        targetLang === "pl" ? OFFLINE_MEMORY_EN_TO_PL : OFFLINE_MEMORY_PL_TO_EN;

      if (table[key]) {
        const entry = table[key];
        const variant = entry[activeRegister] || entry.default;
        return targetLang === "pl"
          ? PolishRegisterHarmonizer.harmonize(variant, activeRegister)
          : variant;
      }

      const lexicon =
        targetLang === "pl" ? PHRASE_LEXICON_EN_PL : PHRASE_LEXICON_PL_EN;
      let working = text;
      for (const [srcPhrase, tgtPhrase] of lexicon) {
        const escaped = srcPhrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const re = new RegExp(`\\b${escaped}\\b`, "gi");
        working = working.replace(re, (m) => {
          if (m === m.toUpperCase()) return tgtPhrase.toUpperCase();
          if (m[0] === m[0].toUpperCase()) {
            return tgtPhrase.charAt(0).toUpperCase() + tgtPhrase.slice(1);
          }
          return tgtPhrase;
        });
      }

      if (targetLang === "pl") {
        working = PolishRegisterHarmonizer.harmonize(working, activeRegister);
      }
      return working;
    }

    async translateSegment(text, sourceLang, targetLang, contextEval) {
      if (!text.trim() || sourceLang === targetLang) return text;
      const activeReg = contextEval.activeRegister || "default";

      let rawTranslated = "";

      if (this.provider === "offline") {
        rawTranslated = this.translateOffline(text, sourceLang, targetLang, activeReg);
      } else if (this.provider === "google_gtx") {
        if (!this._circuit.googleGtxTripped) {
          try {
            rawTranslated = await this._translateGoogleGtx(
              text,
              sourceLang,
              targetLang,
              activeReg
            );
          } catch (err) {
            this._circuit.googleGtxTripped = true;
            this._recordEndpointFailure("Google GTX", err);
            this._notifyFallbackOnce();
            rawTranslated = this.translateOffline(text, sourceLang, targetLang, activeReg);
          }
        } else {
          rawTranslated = this.translateOffline(text, sourceLang, targetLang, activeReg);
        }
      } else if (this.provider === "mymemory") {
        if (!this._circuit.myMemoryTripped) {
          try {
            rawTranslated = await this._translateMyMemory(
              text,
              sourceLang,
              targetLang,
              activeReg
            );
          } catch (err) {
            this._circuit.myMemoryTripped = true;
            this._recordEndpointFailure("MyMemory", err);
            this._notifyFallbackOnce();
            rawTranslated = this.translateOffline(text, sourceLang, targetLang, activeReg);
          }
        } else {
          rawTranslated = this.translateOffline(text, sourceLang, targetLang, activeReg);
        }
      } else if (this.provider === "deepl_free") {
        if (!this._circuit.deeplTripped) {
          try {
            rawTranslated = await this._translateDeepLFree(
              text,
              sourceLang,
              targetLang,
              activeReg
            );
          } catch (err) {
            this._circuit.deeplTripped = true;
            this._recordEndpointFailure("DeepL Free", err);
            this._notifyFallbackOnce();
            rawTranslated = this.translateOffline(text, sourceLang, targetLang, activeReg);
          }
        } else {
          rawTranslated = this.translateOffline(text, sourceLang, targetLang, activeReg);
        }
      } else if (this.provider === "openai_compat") {
        if (!this._circuit.llmTripped) {
          try {
            rawTranslated = await this._translateOpenAICompat(
              text,
              sourceLang,
              targetLang,
              contextEval
            );
          } catch (err) {
            this._circuit.llmTripped = true;
            this._recordEndpointFailure("OpenAI/LLM", err);
            this._notifyFallbackOnce();
            rawTranslated = this.translateOffline(text, sourceLang, targetLang, activeReg);
          }
        } else {
          rawTranslated = this.translateOffline(text, sourceLang, targetLang, activeReg);
        }
      } else {
        // "auto": Google GTX -> MyMemory CORS -> Offline Smart Dictionary (with circuit breaker)
        const hasFetch = typeof fetch === "function";
        const isOnline =
          typeof navigator === "undefined" ? false : navigator.onLine !== false;

        if (hasFetch && isOnline) {
          let succeeded = false;
          if (!this._circuit.googleGtxTripped) {
            try {
              rawTranslated = await this._translateGoogleGtx(
                text,
                sourceLang,
                targetLang,
                activeReg
              );
              succeeded = true;
            } catch (e1) {
              this._circuit.googleGtxTripped = true;
              this._recordEndpointFailure("Google GTX", e1);
            }
          }

          if (!succeeded && !this._circuit.myMemoryTripped) {
            try {
              rawTranslated = await this._translateMyMemory(
                text,
                sourceLang,
                targetLang,
                activeReg
              );
              succeeded = true;
            } catch (e2) {
              this._circuit.myMemoryTripped = true;
              this._recordEndpointFailure("MyMemory", e2);
            }
          }

          if (!succeeded) {
            this._notifyFallbackOnce();
            rawTranslated = this.translateOffline(
              text,
              sourceLang,
              targetLang,
              activeReg
            );
          }
        } else {
          rawTranslated = this.translateOffline(text, sourceLang, targetLang, activeReg);
        }
      }

      if (targetLang === "pl") {
        rawTranslated = PolishRegisterHarmonizer.harmonize(rawTranslated, activeReg);
      }
      return rawTranslated;
    }
  }

  async function translateLiveTranscript(text, sourceLang, targetLang, translator) {
    const source = String(sourceLang || "").trim();
    const target = String(targetLang || "").trim();
    if (!SUPPORTED_LANGUAGE_CODES.has(source) || !SUPPORTED_LANGUAGE_CODES.has(target)) {
      throw new Error("Unsupported live caption language selection.");
    }
    const transcript = String(text || "").trim();
    if (!transcript) return { text: "", providerUsed: "none" };
    const engine = translator || new ClientTranslator();
    const translated = await engine.translateSegment(transcript, source, target, {
      activeRegister: "default"
    });
    return {
      text: TextFormatter.formatCueText(translated, { maxCpl: 42, lang: target }),
      providerUsed: engine.lastUsedProvider || "unknown"
    };
  }

  /* ==========================================================================
   * 10. CACHE-AWARE PIPELINE ORCHESTRATOR
   * ========================================================================== */

  async function translateSubtitlePayload(rawInput, options = {}) {
    const maxCpl = Number(options.maxCpl) || 42;
    const registerMode = options.registerMode || "auto";
    const filename = options.filename || "subtitles.srt";
    const videoKey = options.videoKey || "default-video";
    const cacheStore = options.cacheStore || null;
    const bypassCache = Boolean(options.bypassCache);
    const onProgress =
      typeof options.onProgress === "function" ? options.onProgress : null;

    // 1. Check sub-second local cache first unless explicitly bypassed
    let cacheKey = null;
    if (cacheStore) {
      cacheKey = cacheStore.computeKey({
        videoKey,
        subtitleName: filename,
        rawText: rawInput,
        registerMode,
        maxCpl
      });

      if (!bypassCache) {
        const cached = cacheStore.get(cacheKey);
        if (cached && cached.enVtt && cached.plVtt) {
          const enDoc = SubtitleParser.parse(cached.enVtt, "cached_en.vtt");
          const plDoc = SubtitleParser.parse(cached.plVtt, "cached_pl.vtt");
          if (onProgress) onProgress(100, enDoc.cues.length, enDoc.cues.length);
          return {
            detectedLang: cached.detectedLang,
            targetLang: cached.targetLang,
            providerUsed: "instant-local-cache",
            fromCache: true,
            fallbackOccurred: false,
            cueCount: enDoc.cues.length,
            enDoc,
            plDoc,
            enVtt: cached.enVtt,
            plVtt: cached.plVtt,
            maxCplEn: cached.maxCplEn,
            maxCplPl: cached.maxCplPl
          };
        }
      }
    }

    let fallbackInfo = null;
    const translator =
      options.translator ||
      new ClientTranslator({
        ...(options.settings || {}),
        onFallback(info) {
          fallbackInfo = info;
          if (typeof options.onFallback === "function") {
            options.onFallback(info);
          }
        }
      });

    if (typeof translator.resetCircuit === "function") {
      translator.resetCircuit();
    }

    const sourceDoc = SubtitleParser.parse(rawInput, filename);
    if (sourceDoc.cues.length === 0) {
      throw new Error("No valid SRT or WebVTT subtitle cues detected in input.");
    }

    const detectedLang = options.sourceLang || SubtitleParser.detectLanguage(sourceDoc);
    const targetLang = detectedLang === "en" ? "pl" : "en";

    const rollingWindow = new RollingContextWindow(5, registerMode);

    const nativeCues = [];
    const translatedCues = [];
    const total = sourceDoc.cues.length;

    for (let i = 0; i < total; i += 1) {
      const cue = sourceDoc.cues[i];
      const plainSource = cue.text.replace(/\s+/g, " ").trim();
      const contextEval = rollingWindow.evaluate(plainSource);

      const formattedNativeText = TextFormatter.formatCueText(cue.text, {
        maxCpl,
        lang: detectedLang
      });
      nativeCues.push({
        index: cue.index,
        identifier: cue.identifier,
        timing: cue.timing,
        text: formattedNativeText
      });

      const { turns } = TokenShield.splitDialogueTurns(cue.text);
      const translatedTurns = [];

      for (const turn of turns) {
        const masked = TokenShield.mask(turn);
        const rawTarget = await translator.translateSegment(
          masked.cleanText,
          detectedLang,
          targetLang,
          contextEval
        );
        const restored = TokenShield.unmask(rawTarget, masked);
        translatedTurns.push(restored);
      }

      const joinedTranslated = translatedTurns.join("\n");
      const formattedTranslatedText = TextFormatter.formatCueText(joinedTranslated, {
        maxCpl,
        lang: targetLang
      });

      translatedCues.push({
        index: cue.index,
        identifier: cue.identifier,
        timing: cue.timing,
        text: formattedTranslatedText
      });

      rollingWindow.push(
        cue.index,
        plainSource,
        joinedTranslated.replace(/\s+/g, " ").trim(),
        contextEval.activeRegister
      );

      if (onProgress) {
        onProgress(Math.round(((i + 1) / total) * 100), i + 1, total);
      }
    }

    const nativeDoc = {
      cues: nativeCues,
      headerBlocks: sourceDoc.headerBlocks,
      sourceFormat: "vtt"
    };
    const targetDoc = {
      cues: translatedCues,
      headerBlocks: sourceDoc.headerBlocks,
      sourceFormat: "vtt"
    };

    const enDoc = detectedLang === "en" ? nativeDoc : targetDoc;
    const plDoc = detectedLang === "en" ? targetDoc : nativeDoc;

    const enVtt = SubtitleParser.serializeWebVTT(enDoc);
    const plVtt = SubtitleParser.serializeWebVTT(plDoc);

    const maxDocCpl = (doc) => {
      let max = 0;
      for (const c of doc.cues) {
        for (const ln of c.text.split("\n")) {
          max = Math.max(max, visibleCharLength(ln), ln.length);
        }
      }
      return max;
    };

    const maxCplEn = maxDocCpl(enDoc);
    const maxCplPl = maxDocCpl(plDoc);

    // Persist in sub-second local cache
    if (cacheStore && cacheKey) {
      cacheStore.set(cacheKey, {
        videoKey,
        subtitleName: filename,
        detectedLang,
        targetLang,
        enVtt,
        plVtt,
        maxCplEn,
        maxCplPl
      });
    }

    return {
      detectedLang,
      targetLang,
      providerUsed: translator.lastUsedProvider,
      fromCache: false,
      fallbackOccurred: Boolean(fallbackInfo),
      fallbackInfo,
      cueCount: total,
      enDoc,
      plDoc,
      enVtt,
      plVtt,
      maxCplEn,
      maxCplPl
    };
  }

  async function translateSubtitleToLanguage(rawInput, targetLang, options = {}) {
    if (!SUPPORTED_LANGUAGE_CODES.has(targetLang)) {
      throw new Error(`Unsupported subtitle language: ${targetLang}`);
    }
    const filename = options.filename || "subtitles.srt";
    const sourceDoc = SubtitleParser.parse(rawInput, filename);
    if (!sourceDoc.cues.length) throw new Error("No valid subtitle cues found in source.");
    const sourceLang = options.sourceLang || SubtitleParser.detectLanguage(sourceDoc);
    const translator = options.translator || new ClientTranslator({
      ...(options.settings || {}),
      onFallback: options.onFallback
    });
    if (typeof translator.resetCircuit === "function") translator.resetCircuit();
    const registerMode = options.registerMode || "auto";
    const context = new RollingContextWindow(5, registerMode);
    const cues = [];

    for (let i = 0; i < sourceDoc.cues.length; i += 1) {
      const cue = sourceDoc.cues[i];
      const contextEval = context.evaluate(cue.text);
      const { turns } = TokenShield.splitDialogueTurns(cue.text);
      const restoredTurns = [];
      for (const turn of turns) {
        const masked = TokenShield.mask(turn);
        const translated = await translator.translateSegment(
          masked.cleanText, sourceLang, targetLang, contextEval
        );
        restoredTurns.push(TokenShield.unmask(translated, masked));
      }
      let translatedText = restoredTurns.join("\n");
      if (targetLang === "pl") {
        translatedText = PolishRegisterHarmonizer.harmonize(translatedText, contextEval.activeRegister);
      }
      const formatted = TextFormatter.formatCueText(translatedText, {
        maxCpl: options.maxCpl || 42,
        lang: targetLang
      });
      cues.push({ ...cue, text: formatted });
      context.push(cue.index, cue.text, translatedText, contextEval.activeRegister);
      if (typeof options.onProgress === "function") {
        options.onProgress(Math.round(((i + 1) / sourceDoc.cues.length) * 100), i + 1, sourceDoc.cues.length);
      }
    }

    const doc = { cues, headerBlocks: sourceDoc.headerBlocks || [], sourceFormat: "vtt" };
    return {
      sourceLang,
      targetLang,
      doc,
      vtt: SubtitleParser.serializeWebVTT(doc),
      cueCount: cues.length,
      providerUsed: translator.lastUsedProvider || "unknown"
    };
  }

  /* ==========================================================================
   * 11. PRODUCTION STREAMING HUB + CREATOR STUDIO UI CONTROLLER
   * ========================================================================== */

  function initBrowserExperience() {
    if (typeof document === "undefined") return;
    const videoEl = document.getElementById("video-player");
    if (!videoEl) return;

    // Core DOM Elements — Public Streaming Hub
    const htmlRoot = document.documentElement;
    const metaThemeColor = document.getElementById("meta-theme-color");
    const btnUiLang = document.getElementById("btn-ui-lang");
    const uiLangLabel = document.getElementById("ui-lang-label");
    const btnThemeToggle = document.getElementById("btn-theme-toggle");
    const themeIcon = document.getElementById("theme-icon");
    const btnToggleStudio = document.getElementById("btn-toggle-studio");

    const watchLayout = document.getElementById("watch-layout");
    const playerStage = document.getElementById("player-stage");
    const btnAspect169 = document.getElementById("btn-aspect-16-9");
    const btnAspect916 = document.getElementById("btn-aspect-9-16");
    const btnTheaterMode = document.getElementById("btn-theater-mode");

    const trackSelectBtns = Array.from(
      document.querySelectorAll("[data-track-select]")
    );
    const catalogLanguageSelect = document.getElementById("catalog-language-select");
    const liveSourceLanguageSelect = document.getElementById("live-source-language");
    const liveTargetLanguageSelect = document.getElementById("live-target-language");
    const liveAudioSourceSelect = document.getElementById("live-audio-source");
    const btnLiveCaptions = document.getElementById("btn-live-captions");
    const liveCaptionStatus = document.getElementById("live-caption-status");
    const liveCaptionOverlay = document.getElementById("live-caption-overlay");
    const liveCaptionHeard = document.getElementById("live-caption-heard");
    const liveCaptionTranscript = document.getElementById("live-caption-transcript");
    const cacheHitBadge = document.getElementById("cache-hit-badge");
    const providerBadge = document.getElementById("active-provider-badge");
    const currentVideoTitle = document.getElementById("current-video-title");
    const currentVideoDesc = document.getElementById("current-video-desc");
    const savedPrefIndicator = document.getElementById("saved-pref-indicator");
    let playlistCards = Array.from(document.querySelectorAll("[data-video-id]"));

    const transcriptLangBadge = document.getElementById("transcript-lang-badge");
    const transcriptListEl = document.getElementById("viewer-transcript-list");
    const toastContainer = document.getElementById("toast-container");

    // Creator Studio Drawer Elements
    const studioBackdrop = document.getElementById("creator-studio-backdrop");
    const btnCloseStudio = document.getElementById("btn-close-studio");
    const studioTabs = Array.from(document.querySelectorAll("[data-studio-tab]"));
    const studioPanes = {
      ingest: document.getElementById("studio-pane-ingest"),
      settings: document.getElementById("studio-pane-settings"),
      inspector: document.getElementById("studio-pane-inspector")
    };

    const editorEl = document.getElementById("source-subtitle-editor");
    const btnTranslate = document.getElementById("btn-translate");
    const btnForceRetranslate = document.getElementById("btn-force-retranslate");
    const progressEl = document.getElementById("translate-progress");
    const statusEl = document.getElementById("translate-status");
    const pctEl = document.getElementById("translate-pct");

    const videoDropzone = document.getElementById("video-dropzone");
    const videoFileInput = document.getElementById("video-file-input");
    const videoFileMeta = document.getElementById("video-file-meta");
    const videoUrlInput = document.getElementById("video-url-input");
    const btnLoadVideoUrl = document.getElementById("btn-load-video-url");
    const btnMockStream = document.getElementById("btn-mock-stream");

    const subDropzone = document.getElementById("subtitle-dropzone");
    const subFileInput = document.getElementById("subtitle-file-input");
    const subFileMeta = document.getElementById("subtitle-file-meta");

    const btnPresetEn = document.getElementById("btn-preset-en");
    const btnPresetPl = document.getElementById("btn-preset-pl");
    const registerButtons = Array.from(
      document.querySelectorAll("#register-toggle-group .register-option")
    );

    const downloadEnLink = document.getElementById("download-en-vtt");
    const downloadPlLink = document.getElementById("download-pl-vtt");
    const cueListEn = document.getElementById("cue-list-en");
    const cueListPl = document.getElementById("cue-list-pl");
    const enMaxCplBadge = document.getElementById("en-max-cpl-badge");
    const plMaxCplBadge = document.getElementById("pl-max-cpl-badge");
    const metricLang = document.getElementById("metric-lang");
    const metricCues = document.getElementById("metric-cues");
    const metricCpl = document.getElementById("metric-cpl");

    const inputProvider = document.getElementById("setting-provider");
    const inputApiKey = document.getElementById("setting-api-key");
    const inputCustomEndpoint = document.getElementById("setting-custom-endpoint");
    const inputMaxCpl = document.getElementById("setting-max-cpl");
    const inputLlmModel = document.getElementById("setting-llm-model");
    const btnSaveSettings = document.getElementById("btn-save-settings");
    const btnResetSettings = document.getElementById("btn-reset-settings");
    const cacheStatsBadge = document.getElementById("cache-stats-badge");
    const btnClearCache = document.getElementById("btn-clear-cache");

    // State
    const cacheStore = new SubtitleCacheStore();
    let uiLang = LocalizationManager.resolveUiLanguage();
    let activeRegister = "auto";
    let activeCatalogId = "keynote";
    let currentCatalogRecord = null;
    let sourceSubtitlePromise = null;
    const dynamicLanguagePromises = new Map();
    let languageSelectionToken = 0;
    let loadedCatalogRecords = [];
    let catalogLoadToken = 0;
    let currentVideoKey = "catalog:keynote";
    let currentSubFilename = VIDEO_CATALOG.keynote.subtitleFilename;
    let currentResult = null;
    let currentTrackUrls = { en: null, pl: null, video: null };
    let canvasAnimId = null;
    let suppressNativeTrackEvent = false;
    let liveRecognition = null;
    let liveAudioStream = null;
    let liveAudioTrack = null;
    let liveActive = false;
    let liveStarting = false;
    let liveSessionToken = 0;
    let livePreviousTrack = "off";
    let liveTranslationQueue = Promise.resolve();
    let liveTranslator = null;
    let liveCaptionHideTimer = null;
    let liveFallbackToastShown = false;
    let liveUsingMicFallback = false;
    let liveStatusKey = "liveCaptionIdle";

    /* ----------------------------------------------------------------------
     * Toast Notification System
     * ---------------------------------------------------------------------- */
    function showToast({ title, message, variant = "info", durationMs = 5200 }) {
      if (!toastContainer) return;
      const icons = {
        info: "ℹ",
        success: "✓",
        warning: "⚠",
        error: "✕"
      };
      const toast = document.createElement("div");
      toast.className = `toast toast-${variant}`;

      const iconSpan = document.createElement("span");
      iconSpan.className = "toast-icon";
      iconSpan.textContent = icons[variant] || "ℹ";

      const contentDiv = document.createElement("div");
      const titleEl = document.createElement("strong");
      titleEl.className = "toast-title";
      titleEl.textContent = title;
      const msgEl = document.createElement("span");
      msgEl.className = "toast-msg";
      msgEl.textContent = message;
      contentDiv.appendChild(titleEl);
      contentDiv.appendChild(msgEl);

      const closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.className = "toast-close";
      closeBtn.setAttribute("aria-label", "Dismiss notification");
      closeBtn.textContent = "×";

      const removeToast = () => {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      };
      closeBtn.addEventListener("click", removeToast);

      toast.appendChild(iconSpan);
      toast.appendChild(contentDiv);
      toast.appendChild(closeBtn);
      toastContainer.appendChild(toast);

      if (durationMs > 0) {
        setTimeout(removeToast, durationMs);
      }
    }

    /* ----------------------------------------------------------------------
     * Theme Management (Dark / Light Mode with CSS Variables)
     * ---------------------------------------------------------------------- */
    function loadSavedTheme() {
      try {
        const saved = localStorage.getItem(STORAGE_KEYS.THEME);
        if (saved === "light" || saved === "dark") return saved;
      } catch (_e) {
        // Ignore
      }
      return "dark";
    }

    function applyTheme(theme) {
      htmlRoot.setAttribute("data-theme", theme);
      if (themeIcon) {
        themeIcon.textContent = theme === "dark" ? "☾" : "☀";
      }
      if (metaThemeColor) {
        metaThemeColor.setAttribute("content", theme === "dark" ? "#090d16" : "#f1f5f9");
      }
      try {
        localStorage.setItem(STORAGE_KEYS.THEME, theme);
      } catch (_e) {
        // Ignore
      }
    }

    applyTheme(loadSavedTheme());
    btnThemeToggle.addEventListener("click", () => {
      const next = htmlRoot.getAttribute("data-theme") === "dark" ? "light" : "dark";
      applyTheme(next);
    });

    /* ----------------------------------------------------------------------
     * Automatic & Toggleable UI Localization (Polish / English)
     * ---------------------------------------------------------------------- */
    function applyUiLocalization() {
      htmlRoot.setAttribute("lang", uiLang);
      uiLangLabel.textContent = uiLang.toUpperCase();

      document.querySelectorAll("[data-i18n]").forEach((el) => {
        const key = el.getAttribute("data-i18n");
        el.textContent = LocalizationManager.t(uiLang, key);
      });

      document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
        const key = el.getAttribute("data-i18n-placeholder");
        el.setAttribute("placeholder", LocalizationManager.t(uiLang, key));
      });

      // Localize active catalog video headline & description
      if (activeCatalogId && VIDEO_CATALOG[activeCatalogId]) {
        const cat = VIDEO_CATALOG[activeCatalogId];
        currentVideoTitle.textContent = localizedValue(cat.title, uiLang);
        currentVideoDesc.textContent = localizedValue(cat.description, uiLang);
      }

      if (loadedCatalogRecords.length) renderCatalogCards(loadedCatalogRecords);
      updateSavedPrefBadge();
      updateCacheStatsBadge();
      if (btnLiveCaptions) {
        btnLiveCaptions.textContent = LocalizationManager.t(uiLang, liveActive ? "btnStopListening" : "btnStartListening");
      }
      if (liveCaptionStatus) setLiveCaptionStatus(liveStatusKey, liveActive);
    }

    btnUiLang.addEventListener("click", () => {
      uiLang = uiLang === "pl" ? "en" : "pl";
      LocalizationManager.saveUiLanguage(uiLang);
      applyUiLocalization();
    });

    /* ----------------------------------------------------------------------
     * Creator Studio Slide-Over Drawer & Tabs (Hidden by Default)
     * ---------------------------------------------------------------------- */
    function setStudioOpen(isOpen) {
      studioBackdrop.hidden = !isOpen;
      btnToggleStudio.classList.toggle("is-open", isOpen);
      btnToggleStudio.setAttribute("aria-expanded", String(isOpen));
      if (isOpen) {
        syncSettingsInputs();
        updateCacheStatsBadge();
      }
    }

    btnToggleStudio.addEventListener("click", () => {
      setStudioOpen(studioBackdrop.hidden);
    });

    btnCloseStudio.addEventListener("click", () => setStudioOpen(false));
    studioBackdrop.addEventListener("click", (e) => {
      if (e.target === studioBackdrop) setStudioOpen(false);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !studioBackdrop.hidden) {
        setStudioOpen(false);
      }
    });

    studioTabs.forEach((tabBtn) => {
      tabBtn.addEventListener("click", () => {
        const target = tabBtn.dataset.studioTab;
        studioTabs.forEach((b) => {
          const active = b === tabBtn;
          b.classList.toggle("active", active);
          b.setAttribute("aria-selected", String(active));
        });
        Object.entries(studioPanes).forEach(([key, pane]) => {
          if (pane) pane.hidden = key !== target;
        });
      });
    });

    /* ----------------------------------------------------------------------
     * Responsive Player Aspect Ratio Skin (16:9, 9:16 Vertical Shorts, Theater)
     * ---------------------------------------------------------------------- */
    function setAspectSkin(aspect) {
      const isVertical = aspect === "9:16";
      playerStage.classList.toggle("aspect-9-16", isVertical);
      btnAspect916.classList.toggle("btn-primary", isVertical);
      btnAspect169.classList.toggle("btn-primary", !isVertical);
    }

    btnAspect169.addEventListener("click", () => setAspectSkin("16:9"));
    btnAspect916.addEventListener("click", () => setAspectSkin("9:16"));
    btnTheaterMode.addEventListener("click", () => {
      const active = watchLayout.classList.toggle("is-theater");
      btnTheaterMode.classList.toggle("btn-primary", active);
    });

    // Auto-adapt player skin when a local vertical 9:16 video file loads metadata
    videoEl.addEventListener("loadedmetadata", () => {
      if (!activeCatalogId && videoEl.videoWidth > 0 && videoEl.videoHeight > 0) {
        setAspectSkin(videoEl.videoHeight > videoEl.videoWidth ? "9:16" : "16:9");
      }
    });

    /* ----------------------------------------------------------------------
     * Persistent Subtitle Track Selection & Native `<track>` Injection
     * ---------------------------------------------------------------------- */
    function updateSavedPrefBadge() {
      const resolved = LocalizationManager.resolvePreferredSubtitleTrack();
      const language = SUPPORTED_LANGUAGES.find((item) => item.code === resolved.trackLang);
      const label = resolved.trackLang === "off" ? "Off" : (language ? language.nativeName : resolved.trackLang);
      savedPrefIndicator.textContent = `${LocalizationManager.t(uiLang, "prefIndicatorPrefix")}: ${label}`;
    }

    function renderInteractiveTranscript(activeTrackLang) {
      if (!currentResult) return;
      const docs = currentResult.trackDocs || { en: currentResult.enDoc, pl: currentResult.plDoc };
      const effectiveLang = docs[activeTrackLang] ? activeTrackLang : (docs.pl ? "pl" : "en");
      const doc = docs[effectiveLang];
      if (!doc) return;
      transcriptLangBadge.textContent = effectiveLang.toUpperCase();
      transcriptListEl.innerHTML = "";

      doc.cues.forEach((cue) => {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "transcript-row";
        row.dataset.startMs = String(cue.timing.startMs);
        row.dataset.endMs = String(cue.timing.endMs);

        const timeEl = document.createElement("span");
        timeEl.className = "transcript-time";
        timeEl.textContent = formatShortTimecode(cue.timing.startMs);

        const textEl = document.createElement("span");
        textEl.className = "transcript-text";
        textEl.textContent = cue.text.replace(/<[^>]+>/g, "");

        row.appendChild(timeEl);
        row.appendChild(textEl);

        row.addEventListener("click", () => {
          if (Number.isFinite(videoEl.duration)) {
            videoEl.currentTime = cue.timing.startMs / 1000;
            videoEl.play().catch(() => {});
          }
        });
        transcriptListEl.appendChild(row);
      });
    }

    videoEl.addEventListener("timeupdate", () => {
      const nowMs = videoEl.currentTime * 1000;
      const rows = transcriptListEl.querySelectorAll(".transcript-row");
      rows.forEach((row) => {
        const start = Number(row.dataset.startMs);
        const end = Number(row.dataset.endMs);
        row.classList.toggle("is-current", nowMs >= start && nowMs <= end);
      });
    });

    function normalizeTrackCode(value) {
      const code = String(value || "").toLowerCase();
      const language = SUPPORTED_LANGUAGES.find((item) => item.code.toLowerCase() === code);
      return language ? language.code : (code === "off" ? "off" : String(value || ""));
    }

    function activateSubtitleTrack(lang, { persistPreference = true } = {}) {
      lang = normalizeTrackCode(lang);
      suppressNativeTrackEvent = true;
      const tracks = videoEl.textTracks;
      for (let i = 0; i < tracks.length; i += 1) {
        tracks[i].mode = normalizeTrackCode(tracks[i].language) === lang ? "showing" : "disabled";
      }
      setTimeout(() => { suppressNativeTrackEvent = false; }, 50);

      trackSelectBtns.forEach((btn) => btn.classList.toggle("active", btn.dataset.trackSelect === lang));
      if (catalogLanguageSelect) {
        catalogLanguageSelect.value = ["en", "pl", "off"].includes(lang) ? "" : lang;
      }
      if (persistPreference) {
        LocalizationManager.savePreferredSubtitleTrack(lang);
        updateSavedPrefBadge();
      }
      if (lang !== "off") renderInteractiveTranscript(lang);
    }

    const SPEECH_RECOGNITION_LOCALES = {
      en: "en-US", pl: "pl-PL", es: "es-ES", ja: "ja-JP", "zh-CN": "zh-CN",
      de: "de-DE", fr: "fr-FR", ar: "ar-SA", hi: "hi-IN", pt: "pt-BR",
      ru: "ru-RU", bn: "bn-BD", id: "id-ID", ur: "ur-PK", tr: "tr-TR",
      it: "it-IT", ko: "ko-KR", vi: "vi-VN", fa: "fa-IR", sw: "sw-KE",
      nl: "nl-NL", th: "th-TH", ms: "ms-MY", uk: "uk-UA", ta: "ta-IN",
      mr: "mr-IN", pa: "pa-IN", tl: "fil-PH"
    };

    function populateLiveLanguageSelectors() {
      if (liveSourceLanguageSelect) {
        liveSourceLanguageSelect.replaceChildren();
        SUPPORTED_LANGUAGES.forEach((language) => {
          const option = document.createElement("option");
          option.value = language.code;
          option.textContent = `${language.nativeName} — ${language.name}`;
          liveSourceLanguageSelect.appendChild(option);
        });
        liveSourceLanguageSelect.value = "ja";
      }
      if (liveTargetLanguageSelect) {
        liveTargetLanguageSelect.replaceChildren();
        SUPPORTED_LANGUAGES.forEach((language) => {
          const option = document.createElement("option");
          option.value = language.code;
          option.textContent = `${language.nativeName} — ${language.name}`;
          liveTargetLanguageSelect.appendChild(option);
        });
        liveTargetLanguageSelect.value = "pl";
      }
    }

    function setLiveCaptionStatus(key, listening = false) {
      liveStatusKey = key;
      if (!liveCaptionStatus) return;
      liveCaptionStatus.textContent = LocalizationManager.t(uiLang, key);
      liveCaptionStatus.classList.toggle("is-listening", listening);
    }

    function getShowingSubtitleLanguage() {
      for (let i = 0; i < videoEl.textTracks.length; i += 1) {
        if (videoEl.textTracks[i].mode === "showing") {
          return normalizeTrackCode(videoEl.textTracks[i].language);
        }
      }
      return "off";
    }

    function displayLiveCaption(text) {
      if (!liveCaptionOverlay || !text) return;
      liveCaptionOverlay.textContent = text;
      liveCaptionOverlay.hidden = false;
      if (liveCaptionHideTimer) clearTimeout(liveCaptionHideTimer);
      const duration = Math.max(2800, Math.min(6500, text.length * 75));
      liveCaptionHideTimer = setTimeout(() => {
        if (liveCaptionOverlay) liveCaptionOverlay.hidden = true;
      }, duration);
    }

    function stopLiveCaptions({ restoreTrack = true, statusKey = "liveCaptionIdle" } = {}) {
      liveActive = false;
      liveStarting = false;
      liveSessionToken += 1;
      const recognition = liveRecognition;
      liveRecognition = null;
      if (recognition) {
        recognition.onresult = null;
        recognition.onend = null;
        try { recognition.stop(); } catch (_error) { /* already stopped */ }
      }
      if (liveAudioStream) {
        liveAudioStream.getTracks().forEach((track) => track.stop());
      }
      liveAudioStream = null;
      liveAudioTrack = null;
      liveTranslator = null;
      liveUsingMicFallback = false;
      if (btnLiveCaptions) {
        btnLiveCaptions.disabled = false;
        btnLiveCaptions.textContent = LocalizationManager.t(uiLang, "btnStartListening");
      }
      [liveSourceLanguageSelect, liveTargetLanguageSelect, liveAudioSourceSelect].forEach((select) => {
        if (select) select.disabled = false;
      });
      if (liveCaptionOverlay) liveCaptionOverlay.hidden = true;
      if (liveCaptionHeard) liveCaptionHeard.hidden = true;
      if (liveCaptionTranscript) liveCaptionTranscript.textContent = "";
      if (liveCaptionHideTimer) clearTimeout(liveCaptionHideTimer);
      setLiveCaptionStatus(statusKey, false);
      const previousTrack = livePreviousTrack;
      livePreviousTrack = "off";
      if (restoreTrack && previousTrack !== "off") {
        selectCatalogTrack(previousTrack);
      } else {
        activateSubtitleTrack("off", { persistPreference: false });
      }
    }

    async function startLiveCaptions() {
      if (liveActive || liveStarting) return;
      const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!Recognition) {
        showToast({
          title: uiLang === "pl" ? "Brak rozpoznawania mowy" : "Speech recognition unavailable",
          message: LocalizationManager.t(uiLang, "liveCaptionUnsupported"),
          variant: "warning",
          durationMs: 7500
        });
        return;
      }
      liveStarting = true;
      if (btnLiveCaptions) btnLiveCaptions.disabled = true;
      let audioTrack = null;
      try {
        if (liveAudioSourceSelect && liveAudioSourceSelect.value === "tab") {
          if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
            liveUsingMicFallback = true;
          } else {
            try {
              liveAudioStream = await navigator.mediaDevices.getDisplayMedia({
                video: { frameRate: 1 }, audio: true
              });
              audioTrack = liveAudioStream.getAudioTracks()[0] || null;
              if (!audioTrack) {
                liveAudioStream.getTracks().forEach((track) => track.stop());
                liveAudioStream = null;
                liveUsingMicFallback = true;
              }
            } catch (captureError) {
              console.warn("Shared-tab audio unavailable; falling back to microphone:", captureError);
              if (liveAudioStream) liveAudioStream.getTracks().forEach((track) => track.stop());
              liveAudioStream = null;
              liveUsingMicFallback = true;
            }
          }
        }

        const recognition = new Recognition();
        const sourceCode = liveSourceLanguageSelect?.value || "ja";
        recognition.lang = SPEECH_RECOGNITION_LOCALES[sourceCode] || sourceCode;
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;
        liveSessionToken += 1;
        const sessionToken = liveSessionToken;
        livePreviousTrack = getShowingSubtitleLanguage();
        if (livePreviousTrack !== "off") activateSubtitleTrack("off", { persistPreference: false });
        liveRecognition = recognition;
        liveAudioTrack = audioTrack;
        liveTranslator = new ClientTranslator({ ...appSettings });
        liveTranslator.resetCircuit();
        liveTranslationQueue = Promise.resolve();
        liveFallbackToastShown = false;
        liveActive = true;
        liveStarting = false;
        [liveSourceLanguageSelect, liveTargetLanguageSelect, liveAudioSourceSelect].forEach((select) => {
          if (select) select.disabled = true;
        });
        if (btnLiveCaptions) {
          btnLiveCaptions.disabled = false;
          btnLiveCaptions.textContent = LocalizationManager.t(uiLang, "btnStopListening");
        }
        setLiveCaptionStatus("liveCaptionListening", true);

        recognition.onstart = () => {
          if (liveStatusKey !== "liveCaptionNoSpeech") {
            setLiveCaptionStatus(liveUsingMicFallback ? "liveCaptionUsingMicFallback" : "liveCaptionListening", true);
          }
        };
        recognition.onresult = (event) => {
          const interimParts = [];
          for (let index = event.resultIndex; index < event.results.length; index += 1) {
            const speechResult = event.results[index];
            const transcript = speechResult[0]?.transcript?.trim();
            if (!transcript) continue;
            if (!speechResult.isFinal) {
              interimParts.push(transcript);
              continue;
            }
            if (liveCaptionTranscript) liveCaptionTranscript.textContent = transcript;
            if (liveCaptionHeard) liveCaptionHeard.hidden = false;
            setLiveCaptionStatus(liveUsingMicFallback ? "liveCaptionUsingMicFallback" : "liveCaptionListening", true);
            const source = liveSourceLanguageSelect?.value || "ja";
            const target = liveTargetLanguageSelect?.value || "pl";
            liveTranslationQueue = liveTranslationQueue.then(async () => {
              if (!liveActive || sessionToken !== liveSessionToken) return;
              const result = await translateLiveTranscript(transcript, source, target, liveTranslator);
              if (!liveActive || sessionToken !== liveSessionToken) return;
              displayLiveCaption(result.text);
              if (source !== target && result.providerUsed === "offline-smart-dictionary" && !liveFallbackToastShown) {
                liveFallbackToastShown = true;
                showToast({
                  title: uiLang === "pl" ? "Tłumaczenie online niedostępne" : "Online translation unavailable",
                  message: LocalizationManager.t(uiLang, "liveCaptionTranslationFailed"),
                  variant: "warning",
                  durationMs: 7000
                });
              }
            }).catch((error) => {
              if (!liveActive || sessionToken !== liveSessionToken) return;
              console.error("Live caption translation failed:", error);
              showToast({
                title: uiLang === "pl" ? "Błąd napisów na żywo" : "Live caption error",
                message: LocalizationManager.t(uiLang, "liveCaptionTranslationFailed"),
                variant: "error"
              });
            });
          }
          if (interimParts.length && liveCaptionTranscript) {
            liveCaptionTranscript.textContent = `${interimParts.join(" ")} …`;
            if (liveCaptionHeard) liveCaptionHeard.hidden = false;
          }
        };
        recognition.onerror = (event) => {
          if (event.error === "aborted") return;
          if (event.error === "no-speech") {
            setLiveCaptionStatus("liveCaptionNoSpeech", true);
            return;
          }
          if (event.error === "audio-capture" && liveAudioTrack) {
            liveUsingMicFallback = true;
            const failedStream = liveAudioStream;
            liveAudioStream = null;
            liveAudioTrack = null;
            if (failedStream) failedStream.getTracks().forEach((track) => track.stop());
            setLiveCaptionStatus("liveCaptionUsingMicFallback", true);
            return;
          }
          const errorKey = event.error === "network" ? "liveCaptionNetworkError"
            : event.error === "audio-capture" ? "liveCaptionAudioError"
              : event.error === "language-not-supported" ? "liveCaptionLanguageError"
                : "liveCaptionUnsupported";
          const message = event.error === "not-allowed"
            ? (uiLang === "pl" ? "Zezwól przeglądarce na dostęp do dźwięku. Jeśli to podgląd w ramce, otwórz aplikację w osobnej karcie." : "Allow audio access. If this is an embedded preview, open the app in its own tab.")
            : LocalizationManager.t(uiLang, errorKey);
          showToast({
            title: uiLang === "pl" ? "Rozpoznawanie mowy zatrzymane" : "Speech recognition stopped",
            message,
            variant: "warning"
          });
          stopLiveCaptions({ statusKey: "liveCaptionIdle" });
        };
        recognition.onend = () => {
          if (!liveActive || sessionToken !== liveSessionToken || liveRecognition !== recognition) return;
          setTimeout(() => {
            if (!liveActive || sessionToken !== liveSessionToken || liveRecognition !== recognition) return;
            try {
              if (liveAudioTrack) recognition.start(liveAudioTrack);
              else recognition.start();
            } catch (error) {
              console.warn("Could not restart live speech recognition:", error);
              stopLiveCaptions({ statusKey: "liveCaptionIdle" });
            }
          }, 350);
        };
        if (liveAudioStream) {
          liveAudioStream.getTracks().forEach((track) => {
            track.addEventListener("ended", () => {
              if (liveActive && sessionToken === liveSessionToken && !liveUsingMicFallback) {
                stopLiveCaptions({ statusKey: "liveCaptionIdle" });
              }
            }, { once: true });
          });
        }
        if (audioTrack) {
          try {
            recognition.start(audioTrack);
          } catch (tabStartError) {
            console.warn("Speech recognition rejected shared-tab audio; falling back to microphone:", tabStartError);
            if (liveAudioStream) liveAudioStream.getTracks().forEach((track) => track.stop());
            liveAudioStream = null;
            liveAudioTrack = null;
            audioTrack = null;
            liveUsingMicFallback = true;
            setLiveCaptionStatus("liveCaptionUsingMicFallback", true);
            recognition.start();
          }
        } else {
          recognition.start();
        }
      } catch (error) {
        console.error("Could not start live captions:", error);
        liveStarting = false;
        if (liveActive) stopLiveCaptions();
        else {
          if (liveAudioStream) liveAudioStream.getTracks().forEach((track) => track.stop());
          liveAudioStream = null;
          liveUsingMicFallback = false;
          if (btnLiveCaptions) btnLiveCaptions.disabled = false;
          setLiveCaptionStatus("liveCaptionIdle", false);
          showToast({
            title: uiLang === "pl" ? "Nie można uruchomić napisów na żywo" : "Could not start live captions",
            message: audioTrack
              ? LocalizationManager.t(uiLang, "liveCaptionTabUnsupported")
              : (error.message || LocalizationManager.t(uiLang, "liveCaptionUnsupported")),
            variant: "warning",
            durationMs: 8000
          });
        }
      }
    }

    if (btnLiveCaptions) {
      populateLiveLanguageSelectors();
      btnLiveCaptions.addEventListener("click", () => {
        if (liveActive) stopLiveCaptions();
        else startLiveCaptions();
      });
    }

    trackSelectBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        if (liveActive) stopLiveCaptions({ restoreTrack: false });
        const lang = btn.dataset.trackSelect;
        if (lang === "off") {
          languageSelectionToken += 1;
          activateSubtitleTrack(lang, { persistPreference: true });
        } else selectCatalogTrack(lang);
      });
    });
    if (catalogLanguageSelect) {
      catalogLanguageSelect.addEventListener("change", () => {
        if (liveActive) stopLiveCaptions({ restoreTrack: false });
        if (catalogLanguageSelect.value) selectCatalogTrack(catalogLanguageSelect.value);
      });
    }

    if (videoEl.textTracks && videoEl.textTracks.addEventListener) {
      videoEl.textTracks.addEventListener("change", () => {
        if (suppressNativeTrackEvent) return;
        let active = "off";
        for (let i = 0; i < videoEl.textTracks.length; i += 1) {
          if (videoEl.textTracks[i].mode === "showing") { active = normalizeTrackCode(videoEl.textTracks[i].language); break; }
        }
        trackSelectBtns.forEach((btn) => btn.classList.toggle("active", btn.dataset.trackSelect === active));
        if (catalogLanguageSelect) catalogLanguageSelect.value = ["en", "pl", "off"].includes(active) ? "" : active;
        LocalizationManager.savePreferredSubtitleTrack(active);
        updateSavedPrefBadge();
        if (active !== "off") renderInteractiveTranscript(active);
      });
    }

    function renderCatalogLanguageOptions(trackMap) {
      if (!catalogLanguageSelect) return;
      while (catalogLanguageSelect.options.length > 1) catalogLanguageSelect.remove(1);
      Object.keys(trackMap || {}).filter((code) => !["en", "pl"].includes(code)).forEach((code) => {
        const language = SUPPORTED_LANGUAGES.find((item) => item.code === code);
        const option = document.createElement("option");
        option.value = code;
        option.textContent = language ? `${language.nativeName} — ${language.name}` : code;
        catalogLanguageSelect.appendChild(option);
      });
    }

    async function ensureCatalogLanguage(item, lang) {
      if (!item || !item.tracks || !item.tracks[lang] || lang === item.sourceLanguage || item.translationMode !== "offline") {
        return currentResult && currentResult.trackDocs && currentResult.trackDocs[lang];
      }
      if (currentResult?.generatedLanguages?.has(lang)) return currentResult.trackDocs[lang];
      const requestKey = `${item.id}:${lang}`;
      if (dynamicLanguagePromises.has(requestKey)) return dynamicLanguagePromises.get(requestKey);

      const work = (async () => {
        try {
          if (!sourceSubtitlePromise) {
            if (!item.sourceSubtitle) throw new Error("No source subtitle is published for this video.");
            sourceSubtitlePromise = (async () => {
              const sourceUrl = new URL(item.sourceSubtitle, document.baseURI).toString();
              const response = await fetch(sourceUrl);
              if (!response.ok) throw new Error(`Source subtitle fetch failed (${response.status})`);
              return response.text();
            })();
          }
          const raw = await sourceSubtitlePromise;
          const sourceHash = hashFingerprint(raw);
          const cacheKey = `streampl_generated_${hashFingerprint(`${item.id}|${sourceHash}|${lang}|42`)}`;
          let vtt = null;
          try { vtt = localStorage.getItem(cacheKey); } catch (_error) { /* storage may be unavailable */ }
          let result;
          if (vtt) {
            const doc = SubtitleParser.parse(vtt, `cached_${lang}.vtt`);
            result = { vtt, doc, providerUsed: "instant-local-cache" };
          } else {
            const filename = item.sourceSubtitle.split("/").pop() || `${item.id}.srt`;
            result = await translateSubtitleToLanguage(raw, lang, {
              filename,
              sourceLang: item.sourceLanguage || undefined,
              settings: appSettings,
              registerMode: activeRegister,
              onFallback() {
                showToast({
                  title: LocalizationManager.t(uiLang, "toastFallbackTitle"),
                  message: LocalizationManager.t(uiLang, "toastFallbackMsg"),
                  variant: "warning"
                });
              }
            });
            if (result.providerUsed !== "offline-smart-dictionary" || lang === item.sourceLanguage) {
              try { localStorage.setItem(cacheKey, result.vtt); } catch (_error) { /* memory result is still usable */ }
            }
          }
          if (currentCatalogRecord !== item || !currentResult) return null;
          currentResult.trackVtts[lang] = result.vtt;
          currentResult.trackDocs[lang] = result.doc;
          if (!currentResult.generatedLanguages) currentResult.generatedLanguages = new Set();
          if (result.providerUsed !== "offline-smart-dictionary" || lang === item.sourceLanguage) {
            currentResult.generatedLanguages.add(lang);
          }
          providerBadge.textContent = result.providerUsed;
          if (result.providerUsed === "offline-smart-dictionary" && lang !== item.sourceLanguage) {
            showToast({
              title: uiLang === "pl" ? "Brak tłumaczenia online" : "Online translation unavailable",
              message: uiLang === "pl" ? "Wyświetlany jest tekst źródłowy. Połączenie z Google GTX lub MyMemory nie powiodło się." : "Showing source text because Google GTX and MyMemory could not be reached.",
              variant: "warning"
            });
          }
          return result.doc;
        } catch (error) {
          if (currentCatalogRecord === item) {
            sourceSubtitlePromise = null;
            showToast({ title: uiLang === "pl" ? "Nie udało się przygotować napisów" : "Could not prepare subtitles", message: error.message, variant: "error" });
          }
          return null;
        } finally {
          dynamicLanguagePromises.delete(requestKey);
        }
      })();
      dynamicLanguagePromises.set(requestKey, work);
      return work;
    }

    async function selectCatalogTrack(lang) {
      const selectionToken = ++languageSelectionToken;
      const item = currentCatalogRecord;
      if (item && item.translationMode === "offline" && lang !== item.sourceLanguage) {
        catalogLanguageSelect.disabled = true;
        providerBadge.textContent = uiLang === "pl" ? "Tłumaczenie…" : "Translating…";
        const doc = await ensureCatalogLanguage(item, lang);
        catalogLanguageSelect.disabled = false;
        if (selectionToken !== languageSelectionToken || !doc || currentCatalogRecord !== item) return;
        injectVirtualTracks(currentResult.trackVtts, lang);
      }
      activateSubtitleTrack(lang, { persistPreference: true });
    }

    function injectVirtualTracks(trackVtts, activeTrackLang) {
      Array.from(videoEl.querySelectorAll("track")).forEach((track) => track.remove());
      Object.entries(currentTrackUrls).forEach(([code, url]) => {
        if (code !== "video" && url) URL.revokeObjectURL(url);
      });
      const videoUrl = currentTrackUrls.video;
      currentTrackUrls = { video: videoUrl };
      const baseStem = currentSubFilename
        .replace(/\.[^.]+$/, "")
        .replace(/[._-](?:en|pl|eng|pol)$/i, "");

      Object.entries(trackVtts || {}).forEach(([code, vtt]) => {
        const blob = new Blob([vtt], { type: "text/vtt;charset=utf-8" });
        const objectUrl = URL.createObjectURL(blob);
        currentTrackUrls[code] = objectUrl;
        const descriptor = SUPPORTED_LANGUAGES.find((item) => item.code === code);
        const track = document.createElement("track");
        track.kind = "subtitles";
        track.label = descriptor ? descriptor.nativeName : code;
        track.srclang = code;
        track.src = objectUrl;
        if (activeTrackLang === code) track.default = true;
        videoEl.appendChild(track);
      });

      if (trackVtts.en) {
        downloadEnLink.href = currentTrackUrls.en;
        downloadEnLink.download = `${baseStem || "subtitles"}_en.vtt`;
      }
      if (trackVtts.pl) {
        downloadPlLink.href = currentTrackUrls.pl;
        downloadPlLink.download = `${baseStem || "subtitles"}_pl.vtt`;
      }
      renderCatalogLanguageOptions(trackVtts);
      requestAnimationFrame(() => activateSubtitleTrack(activeTrackLang, { persistPreference: false }));
    }

    /* ----------------------------------------------------------------------
     * Settings & Cache Controls
     * ---------------------------------------------------------------------- */
    function loadAppSettings() {
      try {
        const raw = localStorage.getItem(STORAGE_KEYS.SETTINGS);
        if (raw) return JSON.parse(raw);
      } catch (_e) {
        // Ignore
      }
      return {
        provider: "auto",
        apiKey: "",
        customEndpoint: "",
        maxCpl: 42,
        llmModel: "gpt-4o-mini"
      };
    }

    let appSettings = loadAppSettings();

    function syncSettingsInputs() {
      inputProvider.value = appSettings.provider || "auto";
      inputApiKey.value = appSettings.apiKey || "";
      inputCustomEndpoint.value = appSettings.customEndpoint || "";
      inputMaxCpl.value = appSettings.maxCpl || 42;
      inputLlmModel.value = appSettings.llmModel || "gpt-4o-mini";
    }

    function updateCacheStatsBadge() {
      if (!cacheStatsBadge) return;
      const count = cacheStore.size();
      cacheStatsBadge.textContent =
        uiLang === "pl" ? `${count} w pamięci` : `${count} cached`;
    }

    btnResetSettings.addEventListener("click", () => {
      appSettings = {
        provider: "auto",
        apiKey: "",
        customEndpoint: "",
        maxCpl: 42,
        llmModel: "gpt-4o-mini"
      };
      try {
        localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(appSettings));
      } catch (_e) {
        // Ignore
      }
      syncSettingsInputs();
    });

    btnSaveSettings.addEventListener("click", () => {
      appSettings = {
        provider: inputProvider.value,
        apiKey: inputApiKey.value.trim(),
        customEndpoint: inputCustomEndpoint.value.trim(),
        maxCpl: Math.min(60, Math.max(20, Number(inputMaxCpl.value) || 42)),
        llmModel: inputLlmModel.value.trim() || "gpt-4o-mini"
      };
      try {
        localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(appSettings));
      } catch (_e) {
        // Ignore
      }
      runTranslationPipeline({ bypassCache: true, notifySuccess: true });
    });

    btnClearCache.addEventListener("click", () => {
      cacheStore.clear();
      updateCacheStatsBadge();
      cacheHitBadge.hidden = true;
      showToast({
        title: LocalizationManager.t(uiLang, "toastCacheClearedTitle"),
        message: LocalizationManager.t(uiLang, "toastCacheClearedMsg"),
        variant: "info"
      });
    });

    /* ----------------------------------------------------------------------
     * Studio Diagnostics Cue Inspector
     * ---------------------------------------------------------------------- */
    function renderDiagnosticCues(containerEl, doc, maxCplLimit) {
      containerEl.innerHTML = "";
      doc.cues.forEach((cue) => {
        const item = document.createElement("div");
        item.className = "cue-item";
        const lines = cue.text.split("\n");
        const maxLineLen = Math.max(
          ...lines.map((ln) => Math.max(visibleCharLength(ln), ln.length))
        );

        const meta = document.createElement("div");
        meta.className = "cue-meta";
        const startStr = formatMsTimestamp(cue.timing.startMs, ".");
        const endStr = formatMsTimestamp(cue.timing.endMs, ".");
        meta.innerHTML =
          `<span>#${cue.identifier} • ${startStr} → ${endStr}</span>` +
          `<span class="cpl-ok">${maxLineLen}/${maxCplLimit} CPL</span>`;

        const textDiv = document.createElement("div");
        textDiv.className = "cue-lines";
        textDiv.textContent = cue.text;

        item.appendChild(meta);
        item.appendChild(textDiv);
        item.addEventListener("click", () => {
          if (Number.isFinite(videoEl.duration)) {
            videoEl.currentTime = cue.timing.startMs / 1000;
          }
        });
        containerEl.appendChild(item);
      });
    }

    /* ----------------------------------------------------------------------
     * Main Translation Execution (Cache-First + Toast Fallback Handling)
     * ---------------------------------------------------------------------- */
    async function runTranslationPipeline({
      bypassCache = false,
      notifySuccess = false
    } = {}) {
      const rawText = editorEl.value;
      btnTranslate.disabled = true;
      progressEl.style.width = "12%";
      statusEl.className = "status-line";

      try {
        const result = await translateSubtitlePayload(rawText, {
          filename: currentSubFilename,
          videoKey: currentVideoKey,
          maxCpl: appSettings.maxCpl || 42,
          registerMode: activeRegister,
          settings: appSettings,
          cacheStore,
          bypassCache,
          onProgress(pct, done, total) {
            progressEl.style.width = `${pct}%`;
            pctEl.textContent = `${pct}%`;
            statusEl.firstElementChild.textContent = `Cue ${done}/${total}...`;
          },
          onFallback() {
            showToast({
              title: LocalizationManager.t(uiLang, "toastFallbackTitle"),
              message: LocalizationManager.t(uiLang, "toastFallbackMsg"),
              variant: "warning"
            });
          }
        });

        currentResult = result;
        currentResult.trackDocs = { en: result.enDoc, pl: result.plDoc };

        // Resolve viewer's preferred or browser-detected subtitle track
        const { trackLang } = LocalizationManager.resolvePreferredSubtitleTrack();
        const selectedLang = ["en", "pl"].includes(trackLang) ? trackLang : (trackLang === "off" ? "off" : "pl");
        injectVirtualTracks({ en: result.enVtt, pl: result.plVtt }, selectedLang);
        if (selectedLang !== "off") renderInteractiveTranscript(selectedLang);

        // Update Diagnostics & Cache Badges
        cacheHitBadge.hidden = !result.fromCache;
        updateCacheStatsBadge();

        renderDiagnosticCues(cueListEn, result.enDoc, appSettings.maxCpl || 42);
        renderDiagnosticCues(cueListPl, result.plDoc, appSettings.maxCpl || 42);

        enMaxCplBadge.textContent = `Max: ${result.maxCplEn}/${appSettings.maxCpl || 42} CPL`;
        plMaxCplBadge.textContent = `Max: ${result.maxCplPl}/${appSettings.maxCpl || 42} CPL`;
        metricLang.textContent = `${result.detectedLang.toUpperCase()} → ${result.targetLang.toUpperCase()}`;
        metricCues.textContent = String(result.cueCount);
        metricCpl.textContent = `${Math.max(result.maxCplEn, result.maxCplPl)} / ${appSettings.maxCpl || 42}`;
        providerBadge.textContent = result.fromCache
          ? "⚡ Instant Cache (<1ms)"
          : result.providerUsed;

        progressEl.style.width = "100%";
        pctEl.textContent = "100%";
        statusEl.className = "status-line ok";
        statusEl.firstElementChild.textContent = result.fromCache
          ? `Loaded ${result.cueCount} cues instantly from local cache.`
          : `Translated ${result.cueCount} cues (${result.providerUsed}).`;

        if (notifySuccess && !result.fallbackOccurred) {
          showToast({
            title: LocalizationManager.t(uiLang, "toastTranslatedTitle"),
            message: LocalizationManager.t(uiLang, "toastTranslatedMsg"),
            variant: "success",
            durationMs: 3200
          });
        }
      } catch (err) {
        statusEl.className = "status-line err";
        statusEl.firstElementChild.textContent = `Error: ${err.message}`;
        showToast({
          title: "Subtitle Error",
          message: err.message,
          variant: "error"
        });
      } finally {
        btnTranslate.disabled = false;
      }
    }

    /* ----------------------------------------------------------------------
     * Offline Studio Stream (16:9 or 9:16 Portrait Canvas Generator)
     * ---------------------------------------------------------------------- */
    function activateOfflineStudioStream(portrait = false) {
      const canvas = document.createElement("canvas");
      canvas.width = portrait ? 540 : 960;
      canvas.height = portrait ? 960 : 540;
      const ctx = canvas.getContext("2d");
      if (!ctx || typeof canvas.captureStream !== "function") return;

      const startTs = performance.now();
      function drawFrame(now) {
        const elapsed = (now - startTs) / 1000;
        const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
        grad.addColorStop(0, "#090d16");
        grad.addColorStop(1, "#1e1b4b");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const bars = portrait ? 20 : 34;
        const barW = 10;
        const spacing = 16;
        const startX = (canvas.width - bars * spacing) / 2;
        ctx.fillStyle = "rgba(56, 189, 248, 0.38)";
        for (let i = 0; i < bars; i += 1) {
          const h = 22 + Math.abs(Math.sin(elapsed * 3.1 + i * 0.45)) * 86;
          ctx.fillRect(startX + i * spacing, canvas.height / 2 - h / 2, barW, h);
        }

        ctx.fillStyle = "#f8fafc";
        ctx.font = portrait ? "bold 22px system-ui, sans-serif" : "bold 26px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(
          portrait ? "9:16 VERTICAL STUDIO" : "STREAMPL LIVE STUDIO",
          canvas.width / 2,
          canvas.height * 0.24
        );

        ctx.fillStyle = "#94a3b8";
        ctx.font = "16px monospace";
        ctx.fillText(
          formatMsTimestamp(Math.floor((elapsed % 45) * 1000), "."),
          canvas.width / 2,
          canvas.height * 0.31
        );

        canvasAnimId = requestAnimationFrame(drawFrame);
      }

      if (canvasAnimId) cancelAnimationFrame(canvasAnimId);
      drawFrame(performance.now());
      videoEl.removeAttribute("src");
      videoEl.srcObject = canvas.captureStream(30);
      videoEl.play().catch(() => {});
    }

    videoEl.addEventListener("error", () => {
      if (videoEl.srcObject) return;
      activateOfflineStudioStream(playerStage.classList.contains("aspect-9-16"));
      if (providerBadge) providerBadge.textContent = "Offline Demo Stream";
      showToast({
        title: uiLang === "pl" ? "Uruchomiono strumień demonstracyjny" : "Demo stream started",
        message: uiLang === "pl"
          ? "Źródłowe wideo jest niedostępne lub ma nieobsługiwany format. Odtwarzany jest lokalny strumień zastępczy."
          : "The sample video is unavailable or unsupported. A generated in-browser demo stream is playing instead.",
        variant: "warning",
        durationMs: 6500
      });
    });

    btnMockStream.addEventListener("click", () => {
      activateOfflineStudioStream(playerStage.classList.contains("aspect-9-16"));
    });

    /* ----------------------------------------------------------------------
     * Featured Video Catalog Switching & Custom File / URL Loading
     * ---------------------------------------------------------------------- */
    function localizedValue(value, lang) {
      if (value && typeof value === "object") return value[lang] || value.en || value.pl || "";
      return String(value || "");
    }

    function renderCatalogCards(records) {
      const grid = document.getElementById("playlist-grid");
      if (!grid) return;
      grid.replaceChildren();
      for (const record of records) {
        const card = document.createElement("button");
        card.type = "button";
        card.className = `video-card${record.id === activeCatalogId ? " active" : ""}`;
        card.dataset.videoId = record.id;
        const upper = document.createElement("div");
        const thumb = document.createElement("div");
        thumb.className = "video-card-thumb";
        const tag = document.createElement("span");
        tag.className = "video-card-tag";
        const languageCount = Object.keys(record.tracks || {}).length;
        tag.textContent = `${record.aspect || "16:9"} • ${(record.sourceLanguage || "en").toUpperCase()} source • ${languageCount} CC`;
        const duration = document.createElement("span");
        duration.className = "badge";
        duration.textContent = record.duration || "CC";
        thumb.append(tag, duration);
        const title = document.createElement("h3");
        title.className = "video-card-title";
        title.textContent = localizedValue(record.title, uiLang) || record.id;
        upper.append(thumb, title);
        const desc = document.createElement("p");
        desc.className = "video-card-sub";
        desc.textContent = localizedValue(record.description, uiLang);
        card.append(upper, desc);
        card.addEventListener("click", () => loadCatalogItem(record.id));
        grid.appendChild(card);
      }
      playlistCards = Array.from(grid.querySelectorAll("[data-video-id]"));
    }

    async function loadCatalogItem(videoId) {
      if (liveActive) stopLiveCaptions({ restoreTrack: false });
      const item = VIDEO_CATALOG[videoId];
      if (!item) return;
      const requestToken = ++catalogLoadToken;
      languageSelectionToken += 1;
      activeCatalogId = videoId;
      currentCatalogRecord = item;
      sourceSubtitlePromise = null;
      dynamicLanguagePromises.clear();
      currentVideoKey = `catalog:${videoId}`;
      currentSubFilename = item.subtitleFilename;
      playlistCards.forEach((card) => card.classList.toggle("active", card.dataset.videoId === videoId));
      setAspectSkin(item.aspect || "16:9");
      currentVideoTitle.textContent = localizedValue(item.title, uiLang) || videoId;
      currentVideoDesc.textContent = localizedValue(item.description, uiLang);

      if (canvasAnimId) {
        cancelAnimationFrame(canvasAnimId);
        canvasAnimId = null;
        videoEl.srcObject = null;
      }
      if (currentTrackUrls.video) {
        URL.revokeObjectURL(currentTrackUrls.video);
        currentTrackUrls.video = null;
      }
      Array.from(videoEl.querySelectorAll("track")).forEach((track) => track.remove());
      Object.entries(currentTrackUrls).forEach(([code, url]) => {
        if (code !== "video" && url) URL.revokeObjectURL(url);
      });
      currentTrackUrls = { video: null };
      renderCatalogLanguageOptions({});
      currentResult = null;
      transcriptListEl.replaceChildren();
      cacheHitBadge.hidden = true;
      videoEl.querySelectorAll("source").forEach((source) => source.remove());
      videoEl.removeAttribute("src");
      if (item.videoUrl) videoEl.src = item.videoUrl;
      videoEl.load();

      if (item.tracks && Object.keys(item.tracks).length) {
        try {
          const resolveCatalogUrl = (path) => new URL(path, document.baseURI).toString();
          const loaded = await Promise.all(Object.entries(item.tracks).map(async ([code, trackPath]) => {
            try {
              const response = await fetch(resolveCatalogUrl(trackPath));
              if (!response.ok) throw new Error(`HTTP ${response.status}`);
              return [code, await response.text()];
            } catch (error) {
              if (code === "en" || code === "pl") throw error;
              console.warn(`Skipping unavailable ${code} subtitle track for ${videoId}:`, error);
              return null;
            }
          }));
          const trackVtts = Object.fromEntries(loaded.filter(Boolean));
          if (!trackVtts.en || !trackVtts.pl) throw new Error("English and Polish catalog tracks are required");
          if (requestToken !== catalogLoadToken) return;
          const trackDocs = Object.fromEntries(Object.entries(trackVtts).map(([code, vtt]) => [
            code, SubtitleParser.parse(vtt, `catalog_${code}.vtt`)
          ]));
          const enDoc = trackDocs.en;
          const plDoc = trackDocs.pl;
          currentResult = {
            enDoc, plDoc, trackDocs, trackVtts,
            cueCount: Math.max(...Object.values(trackDocs).map((doc) => doc.cues.length)),
            detectedLang: item.sourceLanguage || "en", targetLang: item.sourceLanguage === "en" ? "pl" : "en",
            providerUsed: "catalog", fromCache: true,
            maxCplEn: measureDocumentCpl(enDoc), maxCplPl: measureDocumentCpl(plDoc)
          };
          const { trackLang } = LocalizationManager.resolvePreferredSubtitleTrack();
          const selectedLang = trackLang === "off" ? "off" : (trackDocs[trackLang] ? trackLang : "en");
          if (selectedLang !== "off" && selectedLang !== item.sourceLanguage && item.translationMode === "offline") {
            await ensureCatalogLanguage(item, selectedLang);
          }
          if (requestToken !== catalogLoadToken) return;
          injectVirtualTracks(currentResult.trackVtts, selectedLang);
          if (selectedLang !== "off") renderInteractiveTranscript(selectedLang);
          cacheHitBadge.hidden = false;
          providerBadge.textContent = "CMS Catalog";
          transcriptListEl.setAttribute("aria-label", `${videoId} transcript`);
          editorEl.value = "";
          subFileMeta.textContent = item.subtitleFilename;
          updateSavedPrefBadge();
        } catch (error) {
          if (requestToken !== catalogLoadToken) return;
          showToast({ title: "Catalog playback error", message: error.message, variant: "error" });
        }
      } else if (item.subtitlesRaw) {
        editorEl.value = item.subtitlesRaw;
        subFileMeta.textContent = item.subtitleFilename || "";
        runTranslationPipeline({ bypassCache: false });
      } else {
        currentResult = null;
        editorEl.value = "";
        transcriptListEl.replaceChildren();
        cacheHitBadge.hidden = true;
        providerBadge.textContent = "Awaiting subtitles";
        showToast({
          title: uiLang === "pl" ? "Napisy w przygotowaniu" : "Subtitles pending",
          message: uiLang === "pl" ? "Wideo jest dostępne, ale ścieżki napisów nie zostały jeszcze opublikowane." : "The video is listed, but subtitle tracks have not been published yet.",
          variant: "info"
        });
      }
    }

    function measureDocumentCpl(doc) {
      let max = 0;
      for (const cue of doc.cues || []) for (const line of cue.text.split("\n")) {
        max = Math.max(max, visibleCharLength(line), line.length);
      }
      return max;
    }

    async function loadMediaCatalog() {
      try {
        const response = await fetch("./data/catalog.json", { cache: "no-cache" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const catalog = await response.json();
        const records = Array.isArray(catalog) ? catalog : catalog.items;
        if (!Array.isArray(records)) throw new Error("Catalog must contain an items array");
        const normalized = records.filter((record) => record && record.id).map((record) => {
          const existing = VIDEO_CATALOG[record.id] || {};
          VIDEO_CATALOG[record.id] = {
            ...existing,
            ...record,
            id: record.id,
            aspect: record.aspect || existing.aspect || "16:9",
            videoUrl: record.video || record.videoUrl || existing.videoUrl || "",
            subtitleFilename: record.sourceSubtitle || existing.subtitleFilename || `${record.id}.srt`,
            subtitlesRaw: record.subtitlesRaw || "",
            tracks: record.tracks || null
          };
          return VIDEO_CATALOG[record.id];
        });
        if (!normalized.length) return;
        loadedCatalogRecords = normalized;
        renderCatalogCards(loadedCatalogRecords);
        const initial = normalized.find((record) => record.id === activeCatalogId) || normalized[0];
        loadCatalogItem(initial.id);
      } catch (error) {
        console.warn("Unable to load media catalog; using built-in demo catalog.", error);
        runTranslationPipeline({ bypassCache: false });
      }
    }

    playlistCards.forEach((card) => {
      card.addEventListener("click", () => loadCatalogItem(card.dataset.videoId));
    });

    // Creator Studio Register & Preset Buttons
    registerButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        registerButtons.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        activeRegister = btn.dataset.register;
        runTranslationPipeline({ bypassCache: false, notifySuccess: true });
      });
    });

    btnTranslate.addEventListener("click", () => {
      runTranslationPipeline({ bypassCache: false, notifySuccess: true });
    });

    btnForceRetranslate.addEventListener("click", () => {
      runTranslationPipeline({ bypassCache: true, notifySuccess: true });
    });

    btnPresetEn.addEventListener("click", () => {
      currentSubFilename = "sample_keynote_en.srt";
      editorEl.value = SAMPLE_SUBTITLES.en_keynote;
      runTranslationPipeline({ bypassCache: false, notifySuccess: true });
    });

    btnPresetPl.addEventListener("click", () => {
      currentSubFilename = "sample_interview_pl.srt";
      editorEl.value = SAMPLE_SUBTITLES.pl_interview;
      runTranslationPipeline({ bypassCache: false, notifySuccess: true });
    });

    // Local Video & Subtitle Drag-and-Drop / File Inputs
    function handleLocalVideoFile(file) {
      if (!file) return;
      if (liveActive) stopLiveCaptions({ restoreTrack: false });
      activeCatalogId = null;
      currentCatalogRecord = null;
      sourceSubtitlePromise = null;
      dynamicLanguagePromises.clear();
      playlistCards.forEach((c) => c.classList.remove("active"));
      if (canvasAnimId) {
        cancelAnimationFrame(canvasAnimId);
        canvasAnimId = null;
        videoEl.srcObject = null;
      }
      if (currentTrackUrls.video) URL.revokeObjectURL(currentTrackUrls.video);
      currentTrackUrls.video = URL.createObjectURL(file);
      currentVideoKey = `local:${file.name}:${file.size}`;
      videoEl.src = currentTrackUrls.video;
      videoEl.load();

      currentVideoTitle.textContent = file.name.replace(/\.[^.]+$/, "");
      videoFileMeta.textContent = `${file.name} (${(file.size / 1048576).toFixed(1)} MB)`;

      // If this video was previously translated, restore cached WebVTT tracks immediately!
      const cachedForVideo = cacheStore.getByVideoKey(currentVideoKey);
      if (cachedForVideo) {
        const { trackLang } = LocalizationManager.resolvePreferredSubtitleTrack();
        const enDoc = SubtitleParser.parse(cachedForVideo.enVtt, "en.vtt");
        const plDoc = SubtitleParser.parse(cachedForVideo.plVtt, "pl.vtt");
        currentResult = {
          ...cachedForVideo,
          enDoc,
          plDoc,
          fromCache: true
        };
        injectVirtualTracks({ en: cachedForVideo.enVtt, pl: cachedForVideo.plVtt }, trackLang === "off" ? "off" : (["en", "pl"].includes(trackLang) ? trackLang : "pl"));
        renderInteractiveTranscript(trackLang === "en" ? "en" : "pl");
        cacheHitBadge.hidden = false;
      }
    }

    async function handleSubtitleFile(file) {
      if (!file) return;
      currentSubFilename = file.name;
      subFileMeta.textContent = `${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
      editorEl.value = await file.text();
      runTranslationPipeline({ bypassCache: false, notifySuccess: true });
    }

    videoFileInput.addEventListener("change", (e) => handleLocalVideoFile(e.target.files[0]));
    subFileInput.addEventListener("change", (e) => handleSubtitleFile(e.target.files[0]));

    function wireDragAndDrop(zoneEl, onFile) {
      ["dragenter", "dragover"].forEach((evt) => {
        zoneEl.addEventListener(evt, (e) => {
          e.preventDefault();
          zoneEl.classList.add("dragover");
        });
      });
      ["dragleave", "drop"].forEach((evt) => {
        zoneEl.addEventListener(evt, (e) => {
          e.preventDefault();
          zoneEl.classList.remove("dragover");
        });
      });
      zoneEl.addEventListener("drop", (e) => {
        const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (file) onFile(file);
      });
    }

    wireDragAndDrop(videoDropzone, handleLocalVideoFile);
    wireDragAndDrop(subDropzone, handleSubtitleFile);

    btnLoadVideoUrl.addEventListener("click", () => {
      const url = videoUrlInput.value.trim();
      if (!url) return;
      if (liveActive) stopLiveCaptions({ restoreTrack: false });
      activeCatalogId = null;
      currentCatalogRecord = null;
      sourceSubtitlePromise = null;
      dynamicLanguagePromises.clear();
      currentVideoKey = `url:${url}`;
      if (canvasAnimId) {
        cancelAnimationFrame(canvasAnimId);
        canvasAnimId = null;
        videoEl.srcObject = null;
      }
      videoEl.src = url;
      videoEl.load();
      videoFileMeta.textContent = url;
    });

    // Fallback to Offline Studio Stream if remote sample MP4 fails
    const sourceElements = videoEl.querySelectorAll("source");
    if (sourceElements.length > 0) {
      sourceElements[sourceElements.length - 1].addEventListener("error", () => {
        activateOfflineStudioStream(playerStage.classList.contains("aspect-9-16"));
      });
    }

    // Boot: apply auto-detected UI language and hydrate the public playlist from CMS JSON.
    applyUiLocalization();
    editorEl.value = VIDEO_CATALOG.keynote.subtitlesRaw;
    loadMediaCatalog();
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", initBrowserExperience);
    } else {
      initBrowserExperience();
    }
  }

  return {
    SAMPLE_SUBTITLES,
    SUPPORTED_LANGUAGES,
    VIDEO_CATALOG,
    UI_DICTIONARY,
    LocalizationManager,
    SubtitleCacheStore,
    SubtitleParser,
    TokenShield,
    TextFormatter,
    RollingContextWindow,
    PolishRegisterHarmonizer,
    ClientTranslator,
    translateSubtitlePayload,
    translateSubtitleToLanguage,
    translateLiveTranscript,
    visibleCharLength
  };
});
