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
const TRANSITION_TO = /^[A-Z][A-Z0-9 '\-]*TO:$/; // CUT TO:, DISSOLVE TO:, MATCH CUT TO: (Fountain auto-detects)
const TRANSITION_TO_BLACK = /^[A-Z][A-Z0-9 '\-]* TO BLACK[:.]?$/; // FADE/CUT/DISSOLVE TO BLACK (no colon needed)
const TRANSITION_PHRASE = /^(FADE IN|FADE OUT|FADE TO BLACK|CUT TO BLACK|SMASH CUT|MATCH CUT|DISSOLVE|END OF SCENE|END OF ACT|THE END|BLACKOUT|INTERCUT(?: WITH)?)[:.]?$/;
const TITLE_KEY = /^(Title|Credit|Author|Authors|Source|Draft date|Date|Contact|Copyright|Notes|Revision)\s*:/i;
const FORCED_OR_SPECIAL = /^[.@!~>=#]/; // forced scene/char/action/shot, lyrics, transition/center, synopsis, section
const NAME_LIKE = /^[A-Z][A-Z0-9 .'\-]{0,30}(\s*\([^)]*\))?$/; // all-caps name + optional (V.O.)/(CONT'D)

// Present-tense stage-direction verbs: "<Name> <verb> …" directly under dialogue
// is a mis-spaced ACTION line, not more dialogue. Spoken sentences use different
// verbs/tenses ("Mara told me", "Mara is wrong"), so the lexicon stays narrow.
const ACTION_VERBS = new Set([
  "crosses", "walks", "turns", "enters", "exits", "looks", "stares", "grabs", "moves",
  "pulls", "pushes", "steps", "runs", "leans", "sits", "stands", "reaches", "watches",
  "paces", "nods", "shakes", "opens", "closes", "picks", "sets", "slams", "storms",
  "spins", "lowers", "raises", "lifts", "drops", "checks", "glances", "smiles", "frowns",
  "follows", "stops", "freezes", "crouches", "kneels", "backs", "edges", "presses",
  "throws", "snatches", "wipes", "pours", "lights", "hesitates", "pauses", "stumbles",
  "staggers", "collapses", "rises", "climbs", "ducks", "charges", "bolts", "whirls",
  "points", "gestures", "shrugs", "sighs", "exhales", "swallows", "blinks", "winces",
  "flinches", "recoils", "stiffens", "crumples", "straightens", "hurries", "strides",
]);

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
  return TRANSITION_TO.test(t) || TRANSITION_TO_BLACK.test(t) || TRANSITION_PHRASE.test(t);
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
  const words = core.split(/\s+/);
  if (words.length > 4) return false;
  // A multi-word phrase ending in a gerund is SFX/action ("PHONE RINGING",
  // "DOOR SLAMMING"), never a character name.
  if (words.length >= 2 && /ING$/.test(words[words.length - 1])) return false;
  return true;
}
// A line that could plausibly be dialogue (so we can decide a preceding caps
// line is a cue, and know where a dialogue block ends).
function dialogueLike(t: string): boolean {
  return t !== "" && !isAllCaps(t) && !SCENE_HEADING.test(t) && !FORCED_OR_SPECIAL.test(t) && !isTransition(t);
}

// "NAME: dialogue" on one line — a chat-style habit the rewrite models fall into.
// Fountain has no such form, so the whole line classifies as action and the
// dialogue renders left-justified. Split it into a proper cue + dialogue line.
const COLON_CUE = /^([A-Za-z][A-Za-z0-9 .'\-]{0,30}?)(\s*\([^)]*\))?\s*:\s+(\S.*)$/;

/** Strip a dual-dialogue caret ("JONAS ^" -> "JONAS") for name matching. */
function stripDualCaret(s: string): string {
  return s.replace(/\s*\^$/, "");
}

function splitColonCues(lines: string[], names: Set<string>): string[] {
  const out: string[] = [];
  // Track whether we're inside a dialogue block: a dialogue line that happens to
  // START with a known name + colon ("JONAS" cue, then "Mara: that's her name,
  // her curse.") is Jonas SPEAKING — splitting it would re-attribute the line.
  let inDialogue = false;
  for (const line of lines) {
    const t = line.trim();
    if (t === "") {
      inDialogue = false;
      out.push(line);
      continue;
    }
    const isCueLine = t.startsWith("@") || names.has(cueNameOf(stripDualCaret(t)));
    if (!inDialogue && isCueLine) {
      inDialogue = true;
      out.push(line);
      continue;
    }
    const m = !inDialogue ? t.match(COLON_CUE) : null;
    if (m) {
      const upper = m[1].trim().toUpperCase();
      // Only split on KNOWN character names (KB / script cues) — never on prose
      // like "NOTE: the door is locked" — and never on transitions ("CUT TO:").
      if (names.has(upper) && !isTransition(t) && !SCENE_HEADING.test(t) && !TITLE_KEY.test(t)) {
        out.push(upper + (m[2] ? " " + m[2].trim() : ""));
        out.push(m[3]);
        inDialogue = true;
        continue;
      }
    }
    out.push(line);
  }
  return out;
}

export function correctFountainFormatting(script: string, extraNames: string[] = []): string {
  // --- Build the character-name set from every available signal. ---
  const names = new Set<string>();
  for (const character of extractCharacters(script)) names.add(character.name.toUpperCase());
  for (const name of extraNames) {
    const clean = name.trim().toUpperCase();
    if (clean) names.add(clean);
  }

  // Split "NAME: dialogue" lines FIRST so the recurrence heuristic below sees
  // proper cue/dialogue pairs.
  const lines = splitColonCues(script.split("\n"), names);
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
  // extractCharacters (and stray KB entries) can mis-flag stock directions,
  // transitions, and SFX as characters — drop anything that isn't name-shaped so
  // it isn't treated as a cue (and absorb the following line as dialogue).
  for (const n of [...names]) {
    const words = n.split(/\s+/);
    const gerundPhrase = words.length >= 2 && /ING$/.test(words[words.length - 1]);
    if (NON_NAME_CAPS.has(n) || isTransition(n) || gerundPhrase) names.delete(n);
  }

  // --- Re-emit line by line. ---
  const out: string[] = [];
  const ensureBlankBefore = () => {
    if (out.length && out[out.length - 1] !== "") out.push("");
  };
  const isParenthetical = (s: string) => /^\(.*\)$/.test(s);

  let i = 0;
  let inTitlePage = true;
  let sawTitleKey = false;

  // A line that reads as ACTION about a cast member ("Mara crosses to the
  // window.") — a capitalized known name followed by a STAGE-DIRECTION VERB.
  // Models often jam these directly under dialogue with no blank line; without
  // this check the whole run absorbs into the dialogue block and renders
  // centered. The verb lexicon keeps spoken lines that merely mention a name
  // ("Mara told me everything.") inside the dialogue block.
  const looksLikeActionAboutCast = (s: string): boolean => {
    const words = s.split(/\s+/);
    if (words.length < 3) return false;
    const first = words[0].replace(/[^A-Za-z'-]/g, "");
    if (!first || !names.has(first.toUpperCase())) return false;
    if (first === first.toUpperCase()) return false; // ALL-CAPS name = could be a shout
    return ACTION_VERBS.has(words[1].toLowerCase().replace(/[^a-z]/g, ""));
  };

  // Attach a cue's dialogue block (parentheticals + lines) starting at lines[i].
  const attachDialogue = () => {
    // Drop a single stray blank between the cue and its first wryly/dialogue.
    if (i + 1 < lines.length && lines[i].trim() === "" && (dialogueLike(lines[i + 1].trim()) || isParenthetical(lines[i + 1].trim()))) i++;
    // Attach until a blank or a STRUCTURAL element (a new cue/scene/shot/transition).
    // ALL-CAPS lines that are not structural stay attached — shouted dialogue
    // ("GET OUT!") must not be detached from its cue and forced to action.
    let attached = 0;
    let longAttached = 0;
    while (i < lines.length) {
      const dt = lines[i].trim();
      if (dt === "") break;
      if (isParenthetical(dt)) {
        out.push(dt);
        i++;
        if (i + 1 < lines.length && lines[i].trim() === "" && dialogueLike(lines[i + 1].trim())) i++;
        continue;
      }
      if (isStructuralStart(stripDualCaret(dt), names)) break;
      // After the first spoken paragraph, an action-looking line about a cast
      // member ends the block; and no dialogue runs 4+ unbroken LONG paragraphs
      // (short lines are verse/monologue phrasing and stay attached) — both are
      // mis-spaced action, which must not render centered.
      if (attached >= 1 && looksLikeActionAboutCast(dt)) break;
      if (longAttached >= 4) break;
      out.push(dt);
      i++;
      attached++;
      if (dt.length > 45) longAttached++;
    }
    out.push("");
  };

  while (i < lines.length) {
    const raw = lines[i];
    const t = raw.trim();

    if (t === "") {
      if (sawTitleKey) inTitlePage = false; // Fountain: the title page ends at the first blank line
      if (out.length && out[out.length - 1] !== "") out.push("");
      i++;
      continue;
    }

    if (inTitlePage && TITLE_KEY.test(t)) { out.push(raw); sawTitleKey = true; i++; continue; }
    // Indented continuation of a multi-line title value ("Title:" + "\t_**BRICK**_").
    if (inTitlePage && sawTitleKey && /^[ \t]/.test(raw)) { out.push(raw); i++; continue; }
    if (inTitlePage) inTitlePage = false;

    // Forced mixed-case character cue ("@McClane") — keep it AND its dialogue paired
    // (the generic forced-line branch below would let a blank slip between them).
    if (t.startsWith("@")) {
      ensureBlankBefore();
      out.push(t);
      i++;
      attachDialogue();
      continue;
    }

    // Already-forced / special lines: keep as written.
    if (FORCED_OR_SPECIAL.test(t)) { ensureBlankBefore(); out.push(t); i++; continue; }

    if (SCENE_HEADING.test(t)) { ensureBlankBefore(); out.push(t.toUpperCase()); out.push(""); i++; continue; }

    if (SHOT_TOKEN.test(t) && isAllCaps(t)) { ensureBlankBefore(); out.push(`!!${t}`); i++; continue; }

    // "… TO:" auto-detects as a transition; the rest are forced with ">".
    if (TRANSITION_TO.test(t)) { ensureBlankBefore(); out.push(t.toUpperCase()); out.push(""); i++; continue; }
    if (isTransition(t)) { ensureBlankBefore(); out.push(`> ${t.toUpperCase()}`); out.push(""); i++; continue; }

    // Character cue + its dialogue (pulling the dialogue up under the cue).
    // A dual-dialogue cue ("JONAS ^") matches on the bare name and keeps its caret.
    if (names.has(cueNameOf(stripDualCaret(t)))) {
      ensureBlankBefore();
      out.push(t.toUpperCase());
      i++;
      attachDialogue();
      continue;
    }

    // Action. Force all-caps action with "!" so Fountain doesn't read it as a cue.
    ensureBlankBefore();
    out.push(isAllCaps(t) ? `!${t}` : t);
    i++;
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").replace(/^\n+/, "").replace(/[\s\n]+$/, "");
}
