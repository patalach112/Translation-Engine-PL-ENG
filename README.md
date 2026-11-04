# StreamPL — Client-Side EN ⇄ PL Video Hub & Subtitle Studio

A **client-side Vanilla JavaScript (ES6+), HTML5, and CSS** video hub and subtitle localization engine. The viewer needs no backend or build step; optional GitHub Actions workflows perform headless track generation and publish the static site. No npm install is required. The optional Local Whisper mode loads a pinned browser inference runtime and quantized model on demand; it does not add a server or build dependency.

## Quick Start

- Open [`web/index.html`](./web/index.html) directly in a modern browser to try the bundled viewer/demo. Browser `file://` security restrictions prevent fetching the JSON catalog, so direct-open mode uses the built-in demo fallback.
- For the complete dynamic playlist and CMS catalog, publish this repository with GitHub Pages or serve the repository root over HTTP. The root [`index.html`](./index.html) forwards to `web/` using relative paths (including under a project-site URL such as `https://user.github.io/repository/`). Live audio capture requires HTTPS or `localhost`; opening a `file://` page is only for the bundled demo.
- Use the prominent **Polski (CC)** / **English (CC)** buttons or native video CC menu. For anime, use **Live audio captions**, choose Japanese → Polski, and select **Local Whisper** or **Browser speech service**. Local Whisper runs in the browser using WebGPU when available and WASM otherwise; the runtime and selected quantized model download on first use and are cached by the browser. Audio is processed locally for ASR; only recognized text is sent to the configured translation provider. Chrome/Edge is recommended. Share this tab with audio enabled, or choose microphone mode and play through speakers. The overlay appears on this app's player, not on another site's DRM-protected player. If a Japanese subtitle file exists, **Best sync: translate an anime subtitle file** imports SRT/VTT/ASS/SSA and produces time-synced translated cues without ASR. The glossary accepts one `source = preferred text` pair per line and is saved locally.

### Live speech-to-caption architecture

The zero-dependency `web/live-caption-engine.js` module separates `AudioCaptureAdapter`, `BrowserSpeechRecognitionProvider`, `LocalWhisperSpeechProvider`, `LiveCaptionEngine`, `SerialTranslationQueue`, `GlossaryLexicon`, `TranscriptOverlapFilter`, and `CaptionOverlayRenderer`. The local provider captures PCM through `web/live-audio-worklet.js`, resamples to 16 kHz, transcribes overlapping windows, and removes repeated boundary text. Its replaceable runtime adapter uses Transformers.js from a pinned CDN release with ONNX Whisper model weights downloaded on demand; no model binaries are committed and no backend is added. The pretrained Whisper model is not trained by this repository. Browser speech recognition remains an alternative/fallback. The page and code are ours; the underlying pretrained model/runtime have their own upstream licenses and must be reachable for first-time setup. Translation still uses the configured client-side provider and may need internet access.

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
  app.js                           # Subtitle/localization engine and viewer UI
  live-caption-engine.js           # Audio capture, ASR adapters, glossary, ordered translation queue
  live-audio-worklet.js            # PCM frames for local Whisper inference
  styles.css                       # Responsive dark/light UI
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
