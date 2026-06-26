import { correctFountainFormatting } from "./fountainFormatCorrector";

const CUE = /^[A-Z][A-Z0-9 .'\-]{0,30}(\s*\([^)]*\))?$/;

// Two safe, targeted repairs for parenthetical artifacts the writer model emits,
// which the general formatting corrector doesn't catch:
//   "/agreeing)"                 -> "(agreeing)"   (mistyped open paren)
//   ".from inside the apartment" -> "(from inside the apartment)"
//     (a leading-dot lowercase stage direction sitting under a character cue —
//      Fountain would otherwise read the leading "." as a forced scene heading)
// Real forced scene headings are uppercase (".SOMEWHERE"), so requiring a
// lowercase first letter keeps those untouched.
function repairParentheticals(script: string): string {
  const lines = script.split("\n");
  return lines
    .map((line, i) => {
      const t = line.trim();
      const indent = line.slice(0, line.length - line.trimStart().length);
      if (/^\/[^/)]*\)$/.test(t)) {
        return indent + "(" + t.slice(1);
      }
      if (/^\.[a-z][^\n]*$/.test(t) && !t.endsWith(")")) {
        const prev = (lines[i - 1] || "").trim();
        const prevIsCue = prev.length > 0 && prev === prev.toUpperCase() && CUE.test(prev);
        if (prevIsCue) return indent + "(" + t.slice(1) + ")";
      }
      return line;
    })
    .join("\n");
}

/**
 * Final cleanup for freshly generated screenplay text: fix the parenthetical
 * artifacts above, then run the full deterministic formatting-correction pass
 * (cues/dialogue/shots/transitions). This is the "auto-run Formatting Correction
 * after generation" step so generated drafts land clean without a manual pass.
 */
export function cleanupGeneratedScreenplay(script: string, extraNames: string[] = []): string {
  return correctFountainFormatting(repairParentheticals(script), extraNames);
}
