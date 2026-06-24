import { describe, it, expect } from "vitest";
import { correctFountainFormatting } from "./fountainFormatCorrector";

// Helper: the index of a line, asserting it exists.
const idx = (lines: string[], value: string) => {
  const at = lines.indexOf(value);
  expect(at, `expected to find line "${value}"`).toBeGreaterThanOrEqual(0);
  return at;
};

describe("correctFountainFormatting", () => {
  it("pulls dialogue up under a cue that the writer separated with a blank line (the reported bug)", () => {
    // Sao's output: every cue has a stray blank before its dialogue, so the cues
    // render as action. There's no KB list — recurrence must find the cues.
    const input = [
      "!!WS KITCHEN",
      "",
      "Aliyah is sitting at the table, staring at the book.",
      "",
      "ALIYAH",
      "",
      "(to herself) I did it. I finally know what happens.",
      "",
      "!!CU ALIYAH'S FACE",
      "",
      "Aliyah looks happy and satisfied.",
      "",
      "ALIYAH",
      "",
      "(to herself) It was worth it. It was all worth it.",
    ].join("\n");
    const out = correctFountainFormatting(input); // no extraNames — rely on recurrence
    const lines = out.split("\n");

    // Each cue is now immediately followed by its dialogue (no blank between).
    const firstCue = idx(lines, "ALIYAH");
    expect(lines[firstCue + 1]).toBe("(to herself) I did it. I finally know what happens.");
    const secondCue = lines.indexOf("ALIYAH", firstCue + 1);
    expect(lines[secondCue + 1]).toBe("(to herself) It was worth it. It was all worth it.");
    // Shots and action are untouched.
    expect(lines).toContain("!!WS KITCHEN");
    expect(lines).toContain("Aliyah is sitting at the table, staring at the book.");
  });

  it("finds a one-off cue from the KB name list even when mis-spaced", () => {
    const input = "MOM\n\nWhere is everyone?";
    const out = correctFountainFormatting(input, ["Mom"]);
    const lines = out.split("\n");
    const cue = idx(lines, "MOM");
    expect(lines[cue + 1]).toBe("Where is everyone?");
  });

  it("classifies scene / shot / action correctly", () => {
    const input = "INT. living room - day\nWS LIVING ROOM\nSunlight streams in.\nTHE ROOM FALLS QUIET.";
    const out = correctFountainFormatting(input);
    const lines = out.split("\n");
    expect(lines).toContain("INT. LIVING ROOM - DAY");
    expect(lines).toContain("!!WS LIVING ROOM");
    expect(lines).toContain("Sunlight streams in.");
    expect(lines).toContain("!THE ROOM FALLS QUIET."); // all-caps action forced
  });

  it("handles transitions: '… TO:' stays, FADE TO BLACK becomes a forced transition", () => {
    const out = correctFountainFormatting("CUT TO:\nFADE TO BLACK.\nEND OF SCENE.");
    const lines = out.split("\n");
    expect(lines).toContain("CUT TO:");
    expect(lines).toContain("> FADE TO BLACK.");
    expect(lines).toContain("> END OF SCENE.");
  });

  it("does not treat stray all-caps directions (ANGLE ON, SUDDENLY) as characters", () => {
    const out = correctFountainFormatting("ANGLE ON\n\nMom comes home.\n\nSUDDENLY\n\nThe lights flicker.");
    const lines = out.split("\n");
    expect(lines).toContain("!ANGLE ON");
    expect(lines).toContain("!SUDDENLY");
    expect(lines.filter((l) => l === "ANGLE ON")).toHaveLength(0);
  });

  it("preserves the title page and already-forced lines", () => {
    const input = "Title: Sticky Storms\nAuthor: MM\n\nINT. KITCHEN - DAY\n\n!!CU THE KETTLE\n!The kettle SCREAMS.";
    const out = correctFountainFormatting(input);
    expect(out).toContain("Title: Sticky Storms");
    expect(out).toContain("Author: MM");
    expect(out).toContain("!!CU THE KETTLE");
    expect(out).toContain("!The kettle SCREAMS.");
  });

  it("does not turn an action sentence that starts with a name into a cue", () => {
    const out = correctFountainFormatting("ALIYAH runs for the door.", ["ALIYAH"]);
    expect(out).toContain("ALIYAH runs for the door.");
    expect(out.split("\n").filter((l) => l.trim() === "ALIYAH")).toHaveLength(0);
  });
});
