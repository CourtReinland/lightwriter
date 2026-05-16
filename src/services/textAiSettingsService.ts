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
