#!/usr/bin/env node
"use strict";

/**
 * Zero-dependency, headless subtitle build for Node.js 18+.
 * It shares the browser's parser, TokenShield, formatter, register handling, and
 * WebVTT serializer so CI output follows the same 42-CPL rules as the viewer.
 * Public Google GTX translation is best-effort; --offline is available for
 * deterministic builds without network access.
 */
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
require("../web/live-caption-engine.js"); // Provides the shared glossary matcher in Node builds.
const {
  SubtitleParser,
  TokenShield,
  TextFormatter,
  ClientTranslator,
  RollingContextWindow,
  maskTranslationInput,
  normalizeGlossaryEntries,
  PolishRegisterHarmonizer,
  SUPPORTED_LANGUAGES
} = require("../web/app.js");

const ROOT = path.resolve(__dirname, "..");
const LANGUAGES = SUPPORTED_LANGUAGES.map(language => language.code);
const SUBTITLE_EXTENSIONS = new Set([".srt", ".vtt", ".ass", ".ssa"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".webm"]);
const BUILD_VERSION = "6";

function parseArgs(argv) {
  const options = { input: "assets/raw", output: "web/data/tracks", catalog: "web/data/catalog.json", offline: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--offline") options.offline = true;
    else if (["--input", "--output", "--catalog"].includes(arg)) {
      if (!argv[i + 1]) throw new Error(`Missing value for ${arg}`);
      options[arg.slice(2)] = argv[++i];
    } else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

async function walk(dir) {
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); }
  catch (err) { if (err.code === "ENOENT") return []; throw err; }
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

function slugify(value) {
  return String(value).normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "video";
}

async function readSidecar(file) {
  if (!file) return {};
  const stem = file.replace(/\.[^.]+$/, "");
  for (const candidate of [...new Set([`${file}.json`, `${stem}.json`, `${stem}.meta.json`])]) {
    try {
      const value = JSON.parse(await fs.readFile(candidate, "utf8"));
      if (value && typeof value === "object" && !Array.isArray(value)) return value;
    } catch (error) {
      if (error.code !== "ENOENT") throw new Error(`Invalid metadata sidecar ${candidate}: ${error.message}`);
    }
  }
  return {};
}

function relativeWebPath(file, webRoot) {
  return path.relative(webRoot, file).split(path.sep).join("/") || ".";
}

function normalizeLang(lang) {
  const value = String(lang || "").trim().toLowerCase();
  if (value.startsWith("zh")) return "zh-CN";
  const match = SUPPORTED_LANGUAGES.find(language =>
    language.code.toLowerCase() === value || value.startsWith(`${language.code.toLowerCase()}-`)
  );
  return match ? match.code : "en";
}

function detectSourceLang(doc) {
  const text = (doc.cues || []).map(cue => cue.text).join(" ");
  if (/[\u3040-\u30ff]/.test(text)) return "ja";
  if (/[\uac00-\ud7af]/.test(text)) return "ko";
  if (/[\u0e00-\u0e7f]/.test(text)) return "th";
  if (/[\u0980-\u09ff]/.test(text)) return "bn";
  if (/[\u0b80-\u0bff]/.test(text)) return "ta";
  if (/[\u0a00-\u0a7f]/.test(text)) return "pa";
  if (/[\u0900-\u097f]/.test(text)) return "hi";
  if (/[\u0600-\u06ff]/.test(text)) return "ar";
  if (/[\u4e00-\u9fff]/.test(text)) return "zh-CN";
  if (/[\u0400-\u04ff]/.test(text)) return /[іїєґ]/i.test(text) ? "uk" : "ru";
  const known = SubtitleParser.detectLanguage(doc);
  if (known === "pl") return known;

  // Lightweight stop-word scoring for Latin-script sources. Supply an explicit
  // sourceLanguage in a sidecar for short/ambiguous captions.
  const words = text.toLowerCase().match(/[a-zà-ž]+/g) || [];
  const indicators = {
    es: new Set(["el", "la", "los", "las", "que", "por", "para", "una", "como", "está", "gracias"]),
    de: new Set(["der", "die", "das", "und", "ist", "nicht", "mit", "für", "ich", "wir"]),
    fr: new Set(["le", "la", "les", "des", "et", "est", "une", "pour", "avec", "vous"]),
    pt: new Set(["o", "os", "as", "que", "não", "uma", "para", "com", "você", "está"]),
    it: new Set(["il", "lo", "gli", "che", "non", "una", "per", "con", "sono"]),
    nl: new Set(["het", "een", "de", "en", "niet", "voor", "met", "zijn", "jullie"]),
    tr: new Set(["bir", "ve", "için", "değil", "bu", "ile", "nasıl", "teşekkür"]),
    id: new Set(["yang", "dan", "untuk", "dengan", "tidak", "ini", "kami", "terima"]),
    vi: new Set(["và", "của", "không", "một", "được", "cho", "với", "xin"])
  };
  const scores = Object.fromEntries(Object.entries(indicators).map(([code, terms]) => [
    code, words.reduce((score, word) => score + Number(terms.has(word)), 0)
  ]));
  if (/[ßäöü]/i.test(text)) scores.de += 2;
  if (/[¿¡ñ]/i.test(text)) scores.es += 2;
  if (/[àâçéèêëîïôùûüÿœ]/i.test(text)) scores.fr += 1;
  if (/[ãõ]/i.test(text)) scores.pt += 2;
  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  return ranked[0][1] >= 2 ? ranked[0][0] : known;
}

function titlePair(value, fallback) {
  if (value && typeof value === "object") return { en: value.en || fallback, pl: value.pl || value.en || fallback };
  const title = String(value || fallback);
  return { en: title, pl: title };
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function relativeStem(file, root) {
  return path.relative(root, file).replace(/\\/g, "/").replace(/\.[^.]+$/, "").toLowerCase();
}

async function translateGoogle(text, source, target) {
  const url = new URL("https://translate.googleapis.com/translate_a/single");
  url.search = new URLSearchParams({ client: "gtx", sl: source, tl: target, dt: "t", q: text });
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
      if (!response.ok) throw new Error(`Google GTX HTTP ${response.status}`);
      const data = await response.json();
      const result = Array.isArray(data?.[0]) ? data[0].map(row => row?.[0] || "").join("") : "";
      if (!result) throw new Error("Empty Google GTX translation response");
      return result;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 350 * (attempt + 1)));
    }
  }
  throw lastError || new Error("Translation endpoint unavailable");
}

async function translateMyMemory(text, source, target) {
  const url = new URL("https://api.mymemory.translated.net/get");
  url.search = new URLSearchParams({ q: text, langpair: `${source}|${target}` });
  const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`MyMemory HTTP ${response.status}`);
  const data = await response.json();
  const translated = data?.responseData?.translatedText;
  if (!translated || Number(data.responseStatus) >= 400) throw new Error("MyMemory quota or translation error");
  return translated;
}

async function translateCue(text, source, target, offlineTranslator, offline, failedPairs, glossaryEntries = []) {
  const { turns } = TokenShield.splitDialogueTurns(text);
  const translatedTurns = [];
  for (const turn of turns) {
    const masked = maskTranslationInput(turn, glossaryEntries, target);
    let translated;
    if (source === target) translated = masked.cleanText;
    else if (offline) translated = offlineTranslator.translateOffline(masked.cleanText, source, target, "auto");
    else if (failedPairs.has(`${source}->${target}`)) translated = masked.cleanText;
    else {
      try {
        try { translated = await translateGoogle(masked.cleanText, source, target); }
        catch (googleError) {
          try { translated = await translateMyMemory(masked.cleanText, source, target); }
          catch (memoryError) {
            throw new Error(`Google GTX: ${googleError.message}; MyMemory: ${memoryError.message}`);
          }
        }
      } catch (error) {
        failedPairs.add(`${source}->${target}`);
        console.warn(`  ${source}->${target} endpoint circuit opened: ${error.message}; remaining cues use safe source fallback`);
        // Preserve the protected source text rather than losing a cue on endpoint failure.
        translated = masked.cleanText;
      }
    }
    translatedTurns.push(masked.restore(translated));
  }
  return translatedTurns.join("\n");
}

async function createTrack(doc, sourceLang, targetLang, offlineTranslator, offline, failedPairs, glossaryEntries = []) {
  const cues = [];
  const context = new RollingContextWindow(5, "auto");
  for (const cue of doc.cues) {
    const contextEval = context.evaluate(cue.text);
    let translated = await translateCue(cue.text, sourceLang, targetLang, offlineTranslator, offline, failedPairs, glossaryEntries);
    if (targetLang === "pl") translated = PolishRegisterHarmonizer.harmonize(translated, contextEval.activeRegister);
    const formatted = TextFormatter.formatCueText(translated, { maxCpl: 42, lang: targetLang });
    cues.push({ ...cue, text: formatted });
    context.push(cue.index, cue.text, translated, contextEval.activeRegister);
  }
  return SubtitleParser.serializeWebVTT({ cues, headerBlocks: doc.headerBlocks || [], sourceFormat: "vtt" });
}

async function loadCatalog(filename) {
  try {
    const parsed = JSON.parse(await fs.readFile(filename, "utf8"));
    return { schemaVersion: 1, items: [], ...parsed, items: Array.isArray(parsed.items) ? parsed.items : [] };
  } catch (error) {
    if (error.code !== "ENOENT") throw new Error(`Invalid catalog ${filename}: ${error.message}`);
    return { schemaVersion: 1, generatedAt: null, items: [] };
  }
}

async function run(options) {
  const inputDir = path.resolve(ROOT, options.input);
  const outputDir = path.resolve(ROOT, options.output);
  const catalogPath = path.resolve(ROOT, options.catalog);
  const webRoot = path.join(ROOT, "web");
  const sourceCopyDir = path.join(webRoot, "data/sources");
  const files = await walk(inputDir);
  const subtitleFiles = files.filter(file => SUBTITLE_EXTENSIONS.has(path.extname(file).toLowerCase()));
  const videoFiles = files.filter(file => VIDEO_EXTENSIONS.has(path.extname(file).toLowerCase()));
  if (!subtitleFiles.length && !videoFiles.length) {
    console.log(`No video or subtitle inputs found under ${path.relative(ROOT, inputDir)}; catalog unchanged.`);
    return { processed: 0, videos: 0 };
  }

  await fs.mkdir(outputDir, { recursive: true });
  const catalog = await loadCatalog(catalogPath);
  const byId = new Map(catalog.items.map(item => [item.id, item]));
  const videosByStem = new Map(videoFiles.map(file => [relativeStem(file, inputDir), file]));
  const subtitleStems = new Set();
  const offlineTranslator = new ClientTranslator({ provider: "offline" });
  const failedPairs = new Set();
  let catalogChanged = false;

  for (const subtitleFile of subtitleFiles) {
    const raw = await fs.readFile(subtitleFile, "utf8");
    const doc = SubtitleParser.parse(raw, subtitleFile);
    if (!doc.cues.length) {
      console.warn(`Skipping subtitle with no parseable cues: ${path.relative(ROOT, subtitleFile)}`);
      continue;
    }
    const relativeName = path.relative(inputDir, subtitleFile).split(path.sep).join("/");
    const stem = relativeName.replace(/\.[^.]+$/, "");
    subtitleStems.add(stem.toLowerCase());
    const metadata = await readSidecar(subtitleFile);
    const id = slugify(metadata.id || stem);
    const sourceLang = metadata.sourceLanguage
      ? normalizeLang(metadata.sourceLanguage)
      : detectSourceLang(doc);
    const sourceCopyPath = path.join(sourceCopyDir, `${id}${path.extname(subtitleFile).toLowerCase()}`);
    await fs.mkdir(sourceCopyDir, { recursive: true });
    await fs.copyFile(subtitleFile, sourceCopyPath);
    const video = videosByStem.get(stem.toLowerCase());
    const existing = byId.get(id) || {};
    const videoMetadata = video ? await readSidecar(video) : {};
    const metadataMerged = { ...videoMetadata, ...metadata };
    const glossaryEntries = normalizeGlossaryEntries(metadataMerged.glossary || []);
    const glossaryHash = crypto.createHash("sha256").update(stableStringify(glossaryEntries)).digest("hex");
    const expectedTracks = Object.fromEntries(LANGUAGES.map(target => [
      target,
      relativeWebPath(path.join(outputDir, `${id}_${target}.vtt`), webRoot)
    ]));
    const sourceHash = crypto.createHash("sha256").update(raw).digest("hex");
    const translationMode = options.offline ? "offline" : "public-auto";
    const reusable = existing.sourceHash === sourceHash &&
      existing.sourceLanguage === sourceLang &&
      existing.glossaryHash === glossaryHash &&
      existing.trackBuildVersion === BUILD_VERSION &&
      existing.translationMode === translationMode &&
      LANGUAGES.every(target => existing.tracks?.[target] === expectedTracks[target]);
    let tracksExist = reusable;
    if (tracksExist) {
      for (const target of LANGUAGES) {
        try { await fs.access(path.resolve(webRoot, expectedTracks[target])); }
        catch (_error) { tracksExist = false; break; }
      }
    }

    if (!tracksExist) {
      for (const target of LANGUAGES) {
        const targetFile = path.join(outputDir, `${id}_${target}.vtt`);
        const vtt = await createTrack(doc, sourceLang, target, offlineTranslator, options.offline, failedPairs, glossaryEntries);
        await fs.writeFile(targetFile, vtt, "utf8");
      }
    }

    const fallbackTitle = path.basename(stem);
    const candidate = {
      ...existing,
      ...metadataMerged,
      id,
      title: titlePair(metadataMerged.title || existing.title, fallbackTitle),
      description: metadataMerged.description || existing.description || { en: "", pl: "" },
      aspect: metadataMerged.aspect || existing.aspect || "16:9",
      duration: metadataMerged.duration || existing.duration || "",
      video: video ? relativeWebPath(video, webRoot) : (existing.video || ""),
      sourceSubtitle: relativeWebPath(sourceCopyPath, webRoot),
      sourceLanguage: sourceLang,
      sourceHash,
      glossary: glossaryEntries,
      glossaryHash,
      trackBuildVersion: BUILD_VERSION,
      translationMode,
      tracks: expectedTracks
    };
    const changed = stableStringify({ ...existing, updatedAt: null }) !== stableStringify({ ...candidate, updatedAt: null });
    const item = { ...candidate, updatedAt: changed ? new Date().toISOString() : (existing.updatedAt || null) };
    if (changed) catalogChanged = true;
    byId.set(id, item);
    console.log(`${tracksExist ? "Reused" : "Generated"} ${LANGUAGES.map(lang => `${id}_${lang}.vtt`).join(", ")} (${doc.cues.length} cues, ${sourceLang} source)`);
  }

  // Video-only commits become visible in the catalog immediately; subtitle tracks
  // are filled on a later push when their matching .srt/.vtt/.ass/.ssa arrives.
  for (const video of videoFiles) {
    const stem = relativeStem(video, inputDir);
    if (subtitleStems.has(stem)) continue;
    const metadata = await readSidecar(video);
    const id = slugify(metadata.id || stem);
    const existing = byId.get(id) || {};
    const candidate = {
      ...existing,
      ...metadata,
      id,
      title: titlePair(metadata.title || existing.title, path.basename(stem)),
      description: metadata.description || existing.description || { en: "", pl: "" },
      aspect: metadata.aspect || existing.aspect || "16:9",
      duration: metadata.duration || existing.duration || "",
      video: relativeWebPath(video, webRoot),
      sourceSubtitle: existing.sourceSubtitle || "",
      sourceLanguage: existing.sourceLanguage || "",
      tracks: existing.tracks || {}
    };
    const changed = stableStringify({ ...existing, updatedAt: null }) !== stableStringify({ ...candidate, updatedAt: null });
    if (changed) catalogChanged = true;
    byId.set(id, { ...candidate, updatedAt: changed ? new Date().toISOString() : (existing.updatedAt || null) });
  }

  catalog.schemaVersion = 1;
  if (catalogChanged || !catalog.generatedAt) catalog.generatedAt = new Date().toISOString();
  catalog.items = Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id));
  await fs.mkdir(path.dirname(catalogPath), { recursive: true });
  await fs.writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
  console.log(`Updated ${path.relative(ROOT, catalogPath)} with ${catalog.items.length} media item(s).`);
  return { processed: subtitleFiles.length, videos: videoFiles.length };
}

if (require.main === module) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log("Usage: node scripts/headless-translator.js [--input assets/raw] [--output web/data/tracks] [--catalog web/data/catalog.json] [--offline]");
      process.exitCode = 0;
    } else {
      run(options).catch(error => { console.error(error.stack || error); process.exitCode = 1; });
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}

module.exports = { parseArgs, run, slugify, normalizeLang, detectSourceLang, translateGoogle, translateCue };
