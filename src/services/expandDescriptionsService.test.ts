import { describe, it, expect } from "vitest";
import { normalizeLocationKey, buildLocationReferences, buildExpandDescriptionsPrompt } from "./expandDescriptionsService";
import type { ShotSceneBlock } from "./shotDirectionService";

function scene(idx: number, heading: string, text: string): ShotSceneBlock {
  return { idx, heading, text, startLine: 0, endLine: 0 };
}

describe("normalizeLocationKey", () => {
  it("strips INT/EXT prefix and time-of-day so the same place matches", () => {
    expect(normalizeLocationKey("INT. KITCHEN - DAY")).toBe("KITCHEN");
    expect(normalizeLocationKey("INT. KITCHEN - NIGHT")).toBe("KITCHEN");
    expect(normalizeLocationKey("EXT. KITCHEN")).toBe("KITCHEN");
  });

  it("handles continuation and dotted-forced headings", () => {
    expect(normalizeLocationKey("EXT. CITY STREET - CONTINUOUS")).toBe("CITY STREET");
    expect(normalizeLocationKey(".ROOFTOP MOMENTS LATER")).toBe("ROOFTOP");
  });
});

describe("buildLocationReferences", () => {
  it("gives a bare same-location scene a reference to the richest one", () => {
    const scenes = [
      scene(0, "INT. KITCHEN - DAY", "INT. KITCHEN - DAY\n\nA sunlit farmhouse kitchen, copper pots on the wall, flour dusting the butcher block.\n\nMOM\nMorning."),
      scene(1, "INT. KITCHEN - NIGHT", "INT. KITCHEN - NIGHT\n\nDAD\nWhere is everyone?"), // bare, no description
      scene(2, "EXT. BEACH - DAY", "EXT. BEACH - DAY\n\nWaves."),
    ];
    const refs = buildLocationReferences(scenes);
    // The bare KITCHEN scene (idx 1) should reference the rich KITCHEN scene (idx 0).
    expect(refs.has(1)).toBe(true);
    expect(refs.get(1)).toContain("copper pots");
    // The rich scene itself and the lone BEACH scene get no reference.
    expect(refs.has(0)).toBe(false);
    expect(refs.has(2)).toBe(false);
  });
});

describe("buildExpandDescriptionsPrompt", () => {
  it("instructs the model to invent missing scene-setting and includes the visual reference", () => {
    const s = scene(0, "INT. KITCHEN - NIGHT", "INT. KITCHEN - NIGHT\n\nDAD\nWhere is everyone?");
    const prompt = buildExpandDescriptionsPrompt({
      scene: s,
      knowledgeBase: null,
      styleProfile: null,
      locationReference: "INT. KITCHEN - DAY\n\nA sunlit farmhouse kitchen, copper pots on the wall.",
    });
    expect(prompt.system).toMatch(/INVENT where missing/i);
    expect(prompt.system).toMatch(/MUST NOT INVENT/i);
    expect(prompt.user).toContain("VISUAL REFERENCE");
    expect(prompt.user).toContain("copper pots");
  });
});
