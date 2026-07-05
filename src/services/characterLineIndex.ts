// "You said that": a deterministic index of every line each character has
// actually spoken across the voice corpus. This is the evidence base for the
// Green Room (character agents ground their voice in their real lines) and for
// per-character dialogue guidance in the Writers' Room.

import { extractChannels } from "./voiceMetricsService";
import type { VoiceCorpusScript } from "./voiceCorpusStore";
import { WorldStateService } from "./worldStateService";

export interface CharacterLine {
  text: string;
  /** Episode/script title the line comes from. */
  episode: string;
  scriptId: string;
  sceneIndex: number;
  /** Cue as written when it differs from the base name (e.g. "AIDEN THOUGHTS"). */
  cueVariant?: string;
}

export interface CharacterLineEntry {
  /** Canonical name (WorldCharacter name when an alias matches, else the cue). */
  name: string;
  lines: CharacterLine[];
  episodes: string[];
  totalWords: number;
  meanWordsPerLine: number;
}

export type CharacterLineIndex = Record<string, CharacterLineEntry>;

/**
 * Alias → canonical-name map. Pure input so the index is unit-testable;
 * build it from the series' WorldCharacters with buildSeriesAliasMap().
 */
export type AliasMap = Map<string, string>;

export function buildSeriesAliasMap(seriesId: string): AliasMap {
  const map: AliasMap = new Map();
  for (const character of WorldStateService.listCharacters(seriesId)) {
    const canonical = character.name.trim();
    map.set(canonical.toUpperCase(), canonical);
    for (const alias of character.aliases || []) {
      if (alias.trim()) map.set(alias.trim().toUpperCase(), canonical);
    }
  }
  return map;
}

export function buildCharacterLineIndex(scripts: VoiceCorpusScript[], aliases: AliasMap = new Map()): CharacterLineIndex {
  const index: CharacterLineIndex = {};

  for (const script of scripts) {
    const channels = extractChannels(script.text);
    for (const cue of channels.dialogue) {
      const canonical = aliases.get(cue.baseCharacter) || cue.baseCharacter;
      const key = canonical.toUpperCase();
      if (!index[key]) {
        index[key] = { name: canonical, lines: [], episodes: [], totalWords: 0, meanWordsPerLine: 0 };
      }
      const entry = index[key];
      entry.lines.push({
        text: cue.text,
        episode: script.title,
        scriptId: script.id,
        sceneIndex: cue.sceneIndex,
        ...(cue.character !== cue.baseCharacter ? { cueVariant: cue.character } : {}),
      });
      if (!entry.episodes.includes(script.title)) entry.episodes.push(script.title);
      entry.totalWords += cue.text.split(/\s+/).filter(Boolean).length;
    }
  }

  for (const entry of Object.values(index)) {
    entry.meanWordsPerLine = entry.lines.length ? Math.round((entry.totalWords / entry.lines.length) * 10) / 10 : 0;
  }
  return index;
}

/**
 * A deterministic sample of a character's most characteristic lines:
 * their longest speech per episode plus their shortest snap replies —
 * the two ends of the rhythm carry more identity than the middle.
 */
export function sampleCharacterLines(entry: CharacterLineEntry, max = 14): CharacterLine[] {
  const byEpisode = new Map<string, CharacterLine[]>();
  for (const line of entry.lines) {
    if (!byEpisode.has(line.episode)) byEpisode.set(line.episode, []);
    byEpisode.get(line.episode)!.push(line);
  }

  const picks: CharacterLine[] = [];
  const seen = new Set<string>();
  const push = (line: CharacterLine) => {
    const key = `${line.episode}|${line.text}`;
    if (!seen.has(key)) {
      seen.add(key);
      picks.push(line);
    }
  };

  for (const lines of byEpisode.values()) {
    const sorted = [...lines].sort((a, b) => b.text.length - a.text.length);
    if (sorted[0]) push(sorted[0]);
    const shortest = sorted[sorted.length - 1];
    if (shortest && shortest.text.split(/\s+/).length <= 5) push(shortest);
  }

  return picks.slice(0, max);
}

/** Compact "this is how NAME actually talks" block for prompts. */
export function characterVoiceBlock(entry: CharacterLineEntry, max = 10): string {
  const samples = sampleCharacterLines(entry, max);
  const lines = [
    `${entry.name} — ${entry.lines.length} lines across ${entry.episodes.length} episode${entry.episodes.length === 1 ? "" : "s"}, avg ${entry.meanWordsPerLine} words per line. Real lines they have said:`,
    ...samples.map((s) => `- "${s.text}" (${s.episode}${s.cueVariant ? `, as ${s.cueVariant}` : ""})`),
  ];
  return lines.join("\n");
}
