import { correctFountainFormatting } from "./fountainFormatCorrector";
import { normalizeShotLines } from "./fountainShotNormalizer";

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

// A model that mis-escapes its output delivers the whole screenplay as a couple
// of giant lines full of LITERAL "\n" sequences. Downstream, that renders as one
// left-justified action blob (and can even be uppercased as a "scene heading").
// When literal escapes clearly outnumber real newlines, unescape them.
export function unescapeLiteralNewlines(script: string): string {
  const literal = (script.match(/\\n/g) ?? []).length;
  const real = script.split("\n").length;
  if (literal >= 4 && literal > real * 2) {
    return script
      .replace(/\\r\\n/g, "\n")
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "  ")
      .replace(/\\"/g, '"');
  }
  return script;
}

/**
 * Final cleanup for freshly generated screenplay text: fix the parenthetical
 * artifacts above, then run the full deterministic formatting-correction pass
 * (cues/dialogue/shots/transitions). This is the "auto-run Formatting Correction
 * after generation" step so generated drafts land clean without a manual pass.
 */
export function cleanupGeneratedScreenplay(script: string, extraNames: string[] = []): string {
  return correctFountainFormatting(repairParentheticals(unescapeLiteralNewlines(script)), extraNames);
}

/**
 * Lightweight repair for IMPORTED scripts: fix the parenthetical artifacts above
 * and re-prefix bare camera-shot lines (WS/MS/CU…) with "!!". Unlike
 * cleanupGeneratedScreenplay it does NOT run the full reclassification pass, so a
 * clean hand-written .fountain is left untouched (both steps are no-ops when there
 * is nothing to fix). This stops imported shots/stage-directions — e.g. a leading
 * "." line like ".from inside the apartment" — from rendering as scene headings.
 */
export function repairImportedScreenplay(script: string): string {
  return normalizeShotLines(repairParentheticals(script));
}
