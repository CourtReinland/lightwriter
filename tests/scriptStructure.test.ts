import { describe, expect, it } from "vitest";
import { buildAssetPrompt, extractCharacters, extractScriptScenes, extractShotLines } from "../src/services/scriptStructure";

describe("scriptStructure", () => {
  const script = `Title: Pilot

INT. COFFEE SHOP - DAY

A cozy neighborhood cafe. Rain streaks down the windows. ALEX (30s, restless eyes) waits alone.

!!WIDE SHOT - The whole cafe glows against the storm.

ALEX
I need a new plan.

EXT. ROOFTOP - NIGHT

MAYA (20s, elegant, dangerous) watches the skyline.
`;

  it("extracts scene references for set generation from Fountain headings and descriptions", () => {
    const scenes = extractScriptScenes(script);

    expect(scenes).toHaveLength(2);
    expect(scenes[0]).toMatchObject({
      sceneIndex: 0,
      heading: "INT. COFFEE SHOP - DAY",
      locationType: "INT.",
      location: "COFFEE SHOP",
      timeOfDay: "DAY",
      startLine: 3,
    });
    expect(scenes[0].description).toContain("cozy neighborhood cafe");
  });

  it("extracts forced shot lines with Script2Screen shot keys", () => {
    const shots = extractShotLines(script);

    expect(shots).toEqual([
      expect.objectContaining({
        shotKey: "s0_sh0",
        sceneIndex: 0,
        shotIndex: 0,
        sceneHeading: "INT. COFFEE SHOP - DAY",
        text: "WIDE SHOT - The whole cafe glows against the storm.",
      }),
    ]);
  });

  it("extracts character prompts from all-caps cues and parenthetical descriptions", () => {
    const characters = extractCharacters(script);

    expect(characters).toEqual([
      expect.objectContaining({ name: "ALEX", description: "30s, restless eyes" }),
      expect.objectContaining({ name: "MAYA", description: "20s, elegant, dangerous" }),
    ]);
  });

  it("builds editable Hollywood-style prompts for scene sets and character images", () => {
    const scene = extractScriptScenes(script)[0];
    const character = extractCharacters(script)[0];

    expect(buildAssetPrompt({ kind: "scene_set", scene })).toContain("INT. COFFEE SHOP - DAY");
    expect(buildAssetPrompt({ kind: "scene_set", scene })).toContain("cinematic scene background");
    expect(buildAssetPrompt({ kind: "character", character })).toContain("ALEX");
    expect(buildAssetPrompt({ kind: "character", character })).toContain("30s, restless eyes");
  });
});
