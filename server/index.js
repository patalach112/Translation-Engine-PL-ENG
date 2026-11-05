"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { TranslationService, httpError, MAX_SEGMENTS } = require("./translation-service");
const { OllamaProvider } = require("./providers/ollama");
const { OpenAICompatibleProvider } = require("./providers/openai-compatible");

const WEB_ROOT = path.resolve(__dirname, "../web");
const MAX_BODY_BYTES = 1024 * 1024;
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".vtt": "text/vtt; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".mp4": "video/mp4", ".webm": "video/webm"
};

function createProvider(env = process.env) {
  const mode = String(env.TRANSLATION_BACKEND || "ollama").toLowerCase();
  const timeoutMs = positiveInt(env.TRANSLATION_TIMEOUT_MS, 90000);
  if (mode === "ollama") {
    return new OllamaProvider({
      baseUrl: env.OLLAMA_URL || "http://127.0.0.1:11434",
      model: env.TRANSLATION_MODEL || "qwen2.5:7b",
      timeoutMs
    });
  }
  if (mode === "openai" || mode === "openai-compatible") {
    return new OpenAICompatibleProvider({
      baseUrl: env.TRANSLATION_BASE_URL || "https://api.openai.com/v1",
      apiKey: env.TRANSLATION_API_KEY || "",
      model: env.TRANSLATION_MODEL || "gpt-4o-mini",
      timeoutMs
    });
  }
  throw new Error(`Unknown TRANSLATION_BACKEND: ${mode}`);
}

function createServer({
  service = new TranslationService({ provider: createProvider() }),
  webRoot = WEB_ROOT,
  requestsPerMinute = positiveInt(process.env.REQUESTS_PER_MINUTE, 120),
  maxConcurrent = positiveInt(process.env.MAX_CONCURRENT_TRANSLATIONS, 2),
  maxPending = positiveInt(process.env.MAX_QUEUED_TRANSLATIONS, 16),
  trustProxy = process.env.TRUST_PROXY === "true"
} = {}) {
  const absoluteWebRoot = path.resolve(webRoot);
  const requestCounts = new Map();
  const semaphore = new Semaphore(maxConcurrent, maxPending);

  const server = http.createServer(async (request, response) => {
    setBaseHeaders(response);
    const url = new URL(request.url, "http://localhost");

    if (url.pathname.startsWith("/api/")) {
      if (!allowRequest(request, response, getClientIp(request, trustProxy), requestCounts, requestsPerMinute)) return;
      try {
        if (request.method === "GET" && url.pathname === "/api/health") {
          let status;
          try { status = await service.health(); }
          catch (error) { status = { ok: false, provider: service.provider.name, detail: safeMessage(error) }; }
          return sendJson(response, status.ok ? 200 : 503, { status: status.ok ? "ok" : "not_ready", ...status });
        }
        if (request.method !== "POST" || !["/api/translate", "/api/translate/batch"].includes(url.pathname)) {
          throw httpError(404, "not_found", "API route not found.");
        }
        const payload = await readJson(request);
        const result = await semaphore.run(() => url.pathname === "/api/translate"
          ? service.translate({
            text: payload.text,
            sourceLanguage: payload.sourceLanguage || payload.sourceLang,
            targetLanguage: payload.targetLanguage || payload.targetLang,
            context: payload.context
          })
          : service.translateBatch(payload));
        return sendJson(response, 200, url.pathname === "/api/translate"
          ? { translation: result, provider: service.provider.name || "translation-model" }
          : { translations: result, count: result.length, provider: service.provider.name || "translation-model" });
      } catch (error) {
        const status = error.status || (error.name === "AbortError" ? 504 : 502);
        return sendJson(response, status, { error: { code: error.code || "translation_failed", message: safeMessage(error) } });
      }
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      response.setHeader("Allow", "GET, HEAD");
      return sendJson(response, 405, { error: { code: "method_not_allowed", message: "Use GET or HEAD for static files." } });
    }
    return serveStatic(request, response, url.pathname, absoluteWebRoot);
  });
  return server;
}

class Semaphore {
  constructor(maxActive, maxPending) {
    this.maxActive = maxActive;
    this.maxPending = maxPending;
    this.active = 0;
    this.pending = [];
  }

  run(task) {
    if (this.active >= this.maxActive && this.pending.length >= this.maxPending) {
      return Promise.reject(httpError(503, "translation_queue_full", "Translation capacity is busy; retry shortly."));
    }
    return new Promise((resolve, reject) => {
      const start = () => {
        this.active += 1;
        Promise.resolve().then(task).then(resolve, reject).finally(() => {
          this.active -= 1;
          const next = this.pending.shift();
          if (next) next();
        });
      };
      if (this.active < this.maxActive) start();
      else this.pending.push(start);
    });
  }
}

function allowRequest(request, response, ip, counters, limit) {
  const now = Date.now();
  let record = counters.get(ip);
  if (!record || record.resetAt <= now) record = { count: 0, resetAt: now + 60_000 };
  record.count += 1;
  counters.set(ip, record);
  if (counters.size > 10_000) {
    for (const [key, item] of counters) if (item.resetAt <= now) counters.delete(key);
  }
  if (record.count <= limit) return true;
  response.setHeader("Retry-After", String(Math.max(1, Math.ceil((record.resetAt - now) / 1000))));
  sendJson(response, 429, { error: { code: "rate_limited", message: "Too many requests from this address. Retry shortly." } });
  return false;
}

function getClientIp(request, trustProxy) {
  if (trustProxy) {
    const forwarded = request.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.trim()) return forwarded.split(",")[0].trim().slice(0, 80);
  }
  return request.socket.remoteAddress || "unknown";
}

async function readJson(request) {
  const contentType = String(request.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") throw httpError(415, "unsupported_media_type", "Send application/json.");
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) throw httpError(413, "request_too_large", "Translation request exceeds the 1 MB limit.");
    chunks.push(chunk);
  }
  let payload;
  try { payload = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch (_error) { throw httpError(400, "invalid_json", "Request body must be valid JSON."); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw httpError(400, "invalid_request", "Request body must be a JSON object.");
  }
  return payload;
}

function serveStatic(request, response, pathname, root) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); }
  catch (_error) { return sendJson(response, 400, { error: { code: "invalid_path", message: "Invalid URL path." } }); }
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const filename = path.resolve(root, relative);
  if (filename !== root && !filename.startsWith(`${root}${path.sep}`)) {
    return sendJson(response, 403, { error: { code: "forbidden", message: "Path is outside the web root." } });
  }
  let stat;
  try { stat = fs.statSync(filename); }
  catch (_error) { return sendJson(response, 404, { error: { code: "not_found", message: "File not found." } }); }
  if (!stat.isFile()) return sendJson(response, 404, { error: { code: "not_found", message: "File not found." } });
  response.statusCode = 200;
  response.setHeader("Content-Type", MIME_TYPES[path.extname(filename).toLowerCase()] || "application/octet-stream");
  response.setHeader("Content-Length", stat.size);
  response.setHeader("Cache-Control", /\.(?:html|js|css)$/.test(filename) ? "no-cache" : "public, max-age=3600");
  if (request.method === "HEAD") return response.end();
  const stream = fs.createReadStream(filename);
  stream.on("error", () => { if (!response.headersSent) sendJson(response, 500, { error: { code: "file_read_error", message: "Unable to read file." } }); else response.destroy(); });
  stream.pipe(response);
}

function setBaseHeaders(response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("Cache-Control", "no-store");
}

function sendJson(response, status, value) {
  if (response.writableEnded) return;
  const body = JSON.stringify(value);
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Length", Buffer.byteLength(body));
  response.end(body);
}

function safeMessage(error) {
  if (error && error.status) return error.message;
  if (error && error.name === "TimeoutError") return "Translation model timed out. Try again or choose a smaller model.";
  if (error && error.name === "AbortError") return "Translation request was cancelled.";
  if (error && (error.cause || error.code)) return "Translation model is unavailable. Check the backend model service.";
  return error && error.message ? error.message.slice(0, 300) : "Translation failed.";
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

if (require.main === module) {
  let provider;
  try {
    provider = createProvider();
    const server = createServer({ service: new TranslationService({ provider }) });
    const port = positiveInt(process.env.PORT, 8081);
    const host = process.env.HOST || "0.0.0.0";
    server.listen(port, host, () => {
      console.log(`StreamPL engine listening on http://${host}:${port}`);
      console.log(`Translation backend: ${provider.name}`);
      if (provider.name.startsWith("ollama:")) console.log(`Ollama endpoint: ${provider.baseUrl}; start Ollama and pull ${provider.model} before translating.`);
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { createServer, createProvider, Semaphore, readJson, MAX_BODY_BYTES, MAX_SEGMENTS };
