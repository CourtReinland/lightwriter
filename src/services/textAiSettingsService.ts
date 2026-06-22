export type TextAiProvider = "grok" | "openai" | "claude";

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
  claude: "claude-3-5-sonnet-latest",
};

export function textAiProviderLabel(provider: TextAiProvider): string {
  if (provider === "grok") return "Grok";
  if (provider === "openai") return "OpenAI";
  return "Claude";
}

export function textAiProviderOptions(): TextAiProvider[] {
  return ["grok", "openai", "claude"];
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
    { id: "claude-3-5-sonnet-latest", label: "claude-3-5-sonnet-latest" },
    { id: "claude-3-5-haiku-latest", label: "claude-3-5-haiku-latest" },
    { id: "claude-3-opus-latest", label: "claude-3-opus-latest" },
  ],
};

const MODEL_CACHE: Record<TextAiProvider, TextModelOption[]> = {
  grok: [],
  openai: [],
  claude: [],
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
  const response = await fetch("https://api.anthropic.com/v1/models", {
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
  });
  if (!response.ok) throw new Error(`Claude model list failed: ${response.status} ${response.statusText}`);
  const data = (await response.json()) as { data?: Array<{ id?: string; display_name?: string }> };
  const options = (data.data || [])
    .map((model) => ({ id: String(model.id || "").trim(), label: String(model.display_name || model.id || "").trim() }))
    .filter((option) => option.id);
  return cacheModelOptions("claude", options);
}

export function listTextModelsForProvider(provider: TextAiProvider, apiKey: string): Promise<TextModelOption[]> {
  if (provider === "grok") return listGrokTextModels(apiKey);
  if (provider === "openai") return listOpenAiTextModels(apiKey);
  return listClaudeTextModels(apiKey);
}
