import { extractCharacters } from "./scriptStructure";

// Deterministic, rule-based formatting pass (no LLM). The writer model can get
// the STORY right while emitting sloppy Fountain — shots as bare caps, character
// cues separated from their dialogue by a blank line (so they render as action),
// stray all-caps lines, transitions written as plain text. This pass classifies
// every line by simple context rules and re-emits clean Fountain so each element
// lands in the correct slot:
//   INT./EXT./EST.                 -> scene heading
//   WS/MS/CU/ECU/LS/OTS/POV        -> camera shot (!! prefix)
//   "… TO:" / FADE OUT / etc.      -> transition
//   equals a known character name  -> character cue; its following line(s) = dialogue
//                                     (a stray blank between cue and dialogue is removed)
//   all-caps, none of the above    -> action (forced with ! so it isn't read as a cue)
//   anything else                  -> action
// Character names are gathered from the KB, from extractCharacters, AND from a
// recurrence heuristic (an all-caps name that appears 2+ times each followed by
// dialogue) — so cues are found even when their formatting is broken.

const SCENE_HEADING = /^(INT\.|EXT\.|INT\.?\/EXT\.?|I\/E\.?|EST\.)/i;
const SHOT_TOKEN = /^(WS|MS|CU|ECU|LS|OTS|POV)\b/;
const TRANSITION_TO = /^[A-Z][A-Z0-9 '\-]*TO:$/; // CUT TO:, DISSOLVE TO:, MATCH CUT TO:
const TRANSITION_PHRASE = /^(FADE IN:?|FADE OUT\.?|FADE TO BLACK\.?|SMASH CUT\.?|MATCH CUT\.?|END OF SCENE\.?|THE END\.?|CUT TO BLACK\.?|BLACKOUT\.?|DISSOLVE\.?)$/;
const TITLE_KEY = /^(Title|Credit|Author|Authors|Source|Draft date|Date|Contact|Copyright|Notes|Revision)\s*:/i;
const FORCED_OR_SPECIAL = /^[.@!~>=#]/; // forced scene/char/action/shot, lyrics, transition/center, synopsis, section
const NAME_LIKE = /^[A-Z][A-Z0-9 .'\-]{0,30}(\s*\([^)]*\))?$/; // all-caps name + optional (V.O.)/(CONT'D)

// All-caps lines that look name-shaped but are really action/time/shot cues.
const NON_NAME_CAPS = new Set([
  "SUDDENLY", "MEANWHILE", "LATER", "CONTINUOUS", "MOMENTS LATER", "INTERCUT", "BEAT",
  "SILENCE", "DARKNESS", "BLACK", "SUPER", "TITLE", "ANGLE ON", "CLOSE ON", "BACK TO",
  "THE END", "INSERT", "MONTAGE", "FLASHBACK",
]);

function isAllCaps(t: string): boolean {
  return /[A-Z]/.test(t) && t === t.toUpperCase();
}
function cueNameOf(t: string): string {
  return t.replace(/\s*\([^)]*\)\s*$/, "").trim().toUpperCase();
}
function isTransition(t: string): boolean {
  return TRANSITION_TO.test(t) || TRANSITION_PHRASE.test(t);
}
function isStructuralStart(t: string, names: Set<string>): boolean {
  return (
    SCENE_HEADING.test(t) ||
    t.startsWith("!!") ||
    (SHOT_TOKEN.test(t) && isAllCaps(t)) ||
    isTransition(t) ||
    FORCED_OR_SPECIAL.test(t) ||
    names.has(cueNameOf(t))
  );
}
function looksLikeName(t: string): boolean {
  if (!isAllCaps(t) || !NAME_LIKE.test(t)) return false;
  const core = cueNameOf(t);
  if (!core || core.length > 30) return false;
  if (SCENE_HEADING.test(core) || SHOT_TOKEN.test(core) || isTransition(t) || NON_NAME_CAPS.has(core)) return false;
  return core.split(/\s+/).length <= 4;
}
// A line that could plausibly be dialogue (so we can decide a preceding caps
// line is a cue, and know where a dialogue block ends).
function dialogueLike(t: string): boolean {
  return t !== "" && !isAllCaps(t) && !SCENE_HEADING.test(t) && !FORCED_OR_SPECIAL.test(t) && !isTransition(t);
}

export function correctFountainFormatting(script: string, extraNames: string[] = []): string {
  const lines = script.split("\n");

  // --- Build the character-name set from every available signal. ---
  const names = new Set<string>();
  for (const character of extractCharacters(script)) names.add(character.name.toUpperCase());
  for (const name of extraNames) {
    const clean = name.trim().toUpperCase();
    if (clean) names.add(clean);
  }
  // Recurrence: a name-like line that shows up 2+ times, each followed (after an
  // optional stray blank) by dialogue, is a character — even if every cue is
  // mis-spaced and extractCharacters missed them all.
  const followedByDialogue = new Map<string, number>();
  for (let k = 0; k < lines.length; k++) {
    const t = lines[k].trim();
    if (!looksLikeName(t)) continue;
    let j = k + 1;
    if (j < lines.length && lines[j].trim() === "") j++;
    if (j < lines.length && dialogueLike(lines[j].trim())) {
      const key = cueNameOf(t);
      followedByDialogue.set(key, (followedByDialogue.get(key) ?? 0) + 1);
    }
  }
  for (const [key, count] of followedByDialogue) if (count >= 2) names.add(key);
  // extractCharacters (and a stray KB entry) can mis-flag stock all-caps
  // directions as characters — drop them so they aren't treated as cues.
  for (const bad of NON_NAME_CAPS) names.delete(bad);

  // --- Re-emit line by line. ---
  const out: string[] = [];
  const ensureBlankBefore = () => {
    if (out.length && out[out.length - 1] !== "") out.push("");
  };

  let i = 0;
  let inTitlePage = true;
  while (i < lines.length) {
    const raw = lines[i];
    const t = raw.trim();

    if (t === "") {
      if (out.length && out[out.length - 1] !== "") out.push("");
      i++;
      continue;
    }

    if (inTitlePage && TITLE_KEY.test(t)) { out.push(raw); i++; continue; }
    if (inTitlePage) inTitlePage = false;

    // Already-forced / special lines: keep as written.
    if (FORCED_OR_SPECIAL.test(t)) { ensureBlankBefore(); out.push(t); i++; continue; }

    if (SCENE_HEADING.test(t)) { ensureBlankBefore(); out.push(t.toUpperCase()); out.push(""); i++; continue; }

    if (SHOT_TOKEN.test(t) && isAllCaps(t)) { ensureBlankBefore(); out.push(`!!${t}`); i++; continue; }

    if (TRANSITION_TO.test(t)) { ensureBlankBefore(); out.push(t.toUpperCase()); out.push(""); i++; continue; }
    if (TRANSITION_PHRASE.test(t)) { ensureBlankBefore(); out.push(`> ${t.toUpperCase()}`); out.push(""); i++; continue; }

    // Character cue + its dialogue (pulling the dialogue up under the cue).
    if (names.has(cueNameOf(t))) {
      ensureBlankBefore();
      out.push(t.toUpperCase());
      i++;
      // Drop a single stray blank the writer put between the cue and dialogue.
      if (i + 1 < lines.length && lines[i].trim() === "" && dialogueLike(lines[i + 1].trim())) i++;
      // Attach the dialogue block — runs until a blank, an all-caps line (a new
      // shot/cue/action), or another element.
      while (i < lines.length) {
        const dt = lines[i].trim();
        if (dt === "" || isAllCaps(dt) || isStructuralStart(dt, names)) break;
        out.push(dt);
        i++;
      }
      out.push("");
      continue;
    }

    // Action. Force all-caps action with "!" so Fountain doesn't read it as a cue.
    ensureBlankBefore();
    out.push(isAllCaps(t) ? `!${t}` : t);
    i++;
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "").replace(/[\s\n]+$/, "") + "\n";
}
