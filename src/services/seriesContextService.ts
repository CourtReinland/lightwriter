import {
  activeArcsForEpisode,
  cliffhangerEndingEpisode,
  cliffhangerOpeningEpisode,
  type SeriesArc,
  type SeriesCliffhanger,
} from "./worldStateService";

// Turns a series' arcs + cliffhangers + episode position into a compact prompt
// block that the AI writing tools inject, so the writer knows WHERE it is in the
// series and which through-lines are live. Pure + budget-bounded (no storage).

export interface EpisodeContextInput {
  seriesName: string;
  /** 0-based episode index within the series. */
  episodeIndex: number;
  totalEpisodes: number;
  /** ALL arcs in the series (filtered to the active ones here). */
  arcs: SeriesArc[];
  cliffhangers: SeriesCliffhanger[];
}

const ARC_DESC_MAX = 240;

function spanLabel(a: SeriesArc): string {
  return a.startEpisode === a.endEpisode ? `ep ${a.startEpisode + 1}` : `eps ${a.startEpisode + 1}-${a.endEpisode + 1}`;
}

/**
 * Serialize the series context for an episode, or "" when there's nothing useful
 * to say (no arcs, no cliffhangers, single/unknown episode). Callers inject the
 * returned block into their prompts after style/KB and before the brief/script.
 */
export function serializeEpisodeContext(input: EpisodeContextInput | null): string {
  if (!input || input.episodeIndex < 0) return "";
  const { seriesName, episodeIndex, totalEpisodes, arcs, cliffhangers } = input;
  const active = activeArcsForEpisode(arcs, episodeIndex);
  const ending = cliffhangerEndingEpisode(cliffhangers, episodeIndex);
  const opening = cliffhangerOpeningEpisode(cliffhangers, episodeIndex);

  if (active.length === 0 && !ending && !opening && totalEpisodes <= 1) return "";

  const ep = episodeIndex + 1;
  const lines: string[] = ["=== SERIES CONTEXT ==="];
  lines.push(
    `This is EPISODE ${ep}${totalEpisodes ? ` of ${totalEpisodes}` : ""}${seriesName ? ` of "${seriesName}"` : ""}. Characters, relationships, and the world carry over from earlier episodes — do not reset or re-introduce them.`,
  );

  if (opening) {
    lines.push(`OPEN this episode by paying off the previous episode's cliffhanger: ${opening.description}`);
  }

  if (active.length) {
    lines.push("ACTIVE ARCS — weave these through this episode (advance them; do not resolve an arc before the episode it ends on):");
    for (const a of active) {
      const tag = a.kind === "character" ? `character${a.characterName ? ` — ${a.characterName}` : ""}` : "plot";
      const culminates = a.endEpisode === episodeIndex ? " [CULMINATES this episode — pay it off]" : "";
      lines.push(`- (${tag}, ${spanLabel(a)}) ${a.name}: ${a.description.slice(0, ARC_DESC_MAX)}${culminates}`);
    }
  }

  if (ending) {
    lines.push(`END this episode on a cliffhanger that launches the next episode: ${ending.description}`);
  }

  return lines.join("\n");
}
