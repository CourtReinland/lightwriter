import { describe, it, expect } from "vitest";
import { cleanupGeneratedScreenplay, repairImportedScreenplay } from "./generatedScriptCleanup";

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

describe("repairImportedScreenplay", () => {
  it("stops a leading-dot stage direction from being a scene heading", () => {
    const input = "MAX\n.from inside the apartment\nLila, dinner!\n";
    const out = repairImportedScreenplay(input);
    expect(out).not.toContain(".from inside the apartment");
    expect(out).toContain("(from inside the apartment)");
  });

  it("re-prefixes a bare camera-shot line with !!", () => {
    const out = repairImportedScreenplay("WS LIVING ROOM\n");
    expect(out).toContain("!!WS LIVING ROOM");
  });

  it("converts dot-forced camera shots (which render as scenes) to !! shots", () => {
    const input = ".WS WIDE SHOT LIBRARY\n.CU CLOSE UP ALIYAH\n.MS MEDIUM SHOT AIDEN\n";
    const out = repairImportedScreenplay(input);
    expect(out).toContain("!!WS WIDE SHOT LIBRARY");
    expect(out).toContain("!!CU CLOSE UP ALIYAH");
    expect(out).toContain("!!MS MEDIUM SHOT AIDEN");
    expect(out).not.toContain(".WS");
    expect(out).not.toContain(".CU");
  });

  it("leaves a clean script untouched (no-op)", () => {
    const clean = "INT. KITCHEN - DAY\n\nFinn cooks.\n\nFINN\nHi.\n\n!!CU FINN'S FACE\n";
    expect(repairImportedScreenplay(clean)).toBe(clean);
  });
});

describe("unescapeLiteralNewlines (field regression: all-left-justified blob)", () => {
  it("repairs a script delivered as literal \\n sequences", async () => {
    const { cleanupGeneratedScreenplay } = await import("./generatedScriptCleanup");
    const raw = 'INT. HALL - NIGHT\\n\\nMara paces.\\n\\nMARA\\nNow or never.\\n';
    const out = cleanupGeneratedScreenplay(raw, ["MARA"]);
    expect(out.split("\n").length).toBeGreaterThan(5);
    expect(out).toContain("INT. HALL - NIGHT");
    const lines = out.split("\n");
    expect(lines[lines.indexOf("MARA") + 1]).toBe("Now or never.");
  });

  it("leaves a normal script with real newlines alone", async () => {
    const { unescapeLiteralNewlines } = await import("./generatedScriptCleanup");
    const normal = "INT. A - DAY\n\nAction about C:\\new\\north paths.\n";
    expect(unescapeLiteralNewlines(normal)).toBe(normal);
  });
});
