import { describe, it, expect, beforeEach } from "vitest";
import {
  extractLocationToken,
  locationMatchesToken,
  matchLocations,
  parseAliases,
  findSceneAtLine,
  isSceneHeading,
  activeArcsForEpisode,
  cliffhangerEndingEpisode,
  cliffhangerOpeningEpisode,
  WorldStateService,
  type WorldLocation,
  type SeriesArc,
} from "./worldStateService";

function arc(name: string, kind: "plot" | "character", start: number, end: number): SeriesArc {
  return { id: name, seriesId: "s", kind, name, description: "", startEpisode: start, endEpisode: end, createdAt: 0, updatedAt: 0 };
}

function installLocalStorage() {
  const store = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
}

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

describe("arc / cliffhanger query helpers", () => {
  const arcs = [arc("Anger", "character", 0, 3), arc("Gone Ones", "plot", 1, 5), arc("Finale", "plot", 4, 5)];

  it("returns only arcs live in the given episode, plot-first", () => {
    expect(activeArcsForEpisode(arcs, 0).map((a) => a.name)).toEqual(["Anger"]);
    expect(activeArcsForEpisode(arcs, 2).map((a) => a.name)).toEqual(["Gone Ones", "Anger"]); // plot before character
    expect(activeArcsForEpisode(arcs, 5).map((a) => a.name)).toEqual(["Finale", "Gone Ones"]);
  });

  it("finds the cliffhanger ending / opening an episode", () => {
    const cliffs = [
      { id: "c1", seriesId: "s", fromEpisode: 0, toEpisode: 1, description: "x", createdAt: 0, updatedAt: 0 },
      { id: "c2", seriesId: "s", fromEpisode: 2, toEpisode: 3, description: "y", createdAt: 0, updatedAt: 0 },
    ];
    expect(cliffhangerEndingEpisode(cliffs, 0)?.id).toBe("c1");
    expect(cliffhangerEndingEpisode(cliffs, 1)).toBeNull();
    expect(cliffhangerOpeningEpisode(cliffs, 1)?.id).toBe("c1");
    expect(cliffhangerOpeningEpisode(cliffs, 3)?.id).toBe("c2");
    expect(cliffhangerOpeningEpisode(cliffs, 0)).toBeNull();
  });
});

describe("series episode order + arc/cliffhanger CRUD", () => {
  beforeEach(() => installLocalStorage());

  it("orders episodes and reports indices", () => {
    const s = WorldStateService.createSeries("My Series");
    expect(s.episodeOrder).toEqual([]);
    WorldStateService.addEpisode(s.id, "projA");
    WorldStateService.addEpisode(s.id, "projB");
    expect(WorldStateService.addEpisode(s.id, "projA")).toBe(0); // idempotent
    expect(WorldStateService.episodeCount(s.id)).toBe(2);
    expect(WorldStateService.episodeIndexOf(s.id, "projB")).toBe(1);
    WorldStateService.removeEpisode(s.id, "projA");
    expect(WorldStateService.episodeIndexOf(s.id, "projB")).toBe(0);
  });

  it("CRUDs arcs scoped to a series, sorted by start episode", () => {
    const s = WorldStateService.createSeries("S");
    WorldStateService.addArc(s.id, { name: "Late", startEpisode: 3, endEpisode: 5 });
    const early = WorldStateService.addArc(s.id, { name: "Early", kind: "character", characterName: "Aiden", startEpisode: 0, endEpisode: 2 });
    expect(WorldStateService.listArcs(s.id).map((a) => a.name)).toEqual(["Early", "Late"]);
    WorldStateService.updateArc(early.id, { endEpisode: 4 });
    expect(WorldStateService.getArc(early.id)?.endEpisode).toBe(4);
    WorldStateService.deleteArc(early.id);
    expect(WorldStateService.listArcs(s.id).map((a) => a.name)).toEqual(["Late"]);
  });

  it("upserts one cliffhanger per fromEpisode and can remove it", () => {
    const s = WorldStateService.createSeries("S");
    WorldStateService.upsertCliffhanger(s.id, 0, "first hook");
    WorldStateService.upsertCliffhanger(s.id, 0, "revised hook"); // replaces, not duplicates
    const list = WorldStateService.listCliffhangers(s.id);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ fromEpisode: 0, toEpisode: 1, description: "revised hook" });
    WorldStateService.removeCliffhanger(s.id, 0);
    expect(WorldStateService.listCliffhangers(s.id)).toHaveLength(0);
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
