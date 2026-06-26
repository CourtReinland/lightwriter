import { describe, it, expect } from "vitest";
import {
  extractLocationToken,
  locationMatchesToken,
  matchLocations,
  parseAliases,
  findSceneAtLine,
  isSceneHeading,
  type WorldLocation,
} from "./worldStateService";

function loc(name: string, aliases: string[]): WorldLocation {
  return {
    id: "x",
    seriesId: "s",
    name,
    aliases,
    category: "interior",
    description: "",
    stsLocationKey: "k",
    createdAt: 0,
    updatedAt: 0,
  };
}

describe("extractLocationToken", () => {
  it("strips INT./EXT. and time of day", () => {
    expect(extractLocationToken("INT. KITCHEN - DAY")).toBe("KITCHEN");
    expect(extractLocationToken("EXT. ROOFTOP GARDEN - NIGHT")).toBe("ROOFTOP GARDEN");
  });
  it("keeps interior qualifiers, drops only the trailing time", () => {
    expect(extractLocationToken("EXT. MADDOX HOUSE - BACKYARD - NIGHT")).toBe("MADDOX HOUSE - BACKYARD");
  });
  it("handles forced (dot) scene headings", () => {
    expect(extractLocationToken(".A SECRET ROOM")).toBe("A SECRET ROOM");
  });
  it("returns empty for non-headings", () => {
    expect(extractLocationToken("Max walks in.")).toBe("");
    expect(extractLocationToken("MAX")).toBe("");
  });
});

describe("locationMatchesToken / matchLocations", () => {
  const kitchen = loc("Maddox Family Kitchen", ["KITCHEN", "FAMILY KITCHEN"]);
  const rooftop = loc("Rooftop Garden", ["ROOFTOP", "ROOF"]);

  it("matches an alias token", () => {
    expect(locationMatchesToken(kitchen, "KITCHEN")).toBe(true);
    expect(locationMatchesToken(kitchen, "ROOFTOP")).toBe(false);
  });

  it("matches a substring of the name", () => {
    expect(locationMatchesToken(kitchen, "MADDOX FAMILY KITCHEN")).toBe(true);
  });

  it("ranks exact alias before looser matches and excludes non-matches", () => {
    const ranked = matchLocations([rooftop, kitchen], "KITCHEN");
    expect(ranked.map((l) => l.name)).toEqual(["Maddox Family Kitchen"]);
  });

  it("returns nothing for an unknown token", () => {
    expect(matchLocations([kitchen, rooftop], "SUBMARINE")).toEqual([]);
  });
});

describe("parseAliases", () => {
  it("splits, uppercases, trims, and dedupes", () => {
    expect(parseAliases("kitchen, Family Kitchen; kitchen\nGALLEY")).toEqual(["KITCHEN", "FAMILY KITCHEN", "GALLEY"]);
  });
});

describe("isSceneHeading", () => {
  it("recognizes INT./EXT./forced headings, rejects action", () => {
    expect(isSceneHeading("INT. KITCHEN - DAY")).toBe(true);
    expect(isSceneHeading("EXT. ROOFTOP - NIGHT")).toBe(true);
    expect(isSceneHeading(".A SECRET ROOM")).toBe(true);
    expect(isSceneHeading("Max walks in.")).toBe(false);
    expect(isSceneHeading(".irritated")).toBe(false); // lowercase forced = not a heading
  });
});

describe("findSceneAtLine", () => {
  const script = [
    "Title: T", // 1
    "", // 2
    "INT. KITCHEN - DAY", // 3  (scene 0)
    "", // 4
    "Action here.", // 5
    "", // 6
    "EXT. ROOFTOP - NIGHT", // 7 (scene 1)
    "", // 8
    "More action.", // 9
  ].join("\n");

  it("returns the scene whose body the cursor sits in (0-based index)", () => {
    expect(findSceneAtLine(script, 5)).toMatchObject({ index: 0, token: "KITCHEN", headingLine: 3 });
    expect(findSceneAtLine(script, 9)).toMatchObject({ index: 1, token: "ROOFTOP", headingLine: 7 });
  });

  it("returns the heading scene when the cursor is on the heading line itself", () => {
    expect(findSceneAtLine(script, 7)).toMatchObject({ index: 1, token: "ROOFTOP" });
  });

  it("returns null before the first heading", () => {
    expect(findSceneAtLine(script, 1)).toBeNull();
  });
});
