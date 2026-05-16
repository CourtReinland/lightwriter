import { describe, expect, it } from "vitest";
import {
  buildShotRewritePrompt,
  extractShotScenes,
  formatShotPassError,
  rewriteScriptWithShotDirections,
  type ShotSceneBlock,
} from "../src/services/shotDirectionService";

describe("extractShotScenes", () => {
  it("preserves title-page preamble and extracts scene blocks", () => {
    const script = "Title: Test\nAuthor: Writer\n\nINT. ROOM - DAY\nAIDEN waits.\n\nEXT. STREET - NIGHT\nMARA runs.";

    const result = extractShotScenes(script);

    expect(result.preamble).toBe("Title: Test\nAuthor: Writer\n");
    expect(result.scenes).toHaveLength(2);
    expect(result.scenes[0].heading).toBe("INT. ROOM - DAY");
    expect(result.scenes[1].text).toContain("MARA runs.");
  });
});

describe("buildShotRewritePrompt", () => {
  it("requires dense professional shot coverage for downstream generation", () => {
    const scene: ShotSceneBlock = {
      idx: 0,
      heading: "INT. ROOM - DAY",
      text: "INT. ROOM - DAY\n\nAIDEN faces MARA.\n\nAIDEN\nWe have to go.",
      startLine: 0,
      endLine: 4,
    };

    const prompt = buildShotRewritePrompt({
      scene,
      previousHeading: undefined,
      nextHeading: "EXT. STREET - DAY",
      knowledgeBase: null,
    });

    expect(prompt.system).toContain("screenplay-to-image/video generation workflow");
    expect(prompt.system).toContain("Every added shot line MUST start with !!");
    expect(prompt.system).toContain("Use the compact shot vocabulary primarily as: WS, MS, CU");
    expect(prompt.system).toContain("over-the-shoulder singles");
    expect(prompt.system).toContain("rapid camera changes");
    expect(prompt.user).toContain("Next scene: EXT. STREET - DAY");
    expect(prompt.user).toContain(scene.text);
  });
});

describe("rewriteScriptWithShotDirections", () => {
  const settings = {
    provider: "grok" as const,
    apiKey: "test-key",
    model: "grok-3-mini-fast",
    updatedAt: 0,
  };

  it("passes selected provider settings, longer timeout, and preserves scene-specific error context", async () => {
    const script = "INT. ROOM - DAY\n\nAIDEN waits.";
    const completions: unknown[] = [];

    await expect(rewriteScriptWithShotDirections(
      script,
      settings,
      null,
      undefined,
      async (_system, _user, options) => {
        completions.push(options);
        throw new Error("Grok API timed out after 90000ms");
      },
    )).rejects.toThrow("Shot pass failed on scene 1/1 (INT. ROOM - DAY): Grok API timed out after 90000ms");

    expect(completions).toEqual([expect.objectContaining({ timeoutMs: 240_000 })]);
  });

  it("formats shot-pass failures with the scene heading", () => {
    const err = formatShotPassError({ idx: 0, heading: "EXT. ROAD - NIGHT", text: "", startLine: 0, endLine: 0 }, 2, 4, new Error("bad model"));
    expect(err.message).toBe("Shot pass failed on scene 2/4 (EXT. ROAD - NIGHT): bad model");
  });
});
