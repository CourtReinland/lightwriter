import { extractCharacters } from "./scriptStructure";

// Deterministic, rule-based formatting pass (no LLM). The writer model may get
// the STORY right while emitting sloppy Fountain — shots as bare caps, character
// cues without the structure that marks them as cues, action mashed against
// dialogue. This pass reclassifies every line by simple context rules and
// re-emits clean Fountain so each element lands in the correct slot:
//   - starts with INT./EXT./EST.        -> scene heading
//   - starts with WS/MS/CU/ECU/LS/OTS/POV -> camera shot (!! prefix)
//   - ends with "TO:"                    -> transition
//   - equals a known character name      -> character cue (its following lines = dialogue)
//   - all-caps, none of the above        -> action (forced with ! so it isn't read as a cue)
//   - anything else                      -> action
// It preserves the title page and already-forced lines, and normalizes the
// blank-line structure Fountain relies on.

const SCENE_HEADING = /^(INT\.|EXT\.|INT\.?\/EXT\.?|I\/E\.?|EST\.)/i;
const SHOT_TOKEN = /^(WS|MS|CU|ECU|LS|OTS|POV)\b/;
const TRANSITION = /^[A-Z][A-Z0-9 ]*TO:$/;
const TITLE_KEY = /^(Title|Credit|Author|Authors|Source|Draft date|Date|Contact|Copyright|Notes|Revision)\s*:/i;
const FORCED_OR_SPECIAL = /^[.@!~>=#]/; // forced scene/char/action, lyrics, transition/center, synopsis, section

function isAllCaps(text: string): boolean {
  return /[A-Z]/.test(text) && text === text.toUpperCase();
}

export function correctFountainFormatting(script: string, extraNames: string[] = []): string {
  const names = new Set<string>();
  for (const character of extractCharacters(script)) names.add(character.name.toUpperCase());
  for (const name of extraNames) {
    const clean = name.trim().toUpperCase();
    if (clean) names.add(clean);
  }

  const cueNameOf = (text: string) => text.replace(/\s*\(.*\)\s*$/, "").trim().toUpperCase();
  const isStructural = (text: string) =>
    SCENE_HEADING.test(text) ||
    text.startsWith("!!") ||
    (SHOT_TOKEN.test(text) && isAllCaps(text)) ||
    TRANSITION.test(text) ||
    FORCED_OR_SPECIAL.test(text) ||
    names.has(cueNameOf(text));

  const lines = script.split("\n");
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

    // Keep the title page block verbatim until the first real content line.
    if (inTitlePage && TITLE_KEY.test(t)) { out.push(raw); i++; continue; }
    if (inTitlePage) inTitlePage = false;

    // Already-forced / special lines: keep as written.
    if (FORCED_OR_SPECIAL.test(t)) {
      ensureBlankBefore();
      out.push(t);
      i++;
      continue;
    }

    // Scene heading.
    if (SCENE_HEADING.test(t)) {
      ensureBlankBefore();
      out.push(t.toUpperCase());
      out.push("");
      i++;
      continue;
    }

    // Camera shot.
    if (SHOT_TOKEN.test(t) && isAllCaps(t)) {
      ensureBlankBefore();
      out.push(`!!${t}`);
      i++;
      continue;
    }

    // Transition.
    if (TRANSITION.test(t)) {
      ensureBlankBefore();
      out.push(t.toUpperCase());
      out.push("");
      i++;
      continue;
    }

    // Character cue (matches a known name) + the dialogue block under it.
    if (names.has(cueNameOf(t))) {
      ensureBlankBefore();
      out.push(t.toUpperCase());
      i++;
      while (i < lines.length) {
        const dt = lines[i].trim();
        // Dialogue runs until a blank line, an all-caps line, or another element.
        if (dt === "" || isAllCaps(dt) || isStructural(dt)) break;
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
