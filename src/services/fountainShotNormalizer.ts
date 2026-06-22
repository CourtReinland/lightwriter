// Deterministic repair for the Fountain shot/character ambiguity. A camera line
// written as bare ALL-CAPS (e.g. "WS LIVING ROOM") is parsed as a CHARACTER cue,
// which turns the action line under it into DIALOGUE. Any ALL-CAPS line that
// opens with a recognized shot token but lacks the "!!" prefix is a misformatted
// shot — we restore "!!" so it renders in the shot slot, not the character slot.
// This is a backstop that runs on AI rewrite/expansion output (in case a model
// forgets the convention) and can also repair an already-corrupted draft.

const SHOT_TOKEN = /^(WS|MS|CU|ECU|LS|OTS|POV)\b/;
const SCENE_HEADING = /^(INT\.|EXT\.|INT\/EXT\.|I\/E\.|EST\.)/i;

function isMisformattedShot(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("!")) return false; // blank, or already forced (!!shot / !action)
  if (SCENE_HEADING.test(trimmed)) return false; // slugline
  if (/\bTO:$/.test(trimmed)) return false; // transition, e.g. CUT TO:
  // Must open with a shot token AND be fully uppercase (real shots are caps;
  // this avoids touching ordinary action prose that merely starts with "Ms").
  return SHOT_TOKEN.test(trimmed) && trimmed === trimmed.toUpperCase();
}

export function normalizeShotLines(script: string): string {
  return script
    .split("\n")
    .map((line) => (isMisformattedShot(line) ? `!!${line.trim()}` : line))
    .join("\n");
}

export function countMisformattedShots(script: string): number {
  return script.split("\n").filter(isMisformattedShot).length;
}
