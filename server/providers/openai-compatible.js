"use strict";

const { buildSystemPrompt, parseTranslations } = require("./ollama");

class OpenAICompatibleProvider {
  constructor({ baseUrl = "https://api.openai.com/v1", apiKey = "", model = "gpt-4o-mini", timeoutMs = 90000 } = {}) {
    this.baseUrl = String(baseUrl).replace(/\/+$/, "");
    this.apiKey = apiKey;
    this.model = model;
    this.timeoutMs = timeoutMs;
    this.name = `openai-compatible:${model}`;
  }

  async translateBatch({ sourceLanguage, targetLanguage, segments }) {
    const headers = { "Content-Type": "application/json" };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(this.timeoutMs),
      body: JSON.stringify({
        model: this.model,
        temperature: 0.15,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: buildSystemPrompt(sourceLanguage, targetLanguage) },
          { role: "user", content: JSON.stringify({ sourceLanguage, targetLanguage, segments }) }
        ]
      })
    });
    if (!response.ok) throw new Error(`Translation model request failed (HTTP ${response.status})`);
    const result = await response.json();
    const content = result && result.choices && result.choices[0] && result.choices[0].message && result.choices[0].message.content;
    if (typeof content !== "string" || !content.trim()) throw new Error("Translation model returned an empty response");
    return parseTranslations(content, segments);
  }

  async health() {
    return { ok: Boolean(this.apiKey), detail: this.apiKey ? `Model ${this.model} configured` : "Set TRANSLATION_API_KEY" };
  }
}

module.exports = { OpenAICompatibleProvider };
