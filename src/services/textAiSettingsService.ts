export type TextAiProvider = "grok" | "openai" | "claude" | "openrouter" | "kimi";

export interface TextAiProviderSettings {
  provider: TextAiProvider;
  apiKey: string;
  model: string;
  updatedAt: number;
}

export interface TextAiSettings {
  selectedProvider: TextAiProvider;
  updatedAt: number;
}

const SETTINGS_KEY = "lw-text-ai-settings";
const PROVIDER_SETTINGS_KEY = "lw-text-ai-provider-settings";
const LEGACY_GROK_KEY = "lw-grok-api-key";

const DEFAULT_MODELS: Record<TextAiProvider, string> = {
  grok: "grok-3-mini-fast",
  openai: "gpt-4o-mini",
  claude: "claude-sonnet-5",
  openrouter: "anthropic/claude-sonnet-5",
  kimi: "kimi-latest",
};

const PROVIDER_LABELS: Record<TextAiProvider, string> = {
  grok: "Grok (xAI)",
  openai: "OpenAI",
  claude: "Claude (Anthropic)",
  openrouter: "OpenRouter",
  kimi: "Kimi (Moonshot)",
};

export function textAiProviderLabel(provider: TextAiProvider): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

// Shown as the API-key field placeholder so the user knows which key to paste.
const KEY_PLACEHOLDERS: Record<TextAiProvider, string> = {
  grok: "xai-...",
  openai: "sk-...",
  claude: "sk-ant-...",
  openrouter: "sk-or-...",
  kimi: "sk-...",
};

export function textAiKeyPlaceholder(provider: TextAiProvider): string {
  return KEY_PLACEHOLDERS[provider] ?? "API key";
}

export function textAiProviderOptions(): TextAiProvider[] {
  return ["grok", "openai", "claude", "openrouter", "kimi"];
}

function readSettings(): Partial<TextAiSettings> {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function readProviderSettings(): Partial<Record<TextAiProvider, Partial<TextAiProviderSettings>>> {
  try {
    const raw = localStorage.getItem(PROVIDER_SETTINGS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function legacyGrokKey(): string {
  try {
    return localStorage.getItem(LEGACY_GROK_KEY) || "";
  } catch {
    return "";
  }
}

export function getTextAiSettings(): TextAiSettings {
  const settings = readSettings();
  return {
    selectedProvider: settings.selectedProvider || "grok",
    updatedAt: settings.updatedAt || 0,
  };
}

export function saveTextAiSettings(updates: Partial<TextAiSettings>): TextAiSettings {
  const next: TextAiSettings = {
    ...getTextAiSettings(),
    ...updates,
    selectedProvider: updates.selectedProvider || getTextAiSettings().selectedProvider,
    updatedAt: Date.now(),
  };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  return next;
}

export function getTextAiProviderSettings(provider: TextAiProvider): TextAiProviderSettings {
  const all = readProviderSettings();
  const current = all[provider] || {};
  return {
    provider,
    apiKey: current.apiKey !== undefined ? String(current.apiKey) : provider === "grok" ? legacyGrokKey() : "",
    model: current.model || DEFAULT_MODELS[provider],
    updatedAt: current.updatedAt || 0,
  };
}

export function saveTextAiProviderSettings(
  provider: TextAiProvider,
  updates: Partial<Omit<TextAiProviderSettings, "provider" | "updatedAt">>,
): TextAiProviderSettings {
  const all = readProviderSettings();
  const next: TextAiProviderSettings = {
    ...getTextAiProviderSettings(provider),
    ...updates,
    provider,
    updatedAt: Date.now(),
  };
  all[provider] = next;
  localStorage.setItem(PROVIDER_SETTINGS_KEY, JSON.stringify(all));
  if (provider === "grok") localStorage.setItem(LEGACY_GROK_KEY, next.apiKey);
  return next;
}

export function getSelectedTextAiProviderSettings(): TextAiProviderSettings {
  return getTextAiProviderSettings(getTextAiSettings().selectedProvider);
}

const ANALYST_SETTINGS_KEY = "lw-text-ai-analyst";

export interface TextAiRoleSelection {
  provider: TextAiProvider;
  model: string;
}

// The "analyst" role handles analytical tasks — report-card scoring, character
// parsing, KB scanning, style analysis — where rubric discipline and clean
// structured output matter more than prose voice. It's an OPTIONAL override on
// the main (writer) selection: unset → analysis uses the same model as writing.
// This lets the writer be a creative fine-tune (e.g. Sao10K) while the scorer
// stays a disciplined analytical model (e.g. grok-4.3).
export function getAnalystOverride(): TextAiRoleSelection | null {
  try {
    const raw = localStorage.getItem(ANALYST_SETTINGS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<TextAiRoleSelection>;
    if (!parsed.provider || !parsed.model) return null;
    return { provider: parsed.provider, model: String(parsed.model) };
  } catch {
    return null;
  }
}

export function saveAnalystOverride(provider: TextAiProvider, model: string): void {
  localStorage.setItem(ANALYST_SETTINGS_KEY, JSON.stringify({ provider, model: model.trim() }));
}

export function clearAnalystOverride(): void {
  localStorage.removeItem(ANALYST_SETTINGS_KEY);
}

export function isAnalystOverrideSet(): boolean {
  return getAnalystOverride() !== null;
}

// Resolved settings for the analyst role: the override if set, otherwise the
// writer (main) selection. The API key always comes from the per-provider store.
export function getAnalystProviderSettings(): TextAiProviderSettings {
  const override = getAnalystOverride();
  if (!override) return getSelectedTextAiProviderSettings();
  return {
    provider: override.provider,
    apiKey: getTextAiProviderSettings(override.provider).apiKey,
    model: override.model,
    updatedAt: 0,
  };
}

// ---------------------------------------------------------------------------
// Live model listing — mirrors imageGenerationService: query each provider's
// /models endpoint, filter to chat/text models, cache the result, and fall
// back to a curated list when there's no key or the call fails.
// ---------------------------------------------------------------------------

export interface TextModelOption {
  id: string;
  label: string;
  description?: string;
}

// Shown before a live refresh, or if the provider's /models call fails, so the
// dropdown is never empty. The live list (when available) takes precedence.
const FALLBACK_MODELS: Record<TextAiProvider, TextModelOption[]> = {
  grok: [
    { id: "grok-4.3", label: "grok-4.3" },
    { id: "grok-4.20-0309-reasoning", label: "grok-4.20 (reasoning)" },
    { id: "grok-4.20-0309-non-reasoning", label: "grok-4.20 (non-reasoning)" },
    { id: "grok-3-mini-fast", label: "grok-3-mini-fast" },
  ],
  openai: [
    { id: "gpt-4o", label: "gpt-4o" },
    { id: "gpt-4o-mini", label: "gpt-4o-mini" },
    { id: "gpt-4.1", label: "gpt-4.1" },
    { id: "o3", label: "o3" },
  ],
  claude: [
    { id: "claude-sonnet-5", label: "claude-sonnet-5" },
    { id: "claude-opus-4-8", label: "claude-opus-4-8" },
    { id: "claude-haiku-4-5-20251001", label: "claude-haiku-4-5" },
    { id: "claude-3-5-sonnet-latest", label: "claude-3-5-sonnet-latest (legacy)" },
  ],
  openrouter: [
    { id: "anthropic/claude-sonnet-5", label: "anthropic/claude-sonnet-5" },
    { id: "anthropic/claude-3.5-sonnet", label: "anthropic/claude-3.5-sonnet" },
    { id: "openai/gpt-4o", label: "openai/gpt-4o" },
    { id: "google/gemini-2.0-flash-001", label: "google/gemini-2.0-flash-001" },
    { id: "moonshotai/kimi-k2", label: "moonshotai/kimi-k2" },
    { id: "deepseek/deepseek-chat", label: "deepseek/deepseek-chat" },
  ],
  kimi: [
    { id: "kimi-latest", label: "kimi-latest" },
    { id: "moonshot-v1-128k", label: "moonshot-v1-128k" },
    { id: "moonshot-v1-32k", label: "moonshot-v1-32k" },
    { id: "moonshot-v1-8k", label: "moonshot-v1-8k" },
  ],
};

const MODEL_CACHE: Record<TextAiProvider, TextModelOption[]> = {
  grok: [],
  openai: [],
  claude: [],
  openrouter: [],
  kimi: [],
};

function dedupeModelOptions(options: TextModelOption[]): TextModelOption[] {
  const seen = new Set<string>();
  const deduped: TextModelOption[] = [];
  for (const option of options) {
    const id = option.id.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    deduped.push({ ...option, id });
  }
  return deduped;
}

function cacheModelOptions(provider: TextAiProvider, options: TextModelOption[]): TextModelOption[] {
  const deduped = dedupeModelOptions(options);
  if (deduped.length) MODEL_CACHE[provider] = deduped;
  return deduped.length ? deduped : getCachedTextModelOptions(provider);
}

// The best list we have without a network call: the last live fetch, else the
// curated fallback.
export function getCachedTextModelOptions(provider: TextAiProvider): TextModelOption[] {
  return MODEL_CACHE[provider].length ? MODEL_CACHE[provider] : FALLBACK_MODELS[provider];
}

// Drop non-text endpoints (image/video/audio/embeddings) that share the same
// /models list so the dropdown only offers chat-capable models.
const NON_TEXT_MODEL = /(image|imagine|video|embed|tts|whisper|audio|speech|moderation|transcribe|dall|realtime)/i;

export async function listGrokTextModels(apiKey: string): Promise<TextModelOption[]> {
  const key = apiKey.trim();
  if (!key) return getCachedTextModelOptions("grok");
  const response = await fetch("https://api.x.ai/v1/models", {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!response.ok) throw new Error(`Grok model list failed: ${response.status} ${response.statusText}`);
  const data = (await response.json()) as { data?: Array<{ id?: string; name?: string }>; models?: Array<{ id?: string; name?: string }> };
  const models = data.data || data.models || [];
  const options = models
    .map((model) => String(model.id || model.name || "").trim())
    .filter((id) => id && !NON_TEXT_MODEL.test(id))
    .map((id) => ({ id, label: id }));
  return cacheModelOptions("grok", options);
}

export async function listOpenAiTextModels(apiKey: string): Promise<TextModelOption[]> {
  const key = apiKey.trim();
  if (!key) return getCachedTextModelOptions("openai");
  const response = await fetch("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!response.ok) throw new Error(`OpenAI model list failed: ${response.status} ${response.statusText}`);
  const data = (await response.json()) as { data?: Array<{ id?: string }> };
  const options = (data.data || [])
    .map((model) => String(model.id || "").trim())
    .filter((id) => id && (/^(gpt|o\d|chatgpt)/i.test(id)) && !NON_TEXT_MODEL.test(id) && !/instruct/i.test(id))
    .map((id) => ({ id, label: id }));
  return cacheModelOptions("openai", options);
}

export async function listClaudeTextModels(apiKey: string): Promise<TextModelOption[]> {
  const key = apiKey.trim();
  if (!key) return getCachedTextModelOptions("claude");
  // OAuth tokens (sk-ant-oat…) use Bearer + the oauth beta header; keys use x-api-key.
  const auth: Record<string, string> = key.startsWith("sk-ant-oat")
    ? { Authorization: `Bearer ${key}`, "anthropic-beta": "oauth-2025-04-20" }
    : { "x-api-key": key };
  const response = await fetch("https://api.anthropic.com/v1/models", {
    headers: { ...auth, "anthropic-version": "2023-06-01" },
  });
  if (!response.ok) throw new Error(`Claude model list failed: ${response.status} ${response.statusText}`);
  const data = (await response.json()) as { data?: Array<{ id?: string; display_name?: string }> };
  const options = (data.data || [])
    .map((model) => ({ id: String(model.id || "").trim(), label: String(model.display_name || model.id || "").trim() }))
    .filter((option) => option.id);
  return cacheModelOptions("claude", options);
}

export async function listOpenRouterTextModels(apiKey: string): Promise<TextModelOption[]> {
  const key = apiKey.trim();
  // OpenRouter's catalogue is public; the key is optional for listing.
  const response = await fetch("https://openrouter.ai/api/v1/models", {
    headers: key ? { Authorization: `Bearer ${key}` } : {},
  });
  if (!response.ok) throw new Error(`OpenRouter model list failed: ${response.status} ${response.statusText}`);
  const data = (await response.json()) as { data?: Array<{ id?: string; name?: string }> };
  const options = (data.data || [])
    .map((model) => ({ id: String(model.id || "").trim(), label: String(model.name || model.id || "").trim() }))
    .filter((option) => option.id && !NON_TEXT_MODEL.test(option.id))
    .sort((a, b) => a.id.localeCompare(b.id));
  return cacheModelOptions("openrouter", options);
}

export async function listKimiTextModels(apiKey: string): Promise<TextModelOption[]> {
  const key = apiKey.trim();
  if (!key) return getCachedTextModelOptions("kimi");
  const response = await fetch("https://api.moonshot.ai/v1/models", {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!response.ok) throw new Error(`Kimi model list failed: ${response.status} ${response.statusText}`);
  const data = (await response.json()) as { data?: Array<{ id?: string }> };
  const options = (data.data || [])
    .map((model) => String(model.id || "").trim())
    .filter((id) => id && !NON_TEXT_MODEL.test(id))
    .map((id) => ({ id, label: id }));
  return cacheModelOptions("kimi", options);
}

export function listTextModelsForProvider(provider: TextAiProvider, apiKey: string): Promise<TextModelOption[]> {
  if (provider === "grok") return listGrokTextModels(apiKey);
  if (provider === "openai") return listOpenAiTextModels(apiKey);
  if (provider === "openrouter") return listOpenRouterTextModels(apiKey);
  if (provider === "kimi") return listKimiTextModels(apiKey);
  return listClaudeTextModels(apiKey);
}
