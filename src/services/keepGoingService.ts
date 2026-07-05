// "Keep going": iterate a delivered take against its OWN fresh report card
// until it hits the target score, stalls, or runs out of rounds. The design
// the calibration experiment validated: the metric is honest (a purpose-built
// script scored 82), so the way up is rewrite → re-score → keep the better
// draft — never deliver worse than the best seen.
//
// Differences from runStoryDoctor (the older framework loop):
//   - scoring is scoped to the target framework and uses 2 samples per round
//     (the room's economics), not 5 unscoped samples;
//   - engines ROTATE between rounds — a stall on one model gets a different
//     model's swing next round;
//   - the author-voice layer rides along: the compiled pack is appended to
//     every rewrite prompt, and measured voice deviations become notes;
//   - every run leaves a room-log entry (kind: "keep-going").

import { TextAiService } from "./textAiService";
import { textAiProviderLabel, type TextAiProvider } from "./textAiSettingsService";
import { ALL_FRAMEWORKS, estimatePages, type FrameworkDefinition } from "../frameworks";
import type { KnowledgeBase } from "./knowledgeBase";
import type { StyleProfile } from "./styleProfile";
import {
  buildMetricRewritePrompt,
  expandToTargetIfNeeded,
  metricScoreFromCard,
  parseRewriteResponse,
  persistReportCard,
  runScriptReportCard,
  type ScriptReportCard,
  type ScriptReportPromptInput,
} from "./scriptReportCardService";
import { saveRoomLog } from "./writersRoomService";
import { compareToVoicePrint, deviationsToNotes, type VoicePrint } from "./voiceMetricsService";

export const KEEP_GOING_TARGET = 80;
export const KEEP_GOING_MAX_ROUNDS = 3;
const SCORING_SAMPLES = 2;
const REWRITE_TIMEOUT_MS = 300_000;
/** A rewrite that loses more than this share of the draft is a truncation, not a revision. */
const MIN_LENGTH_RATIO = 0.6;

export interface KeepGoingInput {
  /** The take to iterate (usually the pending rewrite candidate, not the editor doc). */
  script: string;
  metricId: string;
  metricName: string;
  targetScore?: number;
  maxRounds?: number;
  targetPages: number;
  knowledgeBase: KnowledgeBase | null;
  styleProfile: StyleProfile | null;
  seriesContext?: string;
  allowedCast?: string[];
  /** Keyed engines, in rotation order (round k uses engines[k % n]). */
  engines: TextAiProvider[];
  /** When set: the final report card is persisted (Accept cache-hits) and the run is logged. */
  projectId?: string;
  /** Compiled AUTHOR VOICE PACK block — appended to every rewrite prompt. */
  voicePack?: string;
  /** Measured print — deviations become revision notes; final voice score reported. */
  voicePrint?: VoicePrint | null;
  /** Scoring scope when metricId is a CRAFT metric (style/character/pacing):
   *  the project's active frameworks — never the unscoped all-framework prompt. */
  craftScopeFrameworks?: FrameworkDefinition[];
  /** Stop after the current step (rewrite/scoring finishes, then the loop
   *  returns the best draft so far). In-flight API calls are not interrupted. */
  signal?: AbortSignal;
}

export interface KeepGoingProgress {
  round: number;
  maxRounds: number;
  label: string;
  bestScore: number | null;
}

export interface KeepGoingResult {
  finalScript: string;
  startScore: number;
  finalScore: number;
  /** Score after the initial measure and each subsequent re-score, in order. */
  trajectory: number[];
  /** Rewrite rounds actually attempted. */
  rounds: number;
  enginesUsed: string[];
  voiceScore: number | null;
  reachedTarget: boolean;
  /** True when the run ended on the user's Stop (best-so-far still returned). */
  stopped: boolean;
  /** False when no round beat the take's starting score (finalScript === input.script). */
  improved: boolean;
  finalReport: ScriptReportCard;
  changeSummary: string[];
  warnings: string[];
}

export interface KeepGoingDeps {
  /** Test seam: run completions without network. */
  complete?: (provider: TextAiProvider, system: string, user: string, options?: { temperature?: number; maxTokens?: number; timeoutMs?: number }) => Promise<string>;
  /** Test seam: scoring. */
  scoreScript?: (script: string) => Promise<ScriptReportCard>;
}

/**
 * Scoring scope for a keep-going run: a framework metric scopes to itself; a
 * craft metric (style/character/pacing) scopes to the project's active
 * frameworks; only when neither exists does scoring go unscoped.
 */
export function scoreFrameworksFor(metricId: string, craftScope?: FrameworkDefinition[]): FrameworkDefinition[] | undefined {
  const framework = ALL_FRAMEWORKS.find((f) => f.id === metricId);
  if (framework) return [framework];
  return craftScope?.length ? craftScope : undefined;
}

export async function runKeepGoing(
  input: KeepGoingInput,
  onProgress?: (p: KeepGoingProgress) => void,
  deps: KeepGoingDeps = {},
): Promise<KeepGoingResult> {
  if (!input.engines.length) throw new Error("Keep going needs at least one engine with an API key.");
  const target = input.targetScore ?? KEEP_GOING_TARGET;
  const maxRounds = Math.max(1, input.maxRounds ?? KEEP_GOING_MAX_ROUNDS);
  const framework = ALL_FRAMEWORKS.find((f) => f.id === input.metricId);

  const complete = deps.complete
    ?? ((provider: TextAiProvider, system: string, user: string, options?: { temperature?: number; maxTokens?: number; timeoutMs?: number }) =>
      TextAiService.forProvider(provider).complete(system, user, options));

  const scoreInput = (script: string): ScriptReportPromptInput => ({
    script,
    knowledgeBase: input.knowledgeBase,
    styleProfile: input.styleProfile,
    targetPages: input.targetPages,
    seriesContext: input.seriesContext,
    frameworks: scoreFrameworksFor(input.metricId, input.craftScopeFrameworks),
    allowedCast: input.allowedCast,
  });
  const score = deps.scoreScript ?? ((script: string) => runScriptReportCard(scoreInput(script), { samples: SCORING_SAMPLES }));

  const warnings: string[] = [];
  const changeSummary: string[] = [];
  const enginesUsed: string[] = [];
  const tick = (round: number, label: string, bestScore: number | null) =>
    onProgress?.({ round, maxRounds, label, bestScore });

  // Measure the take as delivered — this is the number to beat.
  tick(0, `measuring the take (${input.metricName})`, null);
  let bestReport: ScriptReportCard;
  try {
    bestReport = await score(input.script);
  } catch (e) {
    throw new Error(`Keep going couldn't score the take (${e instanceof Error ? e.message : "scoring failed"}). Check the analyst engine's key and try again.`);
  }
  let bestScript = input.script;
  let bestScore = metricScoreFromCard(bestReport, input.metricId);
  const startScore = bestScore;
  const trajectory: number[] = [startScore];

  let noImprove = 0;
  let rounds = 0;
  let stopped = false;
  const usedProviderIds: string[] = [];
  for (let round = 1; round <= maxRounds; round += 1) {
    if (bestScore >= target) break;
    if (input.signal?.aborted) {
      stopped = true;
      break;
    }
    const engine = input.engines[(round - 1) % input.engines.length];
    rounds += 1;
    enginesUsed.push(textAiProviderLabel(engine));
    usedProviderIds.push(engine);
    tick(round, `round ${round}/${maxRounds}: ${textAiProviderLabel(engine)} rewrites vs the ${bestScore}-scoring card`, bestScore);

    try {
      const prompt = buildMetricRewritePrompt({
        ...scoreInput(bestScript),
        reportCard: bestReport,
        metricId: input.metricId,
        metricName: input.metricName,
      });
      // The voice layer rides on the outside of the prompt builder: the pack
      // plus this draft's measured deviations, phrased as revision notes.
      let user = prompt.user;
      if (input.voicePack?.trim()) user += `\n\n${input.voicePack.trim()}`;
      if (input.voicePrint) {
        const voice = compareToVoicePrint(bestScript, input.voicePrint);
        if (!voice.lowConfidence && voice.deviations.length) {
          user += `\n\nVOICE NOTES (measured against the author's print — fix while rewriting):\n${deviationsToNotes(voice).map((n, i) => `${i + 1}. ${n}`).join("\n")}`;
        }
      }

      const raw = await complete(engine, prompt.system, user, {
        temperature: prompt.temperature,
        maxTokens: prompt.maxTokens,
        timeoutMs: REWRITE_TIMEOUT_MS,
      });
      const candidate = parseRewriteResponse(raw, input.allowedCast ?? []).rewrittenScript;
      if (candidate.trim().length < bestScript.length * MIN_LENGTH_RATIO) {
        throw new Error(`rewrite came back ${Math.round((candidate.length / bestScript.length) * 100)}% of the draft's length — treated as truncated`);
      }
      if (input.signal?.aborted) {
        stopped = true;
        break; // don't pay for scoring a pass the user already walked away from
      }

      tick(round, `round ${round}/${maxRounds}: re-scoring ${textAiProviderLabel(engine)}'s pass`, bestScore);
      const report = await score(candidate);
      const s = metricScoreFromCard(report, input.metricId);
      trajectory.push(s);
      const prevBest = bestScore; // the score this round actually had to beat

      if (s > bestScore) {
        bestScript = candidate;
        bestScore = s;
        bestReport = report;
        noImprove = 0;
        changeSummary.push(`Round ${round} (${textAiProviderLabel(engine)}): ${prevBest} → ${s}.`);
      } else if (s === bestScore) {
        // A tie adopts the newer draft (usually tighter) but still counts
        // toward the stall — running in place is not progress.
        bestScript = candidate;
        bestReport = report;
        noImprove += 1;
        changeSummary.push(`Round ${round} (${textAiProviderLabel(engine)}): held at ${s}; kept the newer draft.`);
      } else {
        noImprove += 1;
        warnings.push(`Round ${round} (${textAiProviderLabel(engine)}) scored ${s} — below the ${bestScore} best; discarded.`);
      }
    } catch (e) {
      noImprove += 1;
      warnings.push(`Round ${round} (${textAiProviderLabel(engine)}) failed: ${e instanceof Error ? e.message.slice(0, 160) : "error"}.`);
    }
    if (noImprove >= 2) {
      warnings.push(`Stalled after ${rounds} round${rounds === 1 ? "" : "s"} — two passes without a better score.`);
      break;
    }
  }

  // Page-target expansion (the calibration lesson: short drafts bleed
  // placement points no matter how good the structure is) — but never-worse:
  // an expansion that scores below the best is reverted.
  if (!stopped && !input.signal?.aborted && bestScore < target && input.targetPages > 0) {
    const pagesNow = estimatePages(bestScript.split("\n").length);
    if (pagesNow < Math.floor(input.targetPages * 0.9)) {
      tick(maxRounds, `expanding ${pagesNow}pp toward the ${input.targetPages}pp target`, bestScore);
      try {
        const engine = input.engines[rounds % input.engines.length];
        const expanded = await expandToTargetIfNeeded(
          { rewrittenScript: bestScript, changeSummary: [], warnings: [] },
          {
            targetPages: input.targetPages,
            frameworkId: input.metricId,
            reportCard: bestReport,
            knowledgeBase: input.knowledgeBase,
            styleProfile: input.styleProfile,
            seriesContext: input.seriesContext,
            allowedCast: input.allowedCast,
          },
          undefined,
          (system, user, options) => complete(engine, system, user, options),
        );
        warnings.push(...expanded.warnings);
        if (expanded.rewrittenScript.trim().length > bestScript.length) {
          const report = await score(expanded.rewrittenScript);
          const s = metricScoreFromCard(report, input.metricId);
          trajectory.push(s);
          if (s >= bestScore) {
            changeSummary.push(`Expansion: ${pagesNow}pp → ~${estimatePages(expanded.rewrittenScript.split("\n").length)}pp, score ${bestScore} → ${s}.`);
            bestScript = expanded.rewrittenScript;
            bestScore = s;
            bestReport = report;
          } else {
            warnings.push(`Expansion scored ${s} (below the ${bestScore} best); reverted.`);
          }
        }
      } catch (e) {
        warnings.push(`Expansion failed (${e instanceof Error ? e.message.slice(0, 120) : "error"}).`);
      }
    }
  }

  const voiceScore = input.voicePrint ? compareToVoicePrint(bestScript, input.voicePrint).score : null;
  const improved = bestScript !== input.script;
  const reachedTarget = bestScore >= target;
  if (stopped) {
    warnings.push(`Stopped by you after ${rounds} round${rounds === 1 ? "" : "s"} — kept the best draft so far (${bestScore}/100).`);
  }
  if (reachedTarget) changeSummary.push(`Hit the target: ${startScore} → ${bestScore} (target ${target}).`);
  else if (improved) changeSummary.push(`Best after ${rounds} round${rounds === 1 ? "" : "s"}: ${startScore} → ${bestScore} (target ${target}).`);

  // Persist the winning card so Accept → "Run Script Report Card" cache-hits
  // (same economics as the Writers' Room's persist).
  if (input.projectId && improved && !deps.scoreScript) {
    try {
      persistReportCard(input.projectId, scoreInput(bestScript), bestReport);
    } catch { /* best-effort */ }
  }
  if (input.projectId) {
    saveRoomLog(input.projectId, {
      kind: "keep-going",
      at: new Date().toISOString(),
      frameworkId: input.metricId,
      // Raw provider ids, matching what room entries store in this field.
      engines: usedProviderIds,
      startScore,
      finalScore: bestScore,
      targetPages: input.targetPages,
      finalPages: estimatePages(bestScript.split("\n").length),
      voiceScore,
      // The trajectory lists every re-score INCLUDING discarded rounds, so it
      // can end on a number the loop rejected — always state what was kept.
      changeSummary: [`Trajectory: ${trajectory.join(" → ")} · delivered ${bestScore} (target ${target}).`, ...changeSummary],
      warnings,
    });
  }

  return {
    finalScript: bestScript,
    startScore,
    finalScore: bestScore,
    trajectory,
    rounds,
    enginesUsed,
    voiceScore,
    reachedTarget,
    stopped,
    improved,
    finalReport: bestReport,
    changeSummary,
    warnings,
  };
}
