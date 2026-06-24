import { describe, it, expect } from "vitest";
import { correctFountainFormatting } from "./fountainFormatCorrector";

describe("correctFountainFormatting", () => {
  it("reclassifies a mangled scene by context: shot, action, character cue + dialogue", () => {
    const input = [
      "INT. living room - day",
      "WS LIVING ROOM",
      "Sunlight streams in.",
      "ALIYAH",
      "Hello there.",
      "THE ROOM FALLS QUIET.",
    ].join("\n");
    // ALIYAH is supplied as a known name (also discoverable from the cue itself).
    const out = correctFountainFormatting(input, ["Aliyah"]);
    const lines = out.split("\n");

    expect(lines).toContain("INT. LIVING ROOM - DAY"); // scene heading, uppercased
    expect(lines).toContain("!!WS LIVING ROOM"); // shot gets the !! prefix
    expect(lines).toContain("Sunlight streams in."); // mixed-case action untouched
    expect(lines).toContain("ALIYAH"); // character cue
    expect(lines).toContain("Hello there."); // dialogue under the cue
    expect(lines).toContain("!THE ROOM FALLS QUIET."); // all-caps action forced so it isn't a cue

    // The cue is immediately followed by its dialogue (no blank between).
    const cueIdx = lines.indexOf("ALIYAH");
    expect(lines[cueIdx + 1]).toBe("Hello there.");
  });

  it("uppercases a lower-case character cue that matches a known name", () => {
    const out = correctFountainFormatting("Aliyah\nWhere are you?", ["ALIYAH"]);
    const lines = out.split("\n");
    expect(lines).toContain("ALIYAH");
    expect(lines[lines.indexOf("ALIYAH") + 1]).toBe("Where are you?");
  });

  it("preserves the title page and already-forced lines", () => {
    const input = [
      "Title: Sticky Storms",
      "Author: MM",
      "",
      "INT. KITCHEN - DAY",
      "",
      "!!CU THE KETTLE",
      "!The kettle SCREAMS.",
    ].join("\n");
    const out = correctFountainFormatting(input);
    expect(out).toContain("Title: Sticky Storms");
    expect(out).toContain("Author: MM");
    expect(out).toContain("!!CU THE KETTLE"); // already a shot — left alone
    expect(out).toContain("!The kettle SCREAMS."); // already forced action — left alone
  });

  it("does not turn an action sentence that starts with a name into a cue", () => {
    const out = correctFountainFormatting("ALIYAH runs for the door.", ["ALIYAH"]);
    // A whole (mixed-case) action sentence is left as action, never a bare cue.
    expect(out).toContain("ALIYAH runs for the door.");
    expect(out.split("\n").filter((l) => l.trim() === "ALIYAH")).toHaveLength(0);
  });
});
