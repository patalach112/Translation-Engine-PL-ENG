"use strict";

const crypto = require("node:crypto");
const { LANGUAGES, normalizeLanguage } = require("./languages");

const MAX_SEGMENTS = 12;
const MAX_TEXT_LENGTH = 4000;
const MAX_BATCH_TEXT_LENGTH = 24000;
const MAX_CONTEXT_LINES = 7;
const MAX_CONTEXT_LENGTH = 12000;
const MAX_BATCH_CONTEXT_LENGTH = 48000;
const MAX_BATCH_INPUT_LENGTH = 30000;

class TranslationService {
  constructor({ provider, cacheSize = 2000, cacheTtlMs = 6 * 60 * 60 * 1000 } = {}) {
    if (!provider || typeof provider.translateBatch !== "function") throw new TypeError("A batch translation provider is required");
    this.provider = provider;
    this.cacheSize = cacheSize;
    this.cacheTtlMs = cacheTtlMs;
    this.cache = new Map();
  }

  async translate({ text, sourceLanguage, targetLanguage, context = [] }) {
    const [result] = await this.translateBatch({
      sourceLanguage,
      targetLanguage,
      segments: [{ id: "0", text, context }]
    });
    return result.text;
  }

  async translateBatch({ sourceLanguage, targetLanguage, segments }) {
    const source = normalizeLanguage(sourceLanguage);
    const target = normalizeLanguage(targetLanguage);
    if (!source || !target) throw httpError(400, "unsupported_language", "Choose a supported source and target language.");
    if (!Array.isArray(segments) || segments.length < 1 || segments.length > MAX_SEGMENTS) {
      throw httpError(400, "invalid_batch_size", `Send between 1 and ${MAX_SEGMENTS} subtitle segments.`);
    }

    const normalized = segments.map((segment, index) => normalizeSegment(segment, index));
    if (new Set(normalized.map((segment) => segment.id)).size !== normalized.length) {
      throw httpError(400, "duplicate_segment_id", "Segment ids must be unique within a batch.");
    }
    const batchTextLength = normalized.reduce((sum, segment) => sum + segment.text.length, 0);
    const batchContextLength = normalized.reduce((sum, segment) => sum + segment.context.reduce((size, line) => size + line.length, 0), 0);
    if (batchTextLength > MAX_BATCH_TEXT_LENGTH || batchContextLength > MAX_BATCH_CONTEXT_LENGTH || batchTextLength + batchContextLength > MAX_BATCH_INPUT_LENGTH) {
      throw httpError(413, "batch_too_large", "Keep subtitle batches below 24,000 text, 48,000 context, and 30,000 combined characters.");
    }
    const output = new Array(normalized.length);
    const missing = [];
    normalized.forEach((segment, index) => {
      if (source === target) {
        output[index] = { id: segment.id, text: segment.text };
        return;
      }
      const key = this._cacheKey(source, target, segment);
      const cached = this._get(key);
      if (cached !== undefined) output[index] = { id: segment.id, text: cached };
      else missing.push({ ...segment, outputIndex: index, cacheKey: key });
    });

    if (missing.length) {
      const providerResults = await this.provider.translateBatch({
        sourceLanguage: LANGUAGES[source],
        targetLanguage: LANGUAGES[target],
        segments: missing.map(({ id, text, context }) => ({ id, text, context }))
      });
      if (!Array.isArray(providerResults) || providerResults.length !== missing.length) {
        throw httpError(502, "invalid_provider_response", "The configured translation model returned an incomplete result.");
      }
      const resultMap = new Map(providerResults.map((result) => [String(result.id), String(result.text || "").trim()]));
      if (resultMap.size !== missing.length) throw httpError(502, "invalid_provider_response", "The configured translation model returned duplicate segments.");
      for (const segment of missing) {
        const translated = resultMap.get(segment.id);
        if (!translated) throw httpError(502, "invalid_provider_response", "The configured translation model returned an incomplete result.");
        output[segment.outputIndex] = { id: segment.id, text: translated };
        this._set(segment.cacheKey, translated);
      }
    }
    return output;
  }

  _cacheKey(source, target, segment) {
    const value = JSON.stringify([this.provider.name || "translation-model", source, target, segment.text, segment.context]);
    return crypto.createHash("sha256").update(value).digest("hex");
  }

  _get(key) {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) { this.cache.delete(key); return undefined; }
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  _set(key, value) {
    this.cache.delete(key);
    this.cache.set(key, { value, expiresAt: Date.now() + this.cacheTtlMs });
    while (this.cache.size > this.cacheSize) this.cache.delete(this.cache.keys().next().value);
  }

  async health() {
    const status = typeof this.provider.health === "function"
      ? await this.provider.health()
      : { ok: true, detail: "Translation provider configured" };
    return { ok: Boolean(status.ok), provider: this.provider.name || "custom", detail: status.detail || "" };
  }
}

function normalizeSegment(segment, index) {
  if (!segment || typeof segment !== "object") throw httpError(400, "invalid_segment", `Segment ${index} must be an object.`);
  const id = String(segment.id ?? index);
  const text = typeof segment.text === "string" ? segment.text.trim() : "";
  if (!id || id.length > 80 || !text || text.length > MAX_TEXT_LENGTH) {
    throw httpError(400, "invalid_segment", `Segment ${index} needs an id and 1-${MAX_TEXT_LENGTH} characters of text.`);
  }
  const rawContext = Array.isArray(segment.context) ? segment.context : [];
  const context = rawContext.slice(0, MAX_CONTEXT_LINES).map((entry) => {
    if (typeof entry === "string") return entry.slice(0, MAX_CONTEXT_LENGTH);
    if (!entry || typeof entry !== "object") return "";
    const label = String(entry.label || "context").slice(0, 40);
    const value = String(entry.text || "").slice(0, MAX_CONTEXT_LENGTH);
    return value ? `${label}: ${value}` : "";
  }).filter(Boolean);
  const contextLength = context.reduce((sum, line) => sum + line.length, 0);
  if (contextLength > MAX_CONTEXT_LENGTH) throw httpError(400, "context_too_long", "Subtitle context is too large.");
  return { id, text, context };
}

function httpError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

module.exports = { TranslationService, normalizeSegment, httpError, MAX_SEGMENTS, MAX_TEXT_LENGTH };
