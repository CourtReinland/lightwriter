import { describe, expect, it } from "vitest";
import {
  buildExpandDescriptionsPrompt,
  rewriteScriptWithExpandedDescriptions,
  formatExpandError,
  fillSceneDescriptions,
  sceneNeedsDescription,
} from "../src/services/expandDescriptionsService";
import { extractShotScenes } from "../src/services/shotDirectionService";
import type { TextAiProviderSettings } from "../src/services/textAiSettingsService";

const SCRIPT = `Title: Test
Author: Writer

INT. ROOM - DAY

MARA enters.

MARA
Hello?

EXT. STREET - DAY

MARA runs.
`;

const settings: TextAiProviderSettings = { provider: "grok", apiKey: "test-key", model: "grok-3-mini-fast", updatedAt: 0 };

describe("expand descriptions prompt", () => {
  it("deepens visuals, invents missing scene-setting, but never adds shots or changes story", () => {
    const { scenes } = extractShotScenes(SCRIPT);
    const prompt = buildExpandDescriptionsPrompt({ scene: scenes[0], knowledgeBase: null, styleProfile: null });

    expect(prompt.system).toContain("downstream AI image/video generation");
    expect(prompt.system).toContain("Do NOT add new !! shot lines");
    // May invent the visual look where a scene has none...
    expect(prompt.system).toMatch(/INVENT where missing/i);
    // ...but must not invent plot, dialogue, or characters.
    expect(prompt.system).toContain("new plot events");
    expect(prompt.system).toContain("Preserve the scene heading");
    expect(prompt.user).toContain(scenes[0].text);
  });
});

describe("expand descriptions whole-script pass", () => {
  it("rewrites every scene and preserves the title-page preamble", async () => {
    const headings: string[] = [];
    const result = await rewriteScriptWithExpandedDescriptions(
      SCRIPT,
      settings,
      null,
      null,
      undefined,
      async (_system, user) => {
        // Echo the scene text with a marker so we can assert each scene was processed.
        const sceneText = user.split("---\n")[1]?.split("\n---")[0] ?? "";
        headings.push(sceneText.split("\n")[0]);
        return `${sceneText}\nDeep golden afternoon light spills across the room.`;
      },
    );

    expect(result).toContain("Title: Test");
    expect(result).toContain("Deep golden afternoon light spills across the room.");
    expect(headings).toEqual(["INT. ROOM - DAY", "EXT. STREET - DAY"]);
  });

  it("formats a per-scene error with scene number and heading", () => {
    const { scenes } = extractShotScenes(SCRIPT);
    const err = formatExpandError(scenes[1], 2, 2, new Error("model exploded"));
    expect(err.message).toBe("Expand descriptions failed on scene 2/2 (EXT. STREET - DAY): model exploded");
  });
});

describe("sceneNeedsDescription", () => {
  const names = new Set(["MARA"]);
  const sceneOf = (text: string) => extractShotScenes(text).scenes[0];

  it("flags scenes that open with a shot, a cue, or character action", () => {
    expect(sceneNeedsDescription(sceneOf("INT. KITCHEN - DAY\n\n!!WS KITCHEN\nThings happen."), names)).toBe(true);
    expect(sceneNeedsDescription(sceneOf("INT. KITCHEN - DAY\n\nMARA\nHi."), names)).toBe(true);
    expect(sceneNeedsDescription(sceneOf("INT. KITCHEN - DAY\n\nMara opens the fridge."), names)).toBe(true);
    expect(sceneNeedsDescription(sceneOf("INT. KITCHEN - DAY"), names)).toBe(true); // empty scene
  });

  it("leaves scenes that already open with a setting description", () => {
    expect(sceneNeedsDescription(sceneOf("INT. KITCHEN - DAY\n\nThe kitchen is small, bright, and spotless."), names)).toBe(false);
  });
});

describe("fillSceneDescriptions (scoped scene-setting fill)", () => {
  it("detects genre once, then inserts a location description under scenes that lack one", async () => {
    const systems: string[] = [];
    const result = await fillSceneDescriptions(
      SCRIPT,
      settings,
      null,
      null,
      undefined,
      async (system, user) => {
        systems.push(system);
        if (/identify the genre/i.test(system)) return "quirky indie drama";
        if (/establishing scene descriptions/i.test(system)) {
          const ids = [...user.matchAll(/"id":\s*(\d+)/g)].map((m) => Number(m[1]));
          return JSON.stringify({ descriptions: ids.map((id) => ({ id, description: `Location ${id}: warm clutter and afternoon light.` })) });
        }
        return "";
      },
    );

    // Genre detected, then a batched description call (not one call per scene).
    expect(systems.filter((s) => /identify the genre/i.test(s))).toHaveLength(1);
    expect(systems.filter((s) => /establishing scene descriptions/i.test(s))).toHaveLength(1);

    // Each scene heading is now immediately followed by its setting description.
    const lines = result.split("\n");
    const intIdx = lines.indexOf("INT. ROOM - DAY");
    expect(lines[intIdx + 2]).toBe("Location 0: warm clutter and afternoon light.");
    expect(result).toContain("Location 1: warm clutter and afternoon light.");
    // The original action is preserved, after the new description.
    expect(result).toContain("MARA enters.");
    expect(result).toContain("Title: Test");
  });

  it("skips the genre call when the KB already has a genre", async () => {
    const systems: string[] = [];
    await fillSceneDescriptions(
      SCRIPT,
      settings,
      { projectId: "p", characters: [], scenes: [], worldRules: [], plotThreads: [], toneStyle: { genre: "horror", mood: "", pacingNotes: "", targetStyle: "", styleNotes: "" }, customNotes: [], updatedAt: 0 } as never,
      null,
      undefined,
      async (system, user) => {
        systems.push(system);
        const ids = [...user.matchAll(/"id":\s*(\d+)/g)].map((m) => Number(m[1]));
        return JSON.stringify({ descriptions: ids.map((id) => ({ id, description: `desc ${id}` })) });
      },
    );
    expect(systems.some((s) => /identify the genre/i.test(s))).toBe(false);
  });
});
