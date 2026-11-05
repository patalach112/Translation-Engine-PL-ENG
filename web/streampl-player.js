/* StreamPL embeddable HTML5 player + subtitle localization component.
 * Load after app.js to enable automatic translation through SubtitleEngine.
 * Zero dependencies; the element uses native HTMLMediaElement controls.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.StreamPLPlayer = api;
  if (typeof window !== "undefined" && window.customElements && window.HTMLElement) {
    api.define(window.customElements, window.HTMLElement);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DEFAULT_LANGUAGES = ["en", "pl", "es", "ja", "zh-CN", "de", "fr", "ar", "hi", "pt", "ru", "bn", "id", "ur", "tr", "it", "ko", "vi", "fa", "sw", "nl", "th", "ms", "uk", "ta", "mr", "pa", "tl"];
  const LANGUAGE_NAMES = {
    en: "English", pl: "Polski", es: "Español", ja: "日本語", "zh-CN": "简体中文", de: "Deutsch", fr: "Français",
    ar: "العربية", hi: "हिन्दी", pt: "Português", ru: "Русский", bn: "বাংলা", id: "Bahasa Indonesia", ur: "اردو",
    tr: "Türkçe", it: "Italiano", ko: "한국어", vi: "Tiếng Việt", fa: "فارسی", sw: "Kiswahili", nl: "Nederlands",
    th: "ไทย", ms: "Bahasa Melayu", uk: "Українська", ta: "தமிழ்", mr: "मराठी", pa: "ਪੰਜਾਬੀ", tl: "Filipino"
  };
  const ELEMENT_NAME = "streampl-player";

  function normalizeLanguages(input, supported = DEFAULT_LANGUAGES) {
    if (input == null || input === "") return supported.slice();
    const values = Array.isArray(input) ? input : String(input).split(/[\s,]+/);
    const allowed = new Set(supported);
    return [...new Set(values.map((value) => String(value).trim()).filter((value) => allowed.has(value)))];
  }

  function normalizeTracks(input) {
    let tracks = input;
    if (typeof tracks === "string") {
      try { tracks = JSON.parse(tracks); } catch (_) { tracks = []; }
    }
    if (!Array.isArray(tracks)) return [];
    return tracks.filter((track) => track && typeof track.src === "string" && track.src.trim() && typeof track.language === "string")
      .map((track) => ({ language: track.language.trim(), label: String(track.label || LANGUAGE_NAMES[track.language] || track.language), src: track.src.trim() }));
  }

  function define(customElements, HTMLElementBase) {
    if (customElements.get(ELEMENT_NAME)) return customElements.get(ELEMENT_NAME);

    class StreamPLPlayer extends HTMLElementBase {
      static get observedAttributes() { return ["src", "poster", "source-language", "source-subtitles", "target-languages", "tracks", "title", "controls", "autoplay", "muted", "loop", "preload"]; }

      constructor() {
        super();
        this._config = {};
        this._urls = new Set();
        this._busy = false;
        this._shadow = this.attachShadow({ mode: "open" });
        this._render();
      }

      connectedCallback() { this._syncAttributes(); }
      disconnectedCallback() { this._revokeUrls(); }
      attributeChangedCallback() { if (this.isConnected) this._syncAttributes(); }

      configure(options = {}) {
        this._config = { ...this._config, ...options };
        this._syncAttributes();
        return this;
      }

      get videoElement() { return this._shadow.querySelector("video"); }

      _syncAttributes() {
        const cfg = this._config;
        const src = cfg.src || this.getAttribute("src") || "";
        const poster = cfg.poster || this.getAttribute("poster") || "";
        const title = cfg.title || this.getAttribute("title") || "Video player";
        const sourceLanguage = cfg.sourceLanguage || this.getAttribute("source-language") || "";
        const sourceSubtitles = cfg.sourceSubtitles || this.getAttribute("source-subtitles") || "";
        const targets = normalizeLanguages(cfg.targetLanguages || this.getAttribute("target-languages"));
        const tracks = normalizeTracks(cfg.tracks || this.getAttribute("tracks"));
        const options = cfg.videoOptions || {};
        const video = this.videoElement;
        if (src && video.getAttribute("src") !== src) { video.src = src; video.load(); }
        if (poster) video.poster = poster;
        video.controls = options.controls !== undefined ? Boolean(options.controls) : true;
        video.autoplay = options.autoplay !== undefined ? Boolean(options.autoplay) : this.hasAttribute("autoplay");
        video.muted = options.muted !== undefined ? Boolean(options.muted) : this.hasAttribute("muted");
        video.loop = options.loop !== undefined ? Boolean(options.loop) : this.hasAttribute("loop");
        video.playsInline = options.playsInline !== undefined ? Boolean(options.playsInline) : true;
        video.preload = options.preload || this.getAttribute("preload") || "metadata";
        if (Number.isFinite(Number(options.playbackRate)) && Number(options.playbackRate) > 0) video.playbackRate = Number(options.playbackRate);
        video.setAttribute("aria-label", title);
        this._source = { language: sourceLanguage, src: sourceSubtitles };
        this._targets = targets.filter((language) => language !== sourceLanguage);
        this._tracks = tracks;
        this._syncTrackElements();
        this._renderLanguageMenu();
      }

      _render() {
        this._shadow.innerHTML = `
          <style>
            :host{display:block;max-width:100%;color:#f8fafc;font:500 14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;--sp-accent:#60a5fa;--sp-surface:#101827;--sp-border:#334155}
            .frame{overflow:hidden;border:1px solid var(--sp-border);border-radius:14px;background:#05080e;box-shadow:0 18px 52px #02061755}
            video{display:block;width:100%;max-height:80vh;background:#000;aspect-ratio:16/9;object-fit:contain}
            .toolbar{display:flex;align-items:center;gap:12px;min-height:54px;padding:8px 12px;background:var(--sp-surface);border-top:1px solid var(--sp-border)}
            label{display:flex;align-items:center;gap:8px;color:#cbd5e1}.label{white-space:nowrap}
            select,button{min-height:36px;border:1px solid var(--sp-border);border-radius:8px;background:#0b1220;color:#f8fafc;font:inherit;padding:6px 10px}
            select{max-width:min(48vw,240px)}button{cursor:pointer}button:hover:not(:disabled),select:focus-visible{border-color:var(--sp-accent);outline:2px solid #60a5fa55;outline-offset:1px}
            button.primary{background:#1d4ed8;border-color:#3b82f6}button:disabled{opacity:.55;cursor:wait}
            .status{margin-left:auto;color:#94a3b8;font-size:12px;min-width:0}.status[role=alert]{color:#fca5a5}
            @media(max-width:560px){.toolbar{flex-wrap:wrap;gap:8px}.status{order:3;flex-basis:100%;margin-left:0}label{flex:1}.label{display:none}select{max-width:100%;width:100%}}
          </style>
          <div class="frame">
            <video controls playsinline preload="metadata" part="video"></video>
            <div class="toolbar" part="toolbar">
              <label><span class="label">Subtitles</span><select aria-label="Subtitle language"><option value="off">Off</option></select></label>
              <button class="primary translate" type="button" hidden>Translate captions</button>
              <span class="status" role="status" aria-live="polite"></span>
            </div>
          </div>`;
        this._shadow.querySelector("select").addEventListener("change", (event) => this._selectTrack(event.target.value));
        this._shadow.querySelector(".translate").addEventListener("click", () => this._translate());
      }

      _syncTrackElements() {
        const video = this.videoElement;
        video.querySelectorAll("track[data-streampl-index]").forEach((track) => track.remove());
        this._tracks.forEach((item, index) => {
          const track = document.createElement("track");
          track.kind = "subtitles";
          track.srclang = item.language;
          track.label = item.label;
          track.dataset.streamplIndex = String(index);
          track.src = item.src;
          video.append(track);
        });
      }

      _renderLanguageMenu() {
        const select = this._shadow.querySelector("select");
        if (!select) return;
        const current = select.value;
        select.replaceChildren(new Option("Off", "off"));
        this._tracks.forEach((track, index) => select.add(new Option(track.label, `track:${index}`)));
        this._targets.forEach((lang) => select.add(new Option(LANGUAGE_NAMES[lang] || lang, `translate:${lang}`)));
        const source = this._source;
        const translateButton = this._shadow.querySelector(".translate");
        translateButton.hidden = !(source.language && source.src && this._targets.length);
        if ([...select.options].some((option) => option.value === current)) select.value = current;
        this._setStatus("");
      }

      _selectTrack(value) {
        const video = this.videoElement;
        for (const track of Array.from(video.querySelectorAll("track"))) track.track.mode = "disabled";
        if (value.startsWith("track:")) {
          const track = this.videoElement.querySelector(`track[data-streampl-index="${Number(value.slice(6))}"]`);
          if (track) track.track.mode = "showing";
        } else if (value.startsWith("translate:")) {
          const lang = value.slice(10);
          const generated = this._shadow.querySelector(`track[data-streampl-generated="${lang}"]`);
          if (generated) generated.track.mode = "showing";
          else this._translate(lang);
        }
        this.dispatchEvent(new CustomEvent("streampl-languagechange", { bubbles: true, detail: { value } }));
      }

      async _translate(targetLanguage) {
        const selected = targetLanguage || this._shadow.querySelector("select").value.slice(10);
        if (!this._targets.includes(selected)) return;
        if (this._busy) return;
        if (this._tracks.some((track) => track.language === selected)) {
          const existing = this._tracks.findIndex((track) => track.language === selected);
          this._shadow.querySelector("select").value = `track:${existing}`;
          this._selectTrack(`track:${existing}`);
          return;
        }
        const engine = this._config.engine || (typeof window !== "undefined" && window.SubtitleEngine);
        if (!engine || typeof engine.translateSubtitleToLanguage !== "function") {
          this._setStatus("Load app.js before streampl-player.js to enable translation.", true);
          this.dispatchEvent(new CustomEvent("streampl-error", { bubbles: true, detail: { code: "engine-unavailable" } }));
          return;
        }
        this._busy = true;
        const button = this._shadow.querySelector(".translate");
        button.disabled = true;
        this._setStatus(`Preparing ${LANGUAGE_NAMES[selected] || selected} captions…`);
        try {
          const response = await fetch(this._source.src, { mode: "cors", credentials: "omit" });
          if (!response.ok) throw new Error(`Subtitle request failed (${response.status})`);
          const source = await response.text();
          const result = await engine.translateSubtitleToLanguage(source, selected, {
            filename: this._source.src.split("/").pop().split(/[?#]/)[0] || "subtitles.vtt",
            sourceLang: this._source.language,
            settings: this._config.engineOptions || {},
            onProgress: (percent) => this._setStatus(`Translating captions… ${percent}%`)
          });
          this._attachGeneratedTrack(selected, result.vtt);
          const selector = this._shadow.querySelector("select");
          selector.value = `translate:${selected}`;
          this._selectTrack(`translate:${selected}`);
          this._setStatus(`${LANGUAGE_NAMES[selected] || selected} captions ready`);
          this.dispatchEvent(new CustomEvent("streampl-translated", { bubbles: true, detail: { language: selected, cueCount: result.cueCount, provider: result.providerUsed } }));
        } catch (error) {
          this._setStatus(error && error.message ? error.message : "Caption translation failed", true);
          this.dispatchEvent(new CustomEvent("streampl-error", { bubbles: true, detail: { code: "translation-failed", error } }));
        } finally {
          this._busy = false;
          button.disabled = false;
        }
      }

      _attachGeneratedTrack(language, vtt) {
        const old = this._shadow.querySelector(`track[data-streampl-generated="${language}"]`);
        if (old) old.remove();
        const track = document.createElement("track");
        track.kind = "subtitles";
        track.srclang = language;
        track.label = LANGUAGE_NAMES[language] || language;
        track.dataset.streamplGenerated = language;
        track.default = false;
        const url = URL.createObjectURL(new Blob([vtt], { type: "text/vtt;charset=utf-8" }));
        this._urls.add(url);
        track.src = url;
        this.videoElement.append(track);
        track.track.mode = "showing";
      }

      _setStatus(message, isError = false) {
        const status = this._shadow.querySelector(".status");
        if (status) { status.textContent = message; status.toggleAttribute("role", isError); status.setAttribute("role", isError ? "alert" : "status"); }
      }

      _revokeUrls() { for (const url of this._urls) URL.revokeObjectURL(url); this._urls.clear(); }
    }

    customElements.define(ELEMENT_NAME, StreamPLPlayer);
    return StreamPLPlayer;
  }

  return { ELEMENT_NAME, DEFAULT_LANGUAGES, LANGUAGE_NAMES, normalizeLanguages, normalizeTracks, define };
});
