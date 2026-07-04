import { describe, it, expect, vi, afterEach } from "vitest";
import { TextAiService } from "../src/services/textAiService";
import type { TextAiProviderSettings } from "../src/services/textAiSettingsService";

const settings = { provider: "claude", apiKey: "sk-ant-api03-test", model: "claude-sonnet-5" } as unknown as TextAiProviderSettings;

afterEach(() => vi.unstubAllGlobals());

describe("Claude temperature deprecation (Sonnet 5 rejects the param)", () => {
  it("retries without temperature on the 400 deprecation error, then learns the model", async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      bodies.push(body);
      if ("temperature" in body) {
        return new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "`temperature` is deprecated for this model." } }), { status: 400 });
      }
      return new Response(JSON.stringify({ content: [{ type: "text", text: "ok" }] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const svc = new TextAiService(settings);
    const out = await svc.complete("sys", "user", { temperature: 0.7, maxTokens: 32 });
    expect(out).toBe("ok");
    expect(bodies).toHaveLength(2);
    expect("temperature" in bodies[0]).toBe(true);  // first try carries it
    expect("temperature" in bodies[1]).toBe(false); // retry drops it

    // The model is learned: the next call skips temperature outright (one call).
    const out2 = await svc.complete("sys", "user", { temperature: 1.1, maxTokens: 32 });
    expect(out2).toBe("ok");
    expect(bodies).toHaveLength(3);
    expect("temperature" in bodies[2]).toBe(false);
  });

  it("still surfaces unrelated 400s untouched", async () => {
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "credit balance is too low" } }), { status: 400 }),
    ));
    const svc = new TextAiService({ ...settings, model: "claude-opus-4-8" } as unknown as TextAiProviderSettings);
    await expect(svc.complete("sys", "user", { temperature: 0.5 })).rejects.toThrow(/400.*credit balance/s);
  });
});
