import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getTextAiProviderSettings,
  getTextAiSettings,
  saveTextAiProviderSettings,
  saveTextAiSettings,
} from "../src/services/textAiSettingsService";

function makeLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => store.set(key, value)),
    removeItem: vi.fn((key: string) => store.delete(key)),
    clear: vi.fn(() => store.clear()),
  };
}

describe("text AI provider settings", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", makeLocalStorage());
    vi.spyOn(Date, "now").mockReturnValue(123456);
  });

  it("stores one global writing/parser provider choice with separate keys per provider", () => {
    saveTextAiProviderSettings("grok", { apiKey: "xai-key" });
    saveTextAiProviderSettings("openai", { apiKey: "openai-key" });
    saveTextAiProviderSettings("claude", { apiKey: "claude-key" });
    saveTextAiSettings({ selectedProvider: "claude" });

    expect(getTextAiSettings().selectedProvider).toBe("claude");
    expect(getTextAiProviderSettings("grok").apiKey).toBe("xai-key");
    expect(getTextAiProviderSettings("openai").apiKey).toBe("openai-key");
    expect(getTextAiProviderSettings("claude").apiKey).toBe("claude-key");
  });

  it("migrates an existing Grok key into the global writing/parser settings", () => {
    localStorage.setItem("lw-grok-api-key", "legacy-xai-key");

    expect(getTextAiSettings().selectedProvider).toBe("grok");
    expect(getTextAiProviderSettings("grok").apiKey).toBe("legacy-xai-key");
  });
});
