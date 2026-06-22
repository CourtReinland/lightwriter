import { describe, it, expect } from "vitest";
import { normalizeShotLines, countMisformattedShots } from "./fountainShotNormalizer";

describe("normalizeShotLines", () => {
  it("prefixes bare ALL-CAPS shot lines with !! so they stop parsing as character cues", () => {
    const input = [
      "INT. LIVING ROOM, HOME, DAY",
      "",
      "WS LIVING ROOM",
      "Sunlight streams through curtains.",
      "",
      "MS ALIYAH",
      "Aliyah sits holding a novel.",
      "",
      "AIDEN",
      "What's wrong?",
    ].join("\n");
    const out = normalizeShotLines(input);
    expect(out).toContain("!!WS LIVING ROOM");
    expect(out).toContain("!!MS ALIYAH");
    // A real character cue + its dialogue is left alone.
    expect(out).toContain("\nAIDEN\nWhat's wrong?");
    expect(out).not.toContain("!!AIDEN");
    // The scene heading is untouched.
    expect(out).toContain("INT. LIVING ROOM, HOME, DAY");
  });

  it("leaves already-prefixed shots, sluglines, transitions, and prose alone", () => {
    const input = [
      "EXT. STREET - NIGHT",
      "",
      "!!CU ALIYAH'S FACE",
      "She smiles.",
      "",
      "CUT TO:",
      "",
      "The car pulls away slowly.",
    ].join("\n");
    expect(normalizeShotLines(input)).toBe(input);
  });

  it("does not mistake 'CUT TO:' or mixed-case prose for a shot", () => {
    const input = "CUT TO:\nMs. Aliyah waves.";
    expect(normalizeShotLines(input)).toBe(input);
  });

  it("counts only the misformatted shots", () => {
    expect(countMisformattedShots("WS ROOM\n!!MS ALIYAH\nALIYAH\nHi.")).toBe(1);
  });
});
