import { describe, it, expect } from "vitest";
import { serializeEpisodeContext } from "./seriesContextService";
import type { SeriesArc, SeriesCliffhanger } from "./worldStateService";

function arc(name: string, kind: "plot" | "character", start: number, end: number, description = "desc"): SeriesArc {
  return { id: name, seriesId: "s", kind, name, description, startEpisode: start, endEpisode: end, createdAt: 0, updatedAt: 0 };
}
function cliff(from: number, description: string): SeriesCliffhanger {
  return { id: `c${from}`, seriesId: "s", fromEpisode: from, toEpisode: from + 1, description, createdAt: 0, updatedAt: 0 };
}

describe("serializeEpisodeContext", () => {
  it("returns empty when there's nothing to say", () => {
    expect(serializeEpisodeContext(null)).toBe("");
    expect(serializeEpisodeContext({ seriesName: "S", episodeIndex: 0, totalEpisodes: 1, arcs: [], cliffhangers: [] })).toBe("");
    // unknown episode position (not yet ordered) -> empty
    expect(serializeEpisodeContext({ seriesName: "S", episodeIndex: -1, totalEpisodes: 5, arcs: [arc("A", "plot", 0, 5)], cliffhangers: [] })).toBe("");
  });

  it("states the episode position and includes only active arcs", () => {
    const arcs = [
      arc("The Gone Ones", "plot", 0, 5, "trying to prevent humanity from seeing the delusion"),
      arc("Aiden's anger", "character", 0, 2, "struggles to control his anger"),
      arc("Finale push", "plot", 4, 5, "the last stand"),
    ];
    const out = serializeEpisodeContext({ seriesName: "Maddox", episodeIndex: 1, totalEpisodes: 6, arcs, cliffhangers: [] });
    expect(out).toContain("EPISODE 2 of 6");
    expect(out).toContain('of "Maddox"');
    expect(out).toContain("The Gone Ones");
    expect(out).toContain("Aiden's anger");
    expect(out).toContain("Aiden"); // character name surfaced
    expect(out).not.toContain("Finale push"); // not active in ep 2 (eps 5-6)
  });

  it("flags the opening payoff, culmination, and the ending cliffhanger", () => {
    const arcs = [arc("Aiden's anger", "character", 0, 2, "anger arc")];
    const cliffs = [cliff(1, "Aiden snaps at Drake"), cliff(2, "the rift opens")];
    const out = serializeEpisodeContext({ seriesName: "Maddox", episodeIndex: 2, totalEpisodes: 6, arcs, cliffhangers: cliffs });
    expect(out).toContain("OPEN this episode by paying off the previous episode's cliffhanger: Aiden snaps at Drake");
    expect(out).toContain("CULMINATES this episode"); // anger arc ends at ep index 2
    expect(out).toContain("END this episode on a cliffhanger that launches the next episode: the rift opens");
  });
});
