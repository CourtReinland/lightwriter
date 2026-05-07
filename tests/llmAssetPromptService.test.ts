import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateReviewedAssetPrompt, generateReviewedAssetPrompts, promptViolations } from "../src/services/llmAssetPromptService";
import type { ScriptSceneRef } from "../src/services/scriptStructure";

function makeLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => store.set(key, value)),
    removeItem: vi.fn((key: string) => store.delete(key)),
    clear: vi.fn(() => store.clear()),
  };
}

const scene: ScriptSceneRef = {
  sceneIndex: 0,
  heading: "INT. LIVING ROOM, HOME, DAY",
  locationType: "INT.",
  location: "LIVING ROOM, HOME",
  timeOfDay: "DAY",
  startLine: 1,
  endLine: 6,
  description:
    'Aliyah sits on the couch reading a novel. Aliyah starts crying. The book cover reads "Caribbean Romance".',
};

describe("llmAssetPromptService", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", makeLocalStorage());
    localStorage.setItem("lw-grok-api-key", "xai-key");
  });

  it("uses two LLM calls: one draft pass and one rule-conformance pass", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content:
                  "Empty scene background for INT. LIVING ROOM, HOME, DAY. Aliyah's cozy cartoon living room, do not copy style reference composition.",
              },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content:
                  "cozy children's cartoon living room interior, soft daylight, rounded furniture, colorful storybook props, warm playful palette, gentle lens softness",
              },
            },
          ],
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const prompt = await generateReviewedAssetPrompt({
      kind: "scene_set",
      scene,
      fullScriptContent: `Title: Playful Kids Cartoon\n\n${scene.heading}\n\n${scene.description}`,
      styleReference: { name: "style.png", mimeType: "image/png", dataUrl: "data:image/png;base64,abc" },
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).messages[0].content).toContain("PASS 1");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).messages[0].content).toContain("PASS 2");
    expect(prompt).toBe(
      "cozy children's cartoon living room interior, soft daylight, rounded furniture, colorful storybook props, warm playful palette, gentle lens softness",
    );
  });

  it("generates reviewed prompts for every selected script reference without generating images", async () => {
    const secondScene: ScriptSceneRef = {
      ...scene,
      sceneIndex: 1,
      heading: "EXT. BACKYARD, HOME, NIGHT",
      locationType: "EXT.",
      location: "BACKYARD, HOME",
      timeOfDay: "NIGHT",
      description: "Rain rattles the patio umbrella while Aliyah watches from the doorway.",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: "draft one" } }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: "cozy cartoon living room, soft daylight, rounded furniture" } }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: "draft two" } }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: "rainy suburban backyard, patio umbrella, night lighting, wet grass" } }] }) });
    vi.stubGlobal("fetch", fetchMock);

    const prompts = await generateReviewedAssetPrompts([
      { kind: "scene_set", scene, fullScriptContent: `Title\n${scene.heading}\n${scene.description}` },
      { kind: "scene_set", scene: secondScene, fullScriptContent: `Title\n${secondScene.heading}\n${secondScene.description}` },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(prompts).toEqual([
      "cozy cartoon living room, soft daylight, rounded furniture",
      "rainy suburban backyard, patio umbrella, night lighting, wet grass",
    ]);
  });

  it("detects instruction text, placeholders, scene headings, and leaked character names", () => {
    const violations = promptViolations(
      "Empty scene background for INT. LIVING ROOM, HOME, DAY. Aliyah, description goes here, no characters, do not copy style reference.",
      ["Aliyah"],
    );

    expect(violations).toEqual(
      expect.arrayContaining([
        "contains instruction-style wording",
        "contains placeholder wording",
        "contains screenplay scene heading",
        "contains character name: Aliyah",
      ]),
    );
  });
});
