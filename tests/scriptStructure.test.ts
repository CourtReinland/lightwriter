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

  it("removes character mentions from scene background prompts and infers missing set detail from whole-script tone", () => {
    const sparseScript = `Title: Gothic Romance

INT. MANOR HALL - NIGHT

ISABELLA
Do not open that door.

EXT. MOOR - DAWN

A lonely wind moves through dead grass. Ancient stones vanish into fog.
`;
    const scene = extractScriptScenes(sparseScript)[0];
    const prompt = buildAssetPrompt({ kind: "scene_set", scene, fullScriptContent: sparseScript });

    expect(prompt).toContain("INT. MANOR HALL - NIGHT");
    expect(prompt).toContain("Infer background details from the overall script context");
    expect(prompt).toContain("gothic romance");
    expect(prompt).not.toContain("ISABELLA");
    expect(prompt.toLowerCase()).not.toContain("character");
    expect(prompt.toLowerCase()).not.toContain("face");
  });

  it("strips title-case character names, person actions, and readable cover text from editable scene prompts", () => {
    const cartoonScript = `Title: Playful Kids Cartoon

INT. LIVING ROOM, HOME, DAY

Aliyah sits on the couch reading a novel. Aliyah has a very melodramatic expression. Aliyah starts crying, with very exaggerated sniffling. Aliyah sighs. The book cover reads "Caribbean Romance".

EXT. BACKYARD - DAY

Wind moves through bright paper decorations while rain taps a toy umbrella.
`;
    const scene = extractScriptScenes(cartoonScript)[0];
    const prompt = buildAssetPrompt({ kind: "scene_set", scene, fullScriptContent: cartoonScript });
    const lowerPrompt = prompt.toLowerCase();

    expect(prompt).toContain("INT. LIVING ROOM, HOME, DAY");
    expect(prompt).toContain("Infer background details from the overall script context");
    expect(lowerPrompt).toContain("children's cartoon");
    expect(prompt).not.toContain("Aliyah");
    expect(lowerPrompt).not.toContain("sits on the couch");
    expect(lowerPrompt).not.toContain("melodramatic expression");
    expect(lowerPrompt).not.toContain("starts crying");
    expect(lowerPrompt).not.toContain("sniffling");
    expect(lowerPrompt).not.toContain("sighs");
    expect(lowerPrompt).not.toContain("caribbean romance");
    expect(lowerPrompt).not.toContain("book cover reads");
  });

  it("keeps environmental actions like wind and rain in editable scene prompts", () => {
    const weatherScript = `Title: Stormy Animation

EXT. BACKYARD - DAY

Wind moves through bright paper decorations. Rain taps a toy umbrella. Lightning flashes over a painted fence.
`;
    const scene = extractScriptScenes(weatherScript)[0];
    const prompt = buildAssetPrompt({ kind: "scene_set", scene, fullScriptContent: weatherScript });

    expect(prompt).toContain("Wind moves through bright paper decorations");
    expect(prompt).toContain("Rain taps a toy umbrella");
    expect(prompt).toContain("Lightning flashes over a painted fence");
  });

  it("adds a script-level style reference note to scene prompts when provided", () => {
    const scene = extractScriptScenes(script)[0];
    const prompt = buildAssetPrompt({
      kind: "scene_set",
      scene,
      fullScriptContent: script,
      styleReference: { name: "gothic-board.png", mimeType: "image/png", dataUrl: "data:image/png;base64,abc" },
    });

    expect(prompt).toContain("Use the attached script-level style reference image");
    expect(prompt).toContain("gothic-board.png");
  });
});
