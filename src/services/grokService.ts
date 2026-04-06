export type SuggestionMode =
  | "improve_dialogue"
  | "expand_scene"
  | "compress"
  | "alternative_line"
  | "add_action"
  | "fix_formatting"
  | "general"
  | "custom";

const MODE_PROMPTS: Record<SuggestionMode, string> = {
  improve_dialogue:
    "Improve this dialogue. Make it more natural, compelling, and character-specific.",
  expand_scene:
    "Expand this scene with more detail, action lines, and atmosphere.",
  compress:
    "Compress this content — make it tighter and more impactful while preserving the key beats.",
  alternative_line:
    "Write 3 alternative versions of this line/dialogue. Number them 1-3. Each should have a different tone or approach.",
  add_action:
    "Add vivid action/description lines around this content to enhance the visual storytelling.",
  fix_formatting:
    "Fix the Fountain formatting of this content. Ensure proper scene headings, character names, dialogue, parentheticals, and transitions.",
  general:
    "Help improve or develop this screenplay content.",
  custom: "", // Placeholder — custom prompt is passed directly
};

const SYSTEM_PROMPT = `You are a professional screenwriting assistant. You write in proper Fountain screenplay format.

CRITICAL RULE: Return ONLY the screenplay text itself. No explanations, no commentary, no preamble, no "Here is the improved version:", no "I've made the following changes:", no notes after the text. Your entire response must be valid Fountain screenplay content that can be directly inserted into a script. Do not wrap the text in code blocks or markdown formatting.`;

export class GrokService {
  private apiKey: string;
  private model = "grok-3-mini-fast";
  private baseUrl = "https://api.x.ai/v1";

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async suggest(
    selectedText: string,
    surroundingContext: string,
    mode: SuggestionMode,
    customPrompt?: string,
  ): Promise<string> {
    const task = mode === "custom" && customPrompt
      ? customPrompt
      : MODE_PROMPTS[mode];
    const systemPrompt = `${SYSTEM_PROMPT}\n\nTask: ${task}`;

    const userMessage = surroundingContext
      ? `Context:\n---\n${surroundingContext}\n---\n\nRewrite this:\n---\n${selectedText}\n---`
      : `Rewrite this:\n---\n${selectedText}\n---`;

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        temperature: 0.8,
        max_tokens: 2048,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Grok API error: ${response.status} — ${err}`);
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content ?? "";
    return stripLLMPreamble(raw);
  }

  /**
   * Lower-level completion method for the AI orchestrator.
   * Accepts pre-built system/user prompts.
   */
  async complete(
    systemPrompt: string,
    userMessage: string,
    options?: { temperature?: number; maxTokens?: number },
  ): Promise<string> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        temperature: options?.temperature ?? 0.8,
        max_tokens: options?.maxTokens ?? 2048,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Grok API error: ${response.status} — ${err}`);
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content ?? "";
    return stripLLMPreamble(raw);
  }

  static getStoredApiKey(): string | null {
    return localStorage.getItem("lw-grok-api-key");
  }

  static setStoredApiKey(key: string): void {
    localStorage.setItem("lw-grok-api-key", key);
  }

  static clearStoredApiKey(): void {
    localStorage.removeItem("lw-grok-api-key");
  }
}

/**
 * Strip common LLM preamble/postamble patterns from the response,
 * leaving only the actual screenplay text.
 */
function stripLLMPreamble(text: string): string {
  let cleaned = text.trim();

  // Remove markdown code fences: ```fountain ... ``` or ``` ... ```
  cleaned = cleaned.replace(/^```(?:fountain|text)?\s*\n?/i, "");
  cleaned = cleaned.replace(/\n?```\s*$/i, "");

  // Remove common preamble lines (case-insensitive, greedy up to first screenplay content)
  const preamblePatterns = [
    /^here(?:'s| is) (?:the |my |an? )?(?:improved|revised|expanded|compressed|rewritten|corrected|updated|alternative|suggested)[\s\S]*?:\s*\n+/i,
    /^(?:sure|okay|of course|absolutely|certainly)[!,.]?\s*(?:here(?:'s| is)[\s\S]*?:\s*)?\n+/i,
    /^I(?:'ve| have) (?:improved|revised|expanded|compressed|rewritten|corrected|updated|made)[\s\S]*?:\s*\n+/i,
    /^(?:the |below is |following is )(?:improved|revised|expanded|compressed|rewritten)[\s\S]*?:\s*\n+/i,
  ];

  for (const pattern of preamblePatterns) {
    cleaned = cleaned.replace(pattern, "");
  }

  // Remove common postamble/explanation after the screenplay text.
  const postamblePatterns = [
    /\n---\n[\s\S]*$/,
    /\n```\s*\n[\s\S]*$/,
    /\n(?:Note|Notes|Changes made|Key changes|I (?:changed|made|improved|adjusted))[\s\S]*$/i,
    /\n(?:This (?:expansion|revision|version|rewrite|improvement|edit|compression))[\s\S]*$/i,
    /\n(?:Here's what|What I (?:did|changed)|The (?:changes|key|main))[\s\S]*$/i,
    /\n-\s*\*\*[A-Z][\s\S]*$/,
    /\n\*\*(?:Changes|Notes|Key improvements)[\s\S]*$/i,
    /\n#{1,3} (?:Changes|Notes|Explanation)[\s\S]*$/i,
    /\nIf you(?:'d| would) like[\s\S]*$/i,
    /\nLet me know[\s\S]*$/i,
    /\nFeel free[\s\S]*$/i,
  ];

  for (const pattern of postamblePatterns) {
    cleaned = cleaned.replace(pattern, "");
  }

  return cleaned.trim();
}
