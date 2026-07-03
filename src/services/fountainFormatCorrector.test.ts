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

  it("keeps a (V.O.)/(O.S.) extension on its own line attached to the cue + dialogue", () => {
    const out = correctFountainFormatting("ALIYAH\n(V.O.)\n\nSomething happened.", ["ALIYAH"]);
    const lines = out.split("\n");
    const cue = idx(lines, "ALIYAH");
    expect(lines[cue + 1]).toBe("(V.O.)");
    expect(lines[cue + 2]).toBe("Something happened."); // dialogue pulled up under the wryly
    expect(out).not.toContain("!(V.O.)"); // never orphaned as forced action
  });

  it("does not promote recurring SFX (gerund phrases) to character cues", () => {
    const input = "INT. ROOM - DAY\n\nPHONE RINGING\nShe picks it up.\n\nPHONE RINGING\nHe answers the call.";
    const out = correctFountainFormatting(input);
    const lines = out.split("\n");
    expect(lines).toContain("!PHONE RINGING"); // forced action, not a cue
    expect(lines.filter((l) => l === "PHONE RINGING")).toHaveLength(0);
    expect(lines).toContain("She picks it up."); // stays a separate action line
  });

  it("treats 'DISSOLVE TO BLACK' (no colon) as a transition, not a character", () => {
    const out = correctFountainFormatting("DISSOLVE TO BLACK\nWe see the mansion fade away.");
    const lines = out.split("\n");
    expect(lines).toContain("> DISSOLVE TO BLACK");
    expect(lines).toContain("We see the mansion fade away.");
    expect(lines.filter((l) => l === "DISSOLVE TO BLACK")).toHaveLength(0);
  });

  it("recognizes a transition with a trailing colon", () => {
    const out = correctFountainFormatting("FADE TO BLACK:\n\nSilence.");
    expect(out).toContain("> FADE TO BLACK:");
    expect(out).not.toContain("!FADE TO BLACK:");
  });

  it("does not turn an action sentence that starts with a name into a cue", () => {
    const out = correctFountainFormatting("ALIYAH runs for the door.", ["ALIYAH"]);
    expect(out).toContain("ALIYAH runs for the door.");
    expect(out.split("\n").filter((l) => l.trim() === "ALIYAH")).toHaveLength(0);
  });
});

describe("colon-cue splitting (\"NAME: dialogue\" on one line)", () => {
  it("splits a known-name colon cue into cue + dialogue", () => {
    const out = correctFountainFormatting("INT. ROOM - DAY\n\nMARA: We should go.", ["MARA"]);
    const lines = out.split("\n");
    const cueAt = lines.indexOf("MARA");
    expect(cueAt).toBeGreaterThanOrEqual(0);
    expect(lines[cueAt + 1]).toBe("We should go.");
  });

  it("splits a mixed-case colon cue when the name is in the KB", () => {
    const out = correctFountainFormatting("Mara: We should go.", ["Mara"]);
    const lines = out.split("\n");
    const cueAt = lines.indexOf("MARA");
    expect(cueAt).toBeGreaterThanOrEqual(0);
    expect(lines[cueAt + 1]).toBe("We should go.");
  });

  it("keeps the (V.O.) extension on the cue line", () => {
    const out = correctFountainFormatting("MARA (V.O.): It was over.", ["MARA"]);
    const lines = out.split("\n");
    const cueAt = lines.indexOf("MARA (V.O.)");
    expect(cueAt).toBeGreaterThanOrEqual(0);
    expect(lines[cueAt + 1]).toBe("It was over.");
  });

  it("does NOT split prose like 'NOTE: the door is locked' (unknown name)", () => {
    const out = correctFountainFormatting("NOTE: the door is locked.");
    expect(out).not.toContain("\nNOTE\n");
  });

  it("leaves transitions like 'CUT TO:' alone", () => {
    const out = correctFountainFormatting("CUT TO:\n\nINT. HALL - NIGHT", ["CUT"]);
    expect(out).toContain("CUT TO:");
  });
});

describe("review regressions: constructs the corrector must NOT mangle", () => {
  it("keeps ALL-CAPS shouted dialogue attached to its cue (not forced to action)", () => {
    const out = correctFountainFormatting("MARA\nGET OUT!", ["MARA"]);
    const lines = out.split("\n");
    const cueAt = lines.indexOf("MARA");
    expect(cueAt).toBeGreaterThanOrEqual(0);
    expect(lines[cueAt + 1]).toBe("GET OUT!");
    expect(out).not.toContain("!GET OUT!");
  });

  it("keeps a dual-dialogue cue (JONAS ^) as a cue, not forced action", () => {
    const out = correctFountainFormatting("MARA\nNow.\n\nJONAS ^\nNever.", ["MARA", "JONAS"]);
    const lines = out.split("\n");
    const dualAt = lines.indexOf("JONAS ^");
    expect(dualAt).toBeGreaterThanOrEqual(0);
    expect(lines[dualAt + 1]).toBe("Never.");
    expect(out).not.toContain("!JONAS ^");
  });

  it("keeps multi-line title-page values verbatim", () => {
    const input = "Title:\n\t_**BRICK & STEEL**_\nCredit: Written by\n\nINT. ROOM - DAY";
    const out = correctFountainFormatting(input);
    expect(out).toContain("\t_**BRICK & STEEL**_");
    expect(out).not.toContain("!_**BRICK & STEEL**_");
  });

  it("keeps a forced @cue paired with its dialogue (no blank inserted)", () => {
    const out = correctFountainFormatting("@McClane\nYippee ki-yay.");
    const lines = out.split("\n");
    const cueAt = lines.indexOf("@McClane");
    expect(cueAt).toBeGreaterThanOrEqual(0);
    expect(lines[cueAt + 1]).toBe("Yippee ki-yay.");
  });

  it("does NOT re-attribute a dialogue line that starts with another character's name + colon", () => {
    const out = correctFountainFormatting("JONAS\nMara: that's her name, her curse.", ["JONAS", "MARA"]);
    const lines = out.split("\n");
    const cueAt = lines.indexOf("JONAS");
    expect(cueAt).toBeGreaterThanOrEqual(0);
    expect(lines[cueAt + 1]).toBe("Mara: that's her name, her curse.");
    // MARA must not have been minted as a cue for this line
    expect(lines.filter((l) => l === "MARA")).toHaveLength(0);
  });
});

describe("field regressions: centered runs + left-justified blobs", () => {
  it("does not absorb action lines about cast members into a dialogue block (no blank line)", () => {
    const input = [
      "INT. KITCHEN - DAY",
      "",
      "MARA",
      "We should go. Tonight.",
      "Mara crosses to the window and pulls the curtain shut.",
      "Jonas watches her from the doorway, arms folded.",
      "JONAS",
      "You said that yesterday.",
    ].join("\n");
    const out = correctFountainFormatting(input, ["MARA", "JONAS"]);
    const lines = out.split("\n");
    const cueAt = lines.indexOf("MARA");
    // dialogue block = exactly one spoken line, then the action breaks out
    expect(lines[cueAt + 1]).toBe("We should go. Tonight.");
    expect(lines[cueAt + 2]).toBe(""); // block terminated
    expect(out).toContain("Mara crosses to the window and pulls the curtain shut.");
  });

  it("caps a runaway dialogue block at 4 unbroken LONG paragraphs", () => {
    const long = (n: number) => `This is long unbroken paragraph number ${n} that keeps going well past the threshold.`;
    const input = ["MARA", long(1), long(2), long(3), long(4), long(5)].join("\n");
    const out = correctFountainFormatting(input, ["MARA"]);
    const lines = out.split("\n");
    const cueAt = lines.indexOf("MARA");
    expect(lines[cueAt + 4]).toBe(long(4));
    expect(lines[cueAt + 5]).toBe(""); // capped
    expect(out).toContain(long(5)); // preserved as action, not dropped
  });

  it("keeps a short-line verse/monologue fully attached (no cap on short lines)", () => {
    const input = ["MARA", "Line one.", "Line two.", "Line three.", "Line four.", "Line five.", "Line six."].join("\n");
    const out = correctFountainFormatting(input, ["MARA"]);
    const lines = out.split("\n");
    const cueAt = lines.indexOf("MARA");
    expect(lines[cueAt + 6]).toBe("Line six."); // all attached
  });

  it("keeps dialogue that merely MENTIONS a cast member attached ('Mara told me everything')", () => {
    const input = [
      "JONAS",
      "I know what you did.",
      "Mara told me everything about the plan.",
    ].join("\n");
    const out = correctFountainFormatting(input, ["MARA", "JONAS"]);
    const lines = out.split("\n");
    const cueAt = lines.indexOf("JONAS");
    expect(lines[cueAt + 1]).toBe("I know what you did.");
    expect(lines[cueAt + 2]).toBe("Mara told me everything about the plan."); // still dialogue
  });
});
