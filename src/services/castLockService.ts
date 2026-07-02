import { extractCharacters } from "./scriptStructure";
import { WorldStateService } from "./worldStateService";
import type { KnowledgeBase } from "./knowledgeBase";

// Cast lock: the rewrite engines may only use characters that already exist in
// the script, the KB, or the series world state (characters + character arcs).
// Two halves:
//   1. castLockBlock()          -> a hard-rule prompt section for every rewrite/
//                                  expansion/re-roll prompt.
//   2. findInventedCharacters() -> deterministic post-check on a candidate, so a
//                                  model that ignores the rule gets flagged (and
//                                  demoted) instead of silently smuggling in a
//                                  new character.

// Caps runs that extractCharacters can mis-report but are never characters.
const NAME_STOP = new Set([
  "SUDDENLY", "MEANWHILE", "LATER", "CONTINUOUS", "MOMENTS LATER", "INTERCUT", "BEAT",
  "SILENCE", "DARKNESS", "BLACK", "SUPER", "TITLE", "ANGLE ON", "CLOSE ON", "BACK TO",
  "THE END", "INSERT", "MONTAGE", "FLASHBACK", "V.O", "V.O.", "O.S", "O.S.", "CONT'D",
]);

// Titles/honorifics/descriptors: sharing ONLY one of these with an allowed name is
// not identity ("DETECTIVE MIKE ROSS" is still invented when only "DETECTIVE SARAH
// CHEN" exists). Overlap must be on a specific word (a real name part).
const GENERIC_WORDS = new Set([
  "DETECTIVE", "OFFICER", "AGENT", "DR", "MR", "MRS", "MS", "MISS", "SGT", "SERGEANT",
  "CAPTAIN", "CAPT", "LT", "LIEUTENANT", "GENERAL", "COLONEL", "MAJOR", "PROFESSOR", "PROF",
  "UNCLE", "AUNT", "GRANDMA", "GRANDPA", "MOM", "DAD", "MOTHER", "FATHER", "SISTER", "BROTHER",
  "OLD", "YOUNG", "LITTLE", "BIG", "THE", "A", "AN", "OF",
  "MAN", "WOMAN", "BOY", "GIRL", "KID", "LADY", "GUY", "VOICE",
  "GUARD", "NURSE", "DOCTOR", "COP", "SOLDIER", "WAITER", "WAITRESS", "BARTENDER",
  "DRIVER", "CLERK", "TEACHER", "PRIEST", "KING", "QUEEN", "PRINCE", "PRINCESS",
]);

const stripWord = (w: string) => w.replace(/\./g, "");

/** Is this caps string plausibly a character name (not a slugline/SFX/marker)? */
export function plausibleCharacterName(raw: string): boolean {
  const n = raw.trim().toUpperCase();
  if (!n || n.length > 30) return false;
  if (/^(INT\.|EXT\.|EST\.|I\/E|INT\/EXT)/.test(n)) return false; // scene headings
  if (n.includes(" - ")) return false; // slugline "LOCATION - TIME"
  if (NAME_STOP.has(n)) return false;
  if (/ TO:?$/.test(n) || /^(FADE|CUT|DISSOLVE|SMASH|MATCH)\b/.test(n)) return false; // transitions
  const words = n.split(/\s+/);
  if (words.length > 4) return false;
  if (words.length >= 2 && /ING$/.test(words[words.length - 1])) return false; // "PHONE RINGING" SFX
  return true;
}

/** Fountain's @-forced cues ("@McClane") — mixed case, invisible to extractCharacters. */
function forcedCueNames(script: string): string[] {
  const out: string[] = [];
  for (const line of script.split("\n")) {
    const m = line.trim().match(/^@(.+?)(\s*\([^)]*\))?\s*\^?\s*$/);
    if (m && m[1].trim()) out.push(m[1].trim().toUpperCase());
  }
  return out;
}

/** Every character cue in a script: proper caps cues + @-forced mixed-case cues. */
function cueNamesOf(script: string): string[] {
  return [
    ...extractCharacters(script).map((c) => c.name.toUpperCase()),
    ...forcedCueNames(script),
  ];
}

/** Union of every character name the story already knows about, uppercased. */
export function collectAllowedCast(opts: {
  script: string;
  knowledgeBase?: KnowledgeBase | null;
  seriesId?: string | null;
}): string[] {
  const names = new Set<string>();
  const add = (raw?: string | null) => {
    const clean = (raw ?? "").trim().toUpperCase();
    if (clean && plausibleCharacterName(clean)) names.add(clean);
  };
  for (const name of cueNamesOf(opts.script)) add(name);
  for (const c of opts.knowledgeBase?.characters ?? []) add(c.name);
  if (opts.seriesId) {
    for (const wc of WorldStateService.listCharacters(opts.seriesId)) add(wc.name);
    for (const arc of WorldStateService.listArcs(opts.seriesId)) add(arc.characterName);
  }
  return [...names].sort();
}

/** Prompt block enforcing the cast lock. Empty string when there is no cast yet. */
export function castLockBlock(allowed: string[] | undefined): string {
  if (!allowed?.length) return "";
  return `\n=== CAST LOCK (HARD RULE) ===
The complete cast of this story: ${allowed.join(", ")}.
Do NOT invent, add, or name ANY character that is not in this list — no new named characters, no new speaking characters, no "we need a shopkeeper so I'll call her RUTH". If a scene needs an incidental presence (a waiter, a guard, a voice on the phone), keep them unnamed and non-speaking, or give the moment to an existing cast member instead. Every character cue in your output MUST be one of the listed names.`;
}

/**
 * Character cues in `script` that are NOT covered by the allowed cast.
 * Tolerant matching: a cue counts as allowed when it equals an allowed name OR
 * shares a SPECIFIC word with one (so "SARAH" passes when "DETECTIVE SARAH CHEN"
 * is allowed) — generic titles/descriptors ("DETECTIVE", "OLD", "MAN") don't
 * count as overlap, so "DETECTIVE MIKE ROSS" is still flagged.
 */
export function findInventedCharacters(script: string, allowed: string[]): string[] {
  if (!allowed.length) return [];
  const allowedFull = new Set(allowed.map((n) => n.toUpperCase()));
  const allowedSpecificWords = new Set(
    allowed
      .flatMap((n) => n.toUpperCase().split(/\s+/))
      .filter((w) => !GENERIC_WORDS.has(stripWord(w))),
  );
  const invented = new Set<string>();
  for (const name of cueNamesOf(script)) {
    if (!plausibleCharacterName(name)) continue; // slugline/SFX junk, not a character
    if (allowedFull.has(name)) continue;
    if (name.split(/\s+/).some((w) => !GENERIC_WORDS.has(stripWord(w)) && allowedSpecificWords.has(w))) continue;
    invented.add(name);
  }
  return [...invented].sort();
}
