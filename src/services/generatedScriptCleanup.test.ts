import { describe, it, expect } from "vitest";
import { cleanupGeneratedScreenplay } from "./generatedScriptCleanup";

describe("cleanupGeneratedScreenplay", () => {
  it("repairs a mistyped slash-paren stage direction", () => {
    const input = "MAX\n/agreeing)\nYeah, let's do it.\n";
    const out = cleanupGeneratedScreenplay(input, ["MAX"]);
    expect(out).not.toContain("/agreeing)");
    expect(out).toContain("(agreeing)");
  });

  it("repairs a leading-dot lowercase stage direction under a cue", () => {
    const input = "MAX\n.from inside the apartment\nLila, dinner!\n";
    const out = cleanupGeneratedScreenplay(input, ["MAX"]);
    expect(out).not.toContain(".from inside the apartment");
    expect(out).toContain("(from inside the apartment)");
  });

  it("leaves a real (uppercase) forced scene heading alone", () => {
    const input = ".A SECRET ROOM\n\nThe walls drip.\n";
    const out = cleanupGeneratedScreenplay(input, []);
    expect(out).toContain(".A SECRET ROOM");
  });

  it("does not invent parentheticals from ordinary action lines", () => {
    const input = "INT. ROOM - DAY\n\nThe door opens slowly.\n";
    const out = cleanupGeneratedScreenplay(input, []);
    expect(out).toContain("The door opens slowly.");
    expect(out).not.toContain("(The door opens slowly.)");
  });
});
