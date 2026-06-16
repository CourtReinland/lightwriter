import { describe, expect, it } from "vitest";
import {
  buildExpandDescriptionsPrompt,
  rewriteScriptWithExpandedDescriptions,
  formatExpandError,
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
  it("instructs the model to deepen visuals without adding shots or changing story", () => {
    const { scenes } = extractShotScenes(SCRIPT);
    const prompt = buildExpandDescriptionsPrompt({ scene: scenes[0], knowledgeBase: null, styleProfile: null });

    expect(prompt.system).toContain("downstream AI image/video generation");
    expect(prompt.system).toContain("Do NOT add new !! shot lines");
    expect(prompt.system).toContain("Do NOT invent new plot events");
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
