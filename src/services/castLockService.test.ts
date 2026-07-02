import { describe, it, expect } from "vitest";
import { collectAllowedCast, castLockBlock, findInventedCharacters } from "./castLockService";
import type { KnowledgeBase } from "./knowledgeBase";

const kb = {
  characters: [
    { id: "1", name: "Mara", description: "", traits: [], voiceNotes: "" },
    { id: "2", name: "Detective Sarah Chen", description: "", traits: [], voiceNotes: "" },
  ],
} as unknown as KnowledgeBase;

const script = [
  "INT. KITCHEN - DAY",
  "",
  "Mara waits by the window.",
  "",
  "MARA",
  "We should go.",
  "",
  "JONAS",
  "Not yet.",
  "",
].join("\n");

describe("collectAllowedCast", () => {
  it("unions script cues and KB characters, uppercased and sorted", () => {
    const cast = collectAllowedCast({ script, knowledgeBase: kb });
    expect(cast).toContain("MARA");
    expect(cast).toContain("JONAS");
    expect(cast).toContain("DETECTIVE SARAH CHEN");
  });

  it("returns [] for an empty script with no KB", () => {
    expect(collectAllowedCast({ script: "" })).toEqual([]);
  });
});

describe("castLockBlock", () => {
  it("names the cast and forbids inventing characters", () => {
    const block = castLockBlock(["MARA", "JONAS"]);
    expect(block).toContain("MARA, JONAS");
    expect(block).toContain("CAST LOCK");
  });

  it("is empty when there is no cast", () => {
    expect(castLockBlock([])).toBe("");
    expect(castLockBlock(undefined)).toBe("");
  });
});

describe("findInventedCharacters", () => {
  const allowed = ["MARA", "JONAS", "DETECTIVE SARAH CHEN"];

  it("flags a brand-new speaking character", () => {
    const after = script + "\nRUTH\nWelcome to my shop.\n";
    expect(findInventedCharacters(after, allowed)).toEqual(["RUTH"]);
  });

  it("does not flag word-overlap variants of allowed names (SARAH vs DETECTIVE SARAH CHEN)", () => {
    const after = script + "\nSARAH\nStay behind me.\n\nSARAH CHEN\nNow.\n";
    expect(findInventedCharacters(after, allowed)).toEqual([]);
  });

  it("returns [] when the allowed list is empty (no lock)", () => {
    expect(findInventedCharacters(script + "\nRUTH\nHi.\n", [])).toEqual([]);
  });

  it("returns [] for a clean candidate", () => {
    expect(findInventedCharacters(script, allowed)).toEqual([]);
  });
});

describe("review regressions: cast-lock quality", () => {
  it("does not let a shared generic title word hide an invented character", () => {
    const allowed = ["DETECTIVE SARAH CHEN", "MARA"];
    const script = "INT. ROOM - DAY\n\nDETECTIVE MIKE ROSS\nNobody move.\n";
    expect(findInventedCharacters(script, allowed)).toEqual(["DETECTIVE MIKE ROSS"]);
  });

  it("flags OLD MAN when only OLD WOMAN is allowed", () => {
    const script = "INT. ROOM - DAY\n\nOLD MAN\nWho goes there?\n";
    expect(findInventedCharacters(script, ["OLD WOMAN"])).toEqual(["OLD MAN"]);
  });

  it("still tolerates real name-part overlap (SARAH vs DETECTIVE SARAH CHEN)", () => {
    const script = "INT. ROOM - DAY\n\nSARAH\nStay close.\n";
    expect(findInventedCharacters(script, ["DETECTIVE SARAH CHEN"])).toEqual([]);
  });

  it("keeps slugline junk out of the allowed cast and out of the flags", () => {
    const script = "INT. HOUSE - DAY (FLASHBACK)\n\nThe TV (an old CRT) flickers.\n\nMARA\nWe should go.\n";
    const cast = collectAllowedCast({ script });
    expect(cast).not.toContain("INT. HOUSE - DAY");
    expect(cast).toContain("MARA");
    // and the checking side ignores slugline junk in a candidate
    const candidate = "INT. HOUSE - NIGHT (FLASHBACK)\n\nMARA\nStill here.\n";
    expect(findInventedCharacters(candidate, ["MARA"])).toEqual([]);
  });

  it("sees @-forced mixed-case cues on both sides", () => {
    const script = "INT. ROOM - DAY\n\n@McClane\nYippee ki-yay.\n";
    expect(collectAllowedCast({ script })).toContain("MCCLANE");
    // invented @Ruth is caught
    const candidate = script + "\n@Ruth\nWelcome to my shop.\n";
    expect(findInventedCharacters(candidate, ["MCCLANE"])).toEqual(["RUTH"]);
  });
});
