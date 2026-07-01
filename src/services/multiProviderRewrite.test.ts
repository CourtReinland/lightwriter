import { describe, it, expect, beforeEach } from "vitest";
import { runMultiProviderRewrite } from "./multiProviderRewriteService";
import { saveTextAiProviderSettings } from "./textAiSettingsService";

function installLocalStorage() {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
}

const rewriteFor = (tag: string) =>
  JSON.stringify({ rewrittenScript: `INT. ROOM - DAY\n\nALEX opens the ${tag} door.`, changeSummary: [`${tag} changes`] });

describe("runMultiProviderRewrite", () => {
  beforeEach(() => installLocalStorage());

  it("fans out only across keyed providers, scores, and ranks best-first", async () => {
    saveTextAiProviderSettings("claude", { apiKey: "k" });
    saveTextAiProviderSettings("openai", { apiKey: "k" });
    // grok intentionally has no key -> excluded.

    const res = await runMultiProviderRewrite({
      providers: ["grok", "claude", "openai"],
      prompt: { system: "s", user: "u", temperature: 0.4, maxTokens: 100 },
      completeOverride: async (provider) => rewriteFor(provider),
      scoreCandidate: async (after) => (after.includes("claude") ? 80 : 40),
    });

    expect(res.candidates.map((c) => c.provider)).toEqual(["claude", "openai"]); // keyed only, ranked by score
    expect(res.best?.provider).toBe("claude");
    expect(res.candidates[0].score).toBe(80);
    expect(res.candidates[1].score).toBe(40);
    expect(res.best?.afterScript).toContain("claude door");
  });

  it("keeps a failed provider (as an error candidate, ranked last) but still returns a best", async () => {
    saveTextAiProviderSettings("claude", { apiKey: "k" });
    saveTextAiProviderSettings("openai", { apiKey: "k" });

    const res = await runMultiProviderRewrite({
      providers: ["claude", "openai"],
      prompt: { system: "s", user: "u", temperature: 0.4, maxTokens: 100 },
      completeOverride: async (provider) => {
        if (provider === "openai") throw new Error("openai boom");
        return rewriteFor(provider);
      },
      scoreCandidate: async () => 55,
    });

    expect(res.best?.provider).toBe("claude");
    const openai = res.candidates.find((c) => c.provider === "openai");
    expect(openai?.error).toMatch(/boom/);
    expect(res.candidates[res.candidates.length - 1].provider).toBe("openai"); // errored last
  });

  it("throws when no selected provider has a key", async () => {
    await expect(
      runMultiProviderRewrite({
        providers: ["claude", "openai"],
        prompt: { system: "s", user: "u", temperature: 0.4, maxTokens: 100 },
        completeOverride: async () => rewriteFor("x"),
      }),
    ).rejects.toThrow(/API key/i);
  });
});
