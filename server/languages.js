"use strict";

const LANGUAGES = Object.freeze({
  en: "English", pl: "Polish", es: "Spanish", ja: "Japanese", "zh-CN": "Chinese (Simplified)",
  de: "German", fr: "French", ar: "Arabic", hi: "Hindi", pt: "Portuguese", ru: "Russian",
  bn: "Bengali", id: "Indonesian", ur: "Urdu", tr: "Turkish", it: "Italian", ko: "Korean",
  vi: "Vietnamese", fa: "Persian", sw: "Swahili", nl: "Dutch", th: "Thai", ms: "Malay",
  uk: "Ukrainian", ta: "Tamil", mr: "Marathi", pa: "Punjabi", tl: "Filipino"
});

function normalizeLanguage(value) {
  const language = String(value || "").trim();
  if (Object.hasOwn(LANGUAGES, language)) return language;
  const base = language.split("-")[0].toLowerCase();
  if (base === "zh") return "zh-CN";
  const match = Object.keys(LANGUAGES).find((code) => code.toLowerCase() === base);
  return match || "";
}

module.exports = { LANGUAGES, normalizeLanguage };
