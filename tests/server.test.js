"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { TranslationService } = require("../server/translation-service.js");
const { createServer, createProvider } = require("../server/index.js");
const { OllamaProvider, parseTranslations, buildSystemPrompt } = require("../server/providers/ollama.js");

function fakeProvider() {
  const calls = [];
  return {
    name: "fake-local-model",
    calls,
    async translateBatch(input) {
      calls.push(input);
      return input.segments.map((segment) => ({ id: segment.id, text: `${input.targetLanguage}: ${segment.text}` }));
    },
    async health() { return { ok: true, detail: "fake model ready" }; }
  };
}

test("local model batch parser rejects missing ids and protects translation-only output", () => {
  const segments = [{ id: "1", text: "Good morning" }, { id: "2", text: "⟦T0⟧" }];
  const parsed = parseTranslations('{"translations":[{"id":"2","text":"⟦T0⟧"},{"id":"1","text":"Guten Morgen"}]}', segments);
  assert.deepEqual(parsed, [{ id: "1", text: "Guten Morgen" }, { id: "2", text: "⟦T0⟧" }]);
  assert.throws(() => parseTranslations('{"translations":[{"id":"1","text":"Guten Morgen"}]}', segments), /every segment/);
  assert.match(buildSystemPrompt("Japanese", "Polish"), /idioms, slang, jokes, sarcasm/i);
  assert.match(buildSystemPrompt("Japanese", "Polish"), /untrusted quoted dialogue/i);
});

test("translation service batches cues, caches results, and includes context in cache identity", async () => {
  const provider = fakeProvider();
  const service = new TranslationService({ provider, cacheSize: 10 });
  const input = {
    sourceLanguage: "en", targetLanguage: "de",
    segments: [{ id: "a", text: "It is over", context: ["meeting context"] }, { id: "b", text: "Thanks" }]
  };
  const first = await service.translateBatch(input);
  assert.equal(provider.calls.length, 1);
  assert.deepEqual(first, [
    { id: "a", text: "German: It is over" }, { id: "b", text: "German: Thanks" }
  ]);
  await service.translateBatch(input);
  assert.equal(provider.calls.length, 1, "identical batch should be served from memory cache");
  await service.translateBatch({ ...input, segments: [{ ...input.segments[0], context: ["relationship context"] }] });
  assert.equal(provider.calls.length, 2, "different context must not reuse a potentially wrong cached sentence");
});

test("translation service validates languages, segment sizes, and duplicate batch ids", async () => {
  const service = new TranslationService({ provider: fakeProvider() });
  await assert.rejects(service.translate({ text: "hi", sourceLanguage: "xx", targetLanguage: "pl" }), { status: 400 });
  await assert.rejects(service.translateBatch({ sourceLanguage: "en", targetLanguage: "pl", segments: [
    { id: "x", text: "First" }, { id: "x", text: "Second" }
  ] }), { code: "duplicate_segment_id" });
  await assert.rejects(service.translate({ text: "x".repeat(4001), sourceLanguage: "en", targetLanguage: "pl" }), { status: 400 });
  await assert.rejects(service.translateBatch({
    sourceLanguage: "en", targetLanguage: "pl",
    segments: Array.from({ length: 7 }, (_, index) => ({ id: String(index), text: "x".repeat(4000) }))
  }), { status: 413 });
});

test("backend HTTP server exposes health, static assets, single and batched translation APIs", async (t) => {
  const provider = fakeProvider();
  const service = new TranslationService({ provider });
  const server = createServer({
    service,
    webRoot: path.join(__dirname, "../web"),
    requestsPerMinute: 100,
    maxConcurrent: 2,
    maxPending: 4
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const health = await fetch(`${base}/api/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).status, "ok");
  const page = await fetch(base);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /streampl-player/);

  const single = await fetch(`${base}/api/translate`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "Good evening", sourceLanguage: "en", targetLanguage: "pl" })
  });
  assert.equal(single.status, 200);
  assert.equal((await single.json()).translation, "Polish: Good evening");

  const batch = await fetch(`${base}/api/translate/batch`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceLanguage: "en", targetLanguage: "pl", segments: [
      { id: "1", text: "Good night" }, { id: "2", text: "See you" }
    ] })
  });
  assert.equal(batch.status, 200);
  assert.equal((await batch.json()).count, 2);

  const badInput = await fetch(`${base}/api/translate`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "Hi", sourceLanguage: "unknown", targetLanguage: "pl" })
  });
  assert.equal(badInput.status, 400);
  assert.equal((await badInput.json()).error.code, "unsupported_language");
});

test("provider factory uses self-hosted Ollama by default and requires no cloud credentials", () => {
  const provider = createProvider({});
  assert.ok(provider instanceof OllamaProvider);
  assert.equal(provider.model, "qwen2.5:7b");
  const compatible = createProvider({
    TRANSLATION_BACKEND: "openai-compatible",
    TRANSLATION_BASE_URL: "http://127.0.0.1:9000/v1",
    TRANSLATION_MODEL: "local-model"
  });
  assert.equal(compatible.model, "local-model");
});
