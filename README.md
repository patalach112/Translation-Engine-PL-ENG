# StreamPL — Browser Video Localization Engine

A **client-side, framework-free JavaScript engine** for subtitle localization and live video captions, with an embeddable native-player component and an optional demo/creator studio. Integrate the engine into an existing video site or publish the included static demo; neither use requires a backend or build step. Optional GitHub Actions workflows generate headless subtitle tracks. No npm install is required. Local Whisper downloads a pinned browser inference runtime and quantized model on demand, without adding a server or build dependency.

## Quick Start

- Open [`web/index.html`](./web/index.html) directly in a modern browser to try the bundled viewer/demo. Browser `file://` security restrictions prevent fetching the JSON catalog, so direct-open mode uses the built-in demo fallback.
- For the complete dynamic playlist and CMS catalog, publish this repository with GitHub Pages or serve the repository root over HTTP. The root [`index.html`](./index.html) forwards to `web/` using relative paths (including under a project-site URL such as `https://user.github.io/repository/`). Live audio capture requires HTTPS or `localhost`; opening a `file://` page is only for the bundled demo.
- Use the prominent **Polski (CC)** / **English (CC)** buttons or native video CC menu. For anime, use **Live audio captions**, choose Japanese → Polski, and select **Local Whisper** or **Browser speech service**. Local Whisper runs in the browser using WebGPU when available and WASM otherwise; the runtime and selected quantized model download on first use and are cached by the browser. Audio is processed locally for ASR; only recognized text is sent to the configured translation provider. Chrome/Edge is recommended. Share this tab with audio enabled, or choose microphone mode and play through speakers. The overlay appears on this app's player, not on another site's DRM-protected player. If a Japanese subtitle file exists, **Best sync: translate an anime subtitle file** imports SRT/VTT/ASS/SSA and produces time-synced translated cues without ASR. The glossary accepts one `source = preferred text` pair per line and is saved locally.

### Live speech-to-caption architecture

Live captions are composed from small browser-side modules rather than one all-in-one engine: `audio-signal-processor.js` handles PCM preparation, `local-whisper-provider.js` owns local model inference and speech-aware chunking, and `live-caption-engine.js` orchestrates capture, providers, cancellation, serial translation, and rendering. See the [architecture notes](docs/architecture.md) for their contracts and lifecycle. AudioWorklet frames are batched to limit message/GC overhead; quiet windows are skipped, phrases flush at pauses, and audio is converted to 16 kHz and gently leveled. Whisper Base is the balanced default; Tiny is lighter, while Small is a higher-resource choice. Two-beam decoding favors recognition quality over minimum latency; WebGPU is attempted first, with WASM fallback. For best results, share the tab's audio; microphone capture intentionally disables echo/noise suppression so it does not mistake playback for echo. Built-in product-name protection (including **YouTube Shorts**) is shared across browser, live, and Node headless translations. Live translation carries recent lines and register when using an OpenAI-compatible translator. The pinned Transformers.js runtime and pretrained ONNX Whisper weights download on demand; no model binaries or backend are added. These are pretrained models, not trained by this repository. Actual browser downloads/device performance depend on the user's browser, hardware, and network. Translation uses the configured client-side provider and may need internet access.

## Embed the localization engine in your own site

The project includes a dependency-free `<streampl-player>` web component for sites that already host their own video. It is an integration surface, not a hosted player service: keep your existing site and media hosting, then add the two scripts and the component where your video belongs. It uses the browser's native video controls (play/pause, seek, volume, fullscreen, and picture-in-picture where supported), adds a subtitle language picker, and can translate a hosted SRT/VTT source track on demand into any of the 28 configured locales while preserving cue timing.

```html
<script defer src="https://YOUR-HOST/translation-engine/web/app.js"></script>
<script defer src="https://YOUR-HOST/translation-engine/web/streampl-player.js"></script>

<streampl-player
  src="/media/episode-01.mp4"
  poster="/media/episode-01.jpg"
  title="Episode 1"
  source-language="ja"
  source-subtitles="/captions/episode-01.ja.vtt"
  target-languages="en,pl,de,fr,es,zh-CN"
></streampl-player>
```

`source-subtitles` must be a readable SRT or WebVTT file. Same-origin files work directly; cross-origin caption and track hosts must allow CORS. If `target-languages` is omitted, the picker offers every supported locale except the source language. Existing tracks can be supplied declaratively as JSON in a `tracks` attribute, or configured with JavaScript:

```js
const player = document.querySelector("streampl-player");
player.configure({
  tracks: [
    { language: "ja", label: "日本語", src: "/captions/episode-01.ja.vtt" },
    { language: "en", label: "English", src: "/captions/episode-01.en.vtt" }
  ],
  targetLanguages: ["pl", "de", "fr"],
  videoOptions: { controls: true, playsInline: true, preload: "metadata", playbackRate: 1 },
  engineOptions: { provider: "google_gtx" }
});
player.addEventListener("streampl-translated", (event) => console.log(event.detail));
player.addEventListener("streampl-error", (event) => console.error(event.detail));
```

The element exposes its underlying media node as `player.videoElement` and emits `streampl-languagechange`, `streampl-translated`, and `streampl-error` events. It can be styled through the `streampl-player` host or its `::part(video)` and `::part(toolbar)` hooks. The standalone embed needs no bundler, npm package, backend, or framework. It relies on `app.js` as the shared translation core; loading it on another site does not initialize the demo UI unless that page contains the demo's `#video-player` element.

Translation quality and available idiom/context handling depend on the selected provider. OpenAI-compatible providers receive explicit localization guidance to preserve intent, voice, humor, register, and idiomatic meaning across language pairs; standard translation APIs are used as configured and do not receive that same prompt. Browser-only API keys are visible to visitors, so do not embed private provider credentials in public pages—use a restricted key or a secure provider endpoint if credentials are required. The engine cannot promise perfect interpretation for every phrase; review important legal, medical, or commercial subtitles.

## Autonomous Content Pipeline

### Add media and captions

Commit supported media under `assets/raw/`:

- Video: `.mp4` or `.webm`
- Subtitles: `.srt`, `.vtt`, `.ass`, or `.ssa`

Matching video and subtitle files should share a relative filename stem, for example `assets/raw/episode-01.mp4` and `assets/raw/episode-01.ass`. A video-only commit appears in the catalog as awaiting subtitles; adding its matching subtitle later generates the language tracks. The `.github/workflows/auto-translate-pipeline.yml` workflow runs automatically on pushes affecting `assets/raw/**`, and can also be started with **Actions → Autonomous subtitle localization → Run workflow**.

The workflow uses Node.js 22 and the zero-dependency headless companion:

```sh
node scripts/headless-translator.js --input assets/raw --output web/data/tracks --catalog web/data/catalog.json
```

The script scans the raw media directory and generates a track for each of 28 configured world-language locales: English, Polish, Spanish, Japanese, Simplified Chinese, German, French, Arabic, Hindi, Portuguese, Russian, Bengali, Indonesian, Urdu, Turkish, Italian, Korean, Vietnamese, Persian, Swahili, Dutch, Thai, Malay, Ukrainian, Tamil, Marathi, Punjabi, and Filipino. It updates the JSON catalog, then the workflow commits generated tracks and catalog changes back to the triggering branch. Public Google GTX translation is best-effort with bounded retries; if an endpoint fails, a cue is retained safely rather than dropping timing or formatting. `--offline` makes a deterministic no-network build using the EN/PL dictionary plus bundled demo phrase memory for German, Japanese, Simplified Chinese, Spanish, and French; other unsupported text/locales remain source text in offline mode. For broad real-world coverage, the normal workflow tries Google GTX and then MyMemory for each locale. Catalog items built with `--offline` can also translate selected tracks on demand in the browser using those endpoints, with successful results cached locally. The source subtitle is copied into `web/data/sources/` so this works from static hosting.

Optional metadata can be placed next to the corresponding video or subtitle as `episode-01.json` (or `episode-01.mp4.json`). Fields such as `id`, `title` (string or `{ "en", "pl" }`), `description`, `aspect`, `duration`, and `sourceLanguage` are merged into the catalog. The builder detects common writing systems and languages automatically; set `sourceLanguage` (for example `de`, `zh-CN`, or `ja`) for short or ambiguous Latin-script captions. Subtitle and video paths remain relative to the `web/` directory, making them usable by GitHub Pages and other static hosts.

### Catalog-driven public playlist

`web/data/catalog.json` is the static CMS/headless integration contract. Each media record exposes localized title/description fields, relative video and source-subtitle paths, aspect/duration metadata, source language, and a `tracks` map keyed by language code. The public playlist is built dynamically from this JSON in `web/app.js`; adding or updating a catalog entry does not require editing the HTML. The viewer fetches the catalog's available tracks, injects native HTML5 `<track>` elements, and exposes additional locales in the **More languages** picker alongside the prominent Polish/English controls.

### GitHub Pages

The included `.github/workflows/pages-deploy.yml` publishes the repository as a static Pages artifact on pushes to `main` or manual dispatch. Enable **Settings → Pages → Build and deployment → GitHub Actions** once in repository settings. No server runtime is used for the deployed site.

## Subtitle Format and Effects Support

The shared `SubtitleParser` accepts SRT, WebVTT, ASS, and SSA event records while preserving exact cue timestamps. ASS/SSA `\\an1`–`\\an9` alignment and `\\pos(x,y)` overrides become WebVTT `line`, `position`, and `align` cue settings. Common `\\i`, `\\b`, and `\\u` toggles become WebVTT-compatible inline italic, bold, and underline tags; `\\N` line breaks and `\\h` non-breaking spaces are retained. A compatible WebVTT `STYLE` block is emitted for imported ASS/SSA tracks.

The translation/formatting engine also provides:

- `TokenShield` protection for inline formatting, URLs, and placeholders.
- Exact immutable timing objects and valid `WEBVTT\n\n` output.
- Hard 42-character-per-line wrapping and Polish single-letter preposition binding with U+00A0.
- Polish tone/register modes (`Pani`, `Pan`, informal plural `wy`) and five-cue context.
- Browser-language auto-localization, persistent caption preference, local subtitle cache, and graceful provider-failure toasts.

## Repository Layout

```text
index.html                         # Relative redirect for root-based static hosting
.github/workflows/
  auto-translate-pipeline.yml      # Raw media → tracks + CMS catalog → commit
  pages-deploy.yml                 # GitHub Pages static deployment
assets/raw/                        # Incoming video/subtitle content
scripts/headless-translator.js     # Zero-dependency headless Node translation/build
web/
  index.html                       # Public Video Hub and hidden Creator Studio
  app.js                           # Viewer/UI composition and subtitle localization flows
  audio-signal-processor.js        # Pure PCM resampling, conditioning, and audio helpers
  local-whisper-provider.js        # Whisper runtime/cache, worklet capture, VAD, and ASR windows
  live-caption-engine.js          # Capture adapters, provider lifecycle, queue, glossary, renderer
  streampl-player.js              # Framework-free embeddable player/custom element SDK
  live-audio-worklet.js           # Batched mono PCM transfer from AudioWorklet thread
  styles.css                       # Responsive dark/light UI
docs/
  architecture.md                  # Module boundaries, lifecycle, contracts, and privacy
  data/catalog.json                # CMS-ready dynamic media manifest
  data/tracks/                     # Generated multilingual WebVTT assets
assets/subtitles/                  # Reference input/output examples
tests/app.test.js                  # Zero-dependency Node test suite
```

## Validation

```sh
node --test tests/app.test.js
node scripts/headless-translator.js --help
node scripts/headless-translator.js --offline
```
