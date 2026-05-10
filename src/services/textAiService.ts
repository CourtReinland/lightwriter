import { GrokService, type SuggestionMode } from "./grokService";
import {
  getSelectedTextAiProviderSettings,
  getTextAiProviderSettings,
  textAiProviderLabel,
  type TextAiProvider,
  type TextAiProviderSettings,
} from "./textAiSettingsService";

export type TextCompleteOptions = { temperature?: number; maxTokens?: number; timeoutMs?: number };

const DEFAULT_TIMEOUT_MS = 90_000;

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Text AI request timed out after ${timeoutMs}ms. Check your network/API key or try a smaller batch.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function stripLLMPreamble(text: string): string {
  return text
    .trim()
    .replace(/^```(?:fountain|text)?\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .replace(/^prompt\s*[:=-]\s*/i, "")
    .trim();
}

function modePrompt(mode: SuggestionMode, customPrompt?: string): string {
  const prompts: Record<SuggestionMode, string> = {
    improve_dialogue: "Improve this dialogue. Make it more natural, compelling, and character-specific.",
    expand_scene: "Expand this scene with more detail, action lines, and atmosphere.",
    compress: "Compress this content — make it tighter and more impactful while preserving the key beats.",
    alternative_line: "Write 3 alternative versions of this line/dialogue. Number them 1-3. Each should have a different tone or approach.",
    add_action: "Add vivid action/description lines around this content to enhance the visual storytelling.",
    add_shots: "Add concise camera shot direction lines to this screenplay passage where they clarify visual storytelling. Use MS for Medium Shot, WS for Wide Shot, and CU for Close Up. Format each added shot line as Fountain forced-shot text: !!SHOT CHARACTER NAME ACTION IN CONTEXT. Preserve the original story beats and dialogue.",
    fix_formatting: "Fix the Fountain formatting of this content. Ensure proper scene headings, character names, dialogue, parentheticals, and transitions.",
    general: "Help improve or develop this screenplay content.",
    custom: customPrompt || "Help improve or develop this screenplay content.",
  };
  return prompts[mode];
}

export class TextAiService {
  private settings: TextAiProviderSettings;

  constructor(settings?: TextAiProviderSettings) {
    this.settings = settings || getSelectedTextAiProviderSettings();
  }

  static forProvider(provider: TextAiProvider): TextAiService {
    return new TextAiService(getTextAiProviderSettings(provider));
  }

  async complete(systemPrompt: string, userMessage: string, options?: TextCompleteOptions): Promise<string> {
    const apiKey = this.settings.apiKey.trim();
    if (!apiKey) throw new Error(`Add a ${textAiProviderLabel(this.settings.provider)} API key before using AI text features.`);
    if (this.settings.provider === "grok") return new GrokService(apiKey).complete(systemPrompt, userMessage, options);
    if (this.settings.provider === "openai") return this.completeOpenAi(systemPrompt, userMessage, options);
    return this.completeClaude(systemPrompt, userMessage, options);
  }

  async suggest(selectedText: string, surroundingContext: string, mode: SuggestionMode, customPrompt?: string): Promise<string> {
    const systemPrompt = `You are a professional screenwriting assistant. Return ONLY valid Fountain screenplay text.\n\nTask: ${modePrompt(mode, customPrompt)}`;
    const userMessage = surroundingContext
      ? `Context:\n---\n${surroundingContext}\n---\n\nRewrite this:\n---\n${selectedText}\n---`
      : `Rewrite this:\n---\n${selectedText}\n---`;
    return this.complete(systemPrompt, userMessage, { temperature: 0.8, maxTokens: 2048 });
  }

  private async completeOpenAi(systemPrompt: string, userMessage: string, options?: TextCompleteOptions): Promise<string> {
    const response = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.settings.apiKey}`,
      },
      body: JSON.stringify({
        model: this.settings.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        temperature: options?.temperature ?? 0.8,
        max_tokens: options?.maxTokens ?? 2048,
      }),
    }, options?.timeoutMs);
    if (!response.ok) throw new Error(`OpenAI API error: ${response.status} — ${await response.text()}`);
    const data = await response.json();
    return stripLLMPreamble(data.choices?.[0]?.message?.content ?? "");
  }

  private async completeClaude(systemPrompt: string, userMessage: string, options?: TextCompleteOptions): Promise<string> {
    const response = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.settings.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.settings.model,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
        temperature: options?.temperature ?? 0.8,
        max_tokens: options?.maxTokens ?? 2048,
      }),
    }, options?.timeoutMs);
    if (!response.ok) throw new Error(`Claude API error: ${response.status} — ${await response.text()}`);
    const data = await response.json();
    return stripLLMPreamble((data.content || []).map((part: { text?: string }) => part.text || "").join("\n"));
  }
}
