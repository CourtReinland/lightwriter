import { TextAiService, type TextCompleteOptions } from "./textAiService";
import { ALL_FRAMEWORKS, computeBeatRanges } from "../frameworks";
import { KnowledgeBaseService, type KnowledgeBase } from "./knowledgeBase";
import { StyleProfileService, type StyleProfile } from "./styleProfile";
import { runScriptReportCard, parseRewriteResponse, type ScriptReportCard, type ScriptRewriteResult } from "./scriptReportCardService";

// "Story Doctor": a closed-loop, SUBTRACTIVE rewrite. Instead of one shot (or
// blind additive padding, which duplicates scenes), it restructures the draft
// toward a framework — adding, CUTTING, merging, and reordering — then RE-SCORES
// itself and feeds the gaps back into another pass, keeping the best draft. This
// runs before the user sees the result.

const MAX_ITERATIONS = 4;
const TARGET_SCORE = 80;
const REWRITE_TIMEOUT_MS = 240_000;
const REWRITE_MAX_TOKENS = 16000;

type Completion = (system: string, user: string, options?: TextCompleteOptions) => Promise<string>;
type Scorer = (script: string) => Promise<ScriptReportCard>;

export interface StoryDoctorProgress {
  completed: number;
  total: number;
  label: string;
}

export interface StoryDoctorInput {
  script: string;
  metricId: string;
  metricName: string;
  targetPages: number;
  reportCard: ScriptReportCard;
  knowledgeBase: KnowledgeBase | null;
  styleProfile: StyleProfile | null;
}

export interface StoryDoctorResult extends ScriptRewriteResult {
  startScore: number;
  finalScore: number;
  trajectory: number[];
  finalReport: ScriptReportCard;
  iterations: number;
}

export function isFrameworkMetric(metricId: string): boolean {
  return ALL_FRAMEWORKS.some((f) => f.id === metricId);
}

function frameworkScoreOf(report: ScriptReportCard, metricId: string): number {
  return report.frameworkScores.find((f) => f.frameworkId === metricId)?.score ?? 0;
}

function beatBlueprintFor(metricId: string, targetPages: number, totalLines: number): string {
  const fw = ALL_FRAMEWORKS.find((f) => f.id === metricId);
  if (!fw) return "";
  return computeBeatRanges(fw, targetPages, totalLines)
    .map((b) => `- ${b.name} (pages ${b.startPage}-${b.endPage}): ${b.description}`)
    .join("\n");
}

export function fixBriefFor(report: ScriptReportCard, metricId: string): string {
  const fw = report.frameworkScores.find((f) => f.frameworkId === metricId);
  const lines: string[] = [];
  if (fw) {
    lines.push(`Current ${fw.frameworkName} score: ${fw.score}/100. ${fw.summary}`);
    const weak = fw.beatScores.filter((b) => b.missing || b.score < 60);
    if (weak.length) {
      lines.push("Beats to fix:");
      for (const b of weak) {
        lines.push(`  - ${b.beatName}${b.expectedPageRange ? ` (pages ${b.expectedPageRange})` : ""}: ${b.missing ? "MISSING — write it as a distinct scene" : `weak (${b.score}) — strengthen`}.${b.suggestions.length ? " " + b.suggestions.slice(0, 2).join("; ") : ""}`);
      }
    }
  }
  if (report.pacingScore?.summary) lines.push(`Pacing note: ${report.pacingScore.summary}`);
  if (report.topFixes?.length) {
    lines.push("Top fixes:");
    lines.push(...report.topFixes.slice(0, 5).map((f, i) => `  ${i + 1}. ${f}`));
  }
  return lines.join("\n");
}

function buildRestructurePrompt(args: {
  script: string;
  metricName: string;
  blueprint: string;
  fixBrief: string;
  targetPages: number;
  knowledgeBase: KnowledgeBase | null;
  styleProfile: StyleProfile | null;
}): { system: string; user: string } {
  const styleText = args.styleProfile ? StyleProfileService.serializeForPrompt(args.styleProfile) : "";
  const kbText = args.knowledgeBase ? KnowledgeBaseService.serializeForPrompt(args.knowledgeBase, 5000) : "";

  const system = `You are LightWriter's structural rewrite engine. You output a COMPLETE revised screenplay that restructures the draft to nail a target story framework. You MAY add, CUT, MERGE, and REORDER scenes — this is a real rewrite, not an append. Return ONLY valid JSON, no markdown.`;

  const user = `Revise this screenplay to maximize its ${args.metricName} structure and land at roughly ${args.targetPages} pages.

TARGET STRUCTURE — every beat present, IN ORDER, within its page range:
${args.blueprint}

WHAT TO FIX (from the latest analysis of this draft):
${args.fixBrief}

RULES:
- REMOVE duplicate or redundant scenes. Never dramatize the same beat or the same location-event twice — keep the single strongest version and cut the rest.
- Place each beat in its page range, IN ORDER. The final beat must land at the very END of the script.
- ADD any genuinely missing beat as a new, distinct scene; CUT or MERGE filler, repeats, and digressions.
- Net the length to about ${args.targetPages} pages by BALANCING cuts and additions — do not pad with repetition, and do not pad with restated material to hit the count.
- CRAFT (this is what earns a high score): each beat must turn on a clear character CHOICE with visible stakes, and connect causally to the beats before and after it (this happened, THEREFORE that — not "and then"). Escalate the consequences from You through Take. End on a Change beat that mirrors the opening You beat with a new emotional charge. Mere presence of a beat is not enough; it must do real dramatic work.
- Preserve the writer's voice, the existing characters, and all established plot facts. Do not invent unrelated characters or events.
- Return the COMPLETE revised screenplay (every scene in order), not notes or a diff.
${styleText ? `\nSTYLE CONTRACT:\n${styleText}\n` : ""}${kbText ? `\nSTORY KNOWLEDGE BASE:\n${kbText}\n` : ""}
CURRENT DRAFT:
---
${args.script}
---

Return ONLY this JSON:
{"rewrittenScript":"<the complete revised screenplay>","changeSummary":["what you cut, merged, reordered, or added"],"warnings":["risks, empty if none"]}`;

  return { system, user };
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function runStoryDoctor(
  input: StoryDoctorInput,
  onProgress?: (p: StoryDoctorProgress) => void,
  completeOverride?: Completion,
  scoreOverride?: Scorer,
): Promise<StoryDoctorResult> {
  const service = new TextAiService();
  const complete: Completion = completeOverride ?? service.complete.bind(service);
  const score: Scorer = scoreOverride ?? ((script) => runScriptReportCard({
    script,
    knowledgeBase: input.knowledgeBase,
    styleProfile: input.styleProfile,
    targetPages: input.targetPages,
  }));

  const startScore = frameworkScoreOf(input.reportCard, input.metricId);
  const trajectory: number[] = [startScore];
  const allChanges: string[] = [];
  const allWarnings: string[] = [];

  let bestScript = input.script;
  let bestReport = input.reportCard;
  let bestScore = startScore;
  let iterations = 0;
  let noImprove = 0;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    if (bestScore >= TARGET_SCORE) break;
    iterations = i + 1;

    onProgress?.({ completed: i * 2, total: MAX_ITERATIONS * 2, label: `Story Doctor pass ${i + 1}/${MAX_ITERATIONS}: restructuring (${input.metricName} at ${bestScore}/100)` });

    // Always restructure from the BEST draft so a single bad/truncated pass never
    // poisons the next one (each pass tries to improve the best, not the latest).
    const blueprint = beatBlueprintFor(input.metricId, input.targetPages, bestScript.split("\n").length);
    const { system, user } = buildRestructurePrompt({
      script: bestScript,
      metricName: input.metricName,
      blueprint,
      fixBrief: fixBriefFor(bestReport, input.metricId),
      targetPages: input.targetPages,
      knowledgeBase: input.knowledgeBase,
      styleProfile: input.styleProfile,
    });

    let rewrite: ScriptRewriteResult | null = null;
    try {
      const response = await complete(system, user, { temperature: 0.5, maxTokens: REWRITE_MAX_TOKENS, timeoutMs: REWRITE_TIMEOUT_MS });
      rewrite = parseRewriteResponse(response);
    } catch {
      allWarnings.push(`Pass ${i + 1}: rewrite failed or was truncated — retrying from best.`);
    }
    if (!rewrite || !rewrite.rewrittenScript.trim()) {
      if (++noImprove >= 2) break;
      continue;
    }
    const candidate = rewrite.rewrittenScript;

    onProgress?.({ completed: i * 2 + 1, total: MAX_ITERATIONS * 2, label: `Story Doctor pass ${i + 1}/${MAX_ITERATIONS}: re-scoring` });
    let report: ScriptReportCard;
    try {
      report = await score(candidate);
    } catch {
      allWarnings.push(`Pass ${i + 1}: re-score failed — retrying from best.`);
      if (++noImprove >= 2) break;
      continue;
    }
    const s = frameworkScoreOf(report, input.metricId);
    trajectory.push(s);

    if (s > bestScore) {
      // Real improvement — adopt it as the new best to build on.
      bestScore = s;
      bestScript = candidate;
      bestReport = report;
      allChanges.push(...rewrite.changeSummary);
      allWarnings.push(...rewrite.warnings);
      noImprove = 0;
    } else {
      // No gain. On an exact tie, prefer the later (deduped/tightened) draft; on a
      // regression or broken (low) pass, keep the prior best and retry.
      if (s === bestScore) {
        bestScript = candidate;
        bestReport = report;
        allChanges.push(...rewrite.changeSummary);
      }
      if (++noImprove >= 2) break;
    }
  }

  return {
    rewrittenScript: bestScript,
    changeSummary: Array.from(new Set([
      `Story Doctor: ${input.metricName} ${startScore} -> ${bestScore}/100 over ${iterations} pass(es) [${trajectory.join(" -> ")}]`,
      ...allChanges,
    ])),
    warnings: Array.from(new Set(allWarnings)),
    startScore,
    finalScore: bestScore,
    trajectory,
    finalReport: bestReport,
    iterations,
  };
}
