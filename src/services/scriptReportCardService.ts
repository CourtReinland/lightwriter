import { ALL_FRAMEWORKS, computeBeatRanges, estimatePages } from "../frameworks";
import type { FrameworkDefinition } from "../frameworks";
import { KnowledgeBaseService, type KnowledgeBase } from "./knowledgeBase";
import { StyleProfileService, type StyleProfile } from "./styleProfile";
import { TextAiService, type TextCompleteOptions } from "./textAiService";
import { expandScriptToTargetPages, type ExpandProgress } from "./scriptExpansionService";
import { normalizeShotLines } from "./fountainShotNormalizer";
import { cleanupGeneratedScreenplay } from "./generatedScriptCleanup";
import { castLockBlock } from "./castLockService";
import { simpleScriptHash } from "./scriptStructure";
import { getAnalystProviderSettings } from "./textAiSettingsService";
import { loadStoredReportCard, saveStoredReportCard } from "./reportCardStore";

type Completion = (system: string, user: string, options?: TextCompleteOptions) => Promise<string>;

export interface ReportBeatScore {
  beatName: string;
  expectedPageRange?: string;
  detectedEvidence: string;
  score: number;
  missing: boolean;
  suggestions: string[];
}

export interface FrameworkReportScore {
  frameworkId: string;
  frameworkName: string;
  score: number;
  summary: string;
  beatScores: ReportBeatScore[];
}

export interface StyleReportScore {
  score: number;
  matchedTraits: string[];
  drift: string[];
  suggestions: string[];
}

export interface SimpleReportScore {
  score: number;
  summary: string;
  suggestions: string[];
}

export interface ScriptReportCard {
  overallScore: number;
  frameworkScores: FrameworkReportScore[];
  styleScore: StyleReportScore;
  characterScore: SimpleReportScore;
  pacingScore: SimpleReportScore;
  topFixes: string[];
  recommendedNextAction: string;
}

export interface ScriptReportPromptInput {
  script: string;
  knowledgeBase: KnowledgeBase | null;
  styleProfile: StyleProfile | null;
  targetPages: number;
  /** Pre-serialized series/arc/cliffhanger context for this episode (see seriesContextService). */
  seriesContext?: string;
  /** Frameworks to score. Default = all. Scoping to the writer's active framework(s)
   *  keeps the payload small (so the last framework isn't truncated) and focuses the model. */
  frameworks?: FrameworkDefinition[];
  /** Cast lock: the only character names a rewrite may use (script + KB + series).
   *  See castLockService. When set, rewrite prompts forbid inventing characters. */
  allowedCast?: string[];
}

/** Normalize a beat name for cross-sample matching (case/punctuation-insensitive). */
function normBeatName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export interface ImproveMetricPromptInput extends ScriptReportPromptInput {
  reportCard: ScriptReportCard;
  metricId: string;
  metricName: string;
}

export interface FillGapsRewritePromptInput extends ScriptReportPromptInput {
  reportCard: ScriptReportCard;
  mode: "missing_beats" | "target_pages";
  /** Optional: focus the gap-fill on a single framework's beat ladder (e.g. "save-the-cat"). */
  targetFrameworkId?: string;
}

export interface ScriptRewriteResult {
  rewrittenScript: string;
  changeSummary: string[];
  warnings: string[];
  rawResponsePreview?: string;
  recoveredFrom?: string;
}

export interface RewriteValidationResult {
  canApply: boolean;
  issues: string[];
  sceneHeadingCount: number;
  hasDialogueCue: boolean;
  hasScreenplayAction: boolean;
}

export interface RewriteDiffSummary {
  beforeLines: number;
  afterLines: number;
  lineDelta: number;
  beforeCharacters: number;
  afterCharacters: number;
  characterDelta: number;
  beforeSceneHeadings: number;
  afterSceneHeadings: number;
  sceneHeadingDelta: number;
  changedLineCount: number;
}

export interface ReportMetricDelta {
  id: string;
  name: string;
  before: number;
  after: number;
  delta: number;
}

export interface ReportCardComparison {
  beforeOverall: number;
  afterOverall: number;
  overallDelta: number;
  metricDeltas: ReportMetricDelta[];
  topImprovement: ReportMetricDelta | null;
}

function clampScore(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((v) => String(v)).filter(Boolean) : [];
}

function frameworkBlueprint(framework: FrameworkDefinition, targetPages: number, totalLines: number): string {
  const computed = computeBeatRanges(framework, targetPages, totalLines);
  return [
    `${framework.name} (${framework.id})`,
    ...computed.map((beat) => `- ${beat.name} (pages ${beat.startPage}-${beat.endPage}): ${beat.description}`),
  ].join("\n");
}

/**
 * When a rewrite targets ONE specific framework (Hero's Journey, Save the Cat, etc.),
 * return that single framework's beat ladder so the model is told exactly which beats
 * to land at which pages — instead of blending all frameworks' beats at once.
 */
function selectedFrameworkBlueprint(metricId: string, targetPages: number, totalLines: number): string | null {
  const framework = ALL_FRAMEWORKS.find((item) => item.id === metricId);
  if (!framework) return null;
  return frameworkBlueprint(framework, targetPages, totalLines);
}

function targetStructureBlock(blueprint: string | null, frameworkName: string): string {
  if (!blueprint) return "";
  return `

TARGET STRUCTURE — refine the draft toward ${frameworkName}. Land each beat within its page range:
${blueprint}

Structural rules:
- Treat the beats above as the structural spine. Ensure every beat is present and falls within its page range.
- Strengthen or add the missing/weak beats; do NOT relocate or dilute beats that already work.
- Keep beats causally connected (this happened, therefore that) — no filler to hit a page count.
- Stay focused on ${frameworkName}; do not reshape the draft to satisfy other frameworks at the same time.`;
}

// When the draft is well under its target page count, instruct the model to make
// a real, quantified expansion (whole new scenes) rather than a light polish.
// LLMs default to brevity, so the page math has to be explicit and forceful.
function expansionDirective(script: string, targetPages: number): string {
  const currentPages = estimatePages(script.split("\n").length);
  if (!targetPages || targetPages <= currentPages + 1) return "";
  const addPages = targetPages - currentPages;
  const addLines = addPages * 56;
  return `

EXPANSION REQUIREMENT — THIS IS A MAJOR EXPANSION, NOT A POLISH:
- The current draft is about ${currentPages} page(s); the target is ${targetPages} page(s).
- You MUST grow the draft to roughly ${targetPages} pages by writing about ${addPages} more page(s) (~${addLines} lines) of NEW screenplay material.
- Add WHOLE NEW SCENES — sluglines, action, and dialogue — that dramatize the missing or under-developed beats and land within their page ranges. Do NOT just add a line or two to existing scenes.
- The returned rewrittenScript MUST be substantially longer than the input and must never be shorter. Returning something close to the original length is a failure of the task.
- Earn every page with causally connected story (this happened, therefore that). Expand boldly — do not hold back — but do not repeat or pad with filler.`;
}

export function buildScriptReportCardPrompt(input: ScriptReportPromptInput): { system: string; user: string; temperature: number; maxTokens: number } {
  const lines = input.script.split("\n").length;
  const estimatedPages = estimatePages(lines);
  const frameworks = input.frameworks?.length ? input.frameworks : ALL_FRAMEWORKS;
  const frameworkText = frameworks
    .map((framework) => frameworkBlueprint(framework, input.targetPages || estimatedPages, lines))
    .join("\n\n");
  const kbText = input.knowledgeBase ? KnowledgeBaseService.serializeForPrompt(input.knowledgeBase, 7000) : "No KB supplied.";
  const styleText = input.styleProfile
    ? StyleProfileService.serializeForPrompt(input.styleProfile, input.knowledgeBase?.toneStyle?.targetStyle)
    : "No writer style profile supplied.";

  const system = `You are LightWriter's senior screenplay story analyst and script doctor.
Return ONLY valid JSON. Do not wrap in markdown. Do not include commentary outside JSON.
Score strictly from 0-100. Use evidence from the script, KB, and style contract. If a beat is absent, mark missing true and score it low.
Be useful to a writer: concise, specific, and actionable.`;

  const user = `Run a whole-script report card.

Target pages: ${input.targetPages || estimatedPages}
Estimated current pages: ${estimatedPages}

Evaluate these frameworks and every beat listed below. For each framework, return EXACTLY the beats listed for it, by their exact names, in the listed order — score every one (set missing:true and a 0-39 score if the beat is absent). Do not add, rename, reorder, merge, or omit beats.
${frameworkText}

Evaluate additional craft metrics:
- STYLE MATCH against the STYLE CONTRACT / target-director style.
- CHARACTER CONSISTENCY against KB characters, arcs, voice, and relationships.
- PACING against target page length, scene density, escalation, and payoff timing.

BEAT SCORING RUBRIC (score each beat 0-100 on TWO axes — does it land in its page range, AND is it dramatized with craft):
- 90-100: present, within its page range, AND strongly dramatized — a clear character choice, escalating stakes, and a causal link to the beats before and after it. Reserve 90+ for beats that are both present AND genuinely strong.
- 78-89: present, in its page range, turning on a clear character choice and connected causally to its neighbors. This is COMPETENT, functional Story Circle execution — award this band freely for beats that genuinely work; do NOT under-score a competent, functional beat down into the 60s. Competent is good.
- 60-77: present but underdeveloped, rushed, vague, lacking a clear choice/stakes, or placed outside its page range.
- 40-59: only faint or partial evidence, or conflated with another beat.
- 0-39: missing or functionally absent (set missing: true).
ANTI-INFLATION: a beat that merely appears on the page without a clear dramatic choice, stakes, or causal connection to its neighbors is at most 77 — do NOT award 78+ for mere presence. Use the SAME two-axis judgment (present-in-range AND craft) for the style, character, and pacing scores.

Return this exact JSON shape:
{
  "overallScore": 0,
  "frameworkScores": [
    {
      "frameworkId": "save-the-cat",
      "frameworkName": "Save the Cat",
      "score": 0,
      "summary": "one sentence",
      "beatScores": [
        { "beatName": "Opening Image", "expectedPageRange": "pages 1-1", "detectedEvidence": "specific script evidence or empty", "score": 0, "missing": false, "suggestions": ["actionable fix"] }
      ]
    }
  ],
  "styleScore": { "score": 0, "matchedTraits": ["trait"], "drift": ["problem"], "suggestions": ["fix"] },
  "characterScore": { "score": 0, "summary": "one sentence", "suggestions": ["fix"] },
  "pacingScore": { "score": 0, "summary": "one sentence", "suggestions": ["fix"] },
  "topFixes": ["highest leverage fix"],
  "recommendedNextAction": "what the writer should improve first"
}

${kbText}

${styleText}

SCRIPT:
---
${input.script.slice(0, 120000)}
---`;

  return {
    system,
    user,
    // Score deterministically — rubric scoring must be stable run-to-run so the
    // rewrite loop can trust it (it previously swung ~26 points at temp 0.25).
    temperature: 0,
    // Five frameworks × ~8 beats (with evidence + suggestions) + craft is a large
    // JSON payload. A reasoning model also spends tokens thinking BEFORE emitting
    // it, so a tight budget truncates the later frameworks (they came back 0).
    // Give it ample room to emit the whole card.
    maxTokens: 16000,
  };
}

export function buildImproveMetricPrompt(input: ImproveMetricPromptInput): { system: string; user: string; temperature: number; maxTokens: number } {
  const base = buildScriptReportCardPrompt(input);
  const framework = input.reportCard.frameworkScores.find((f) => f.frameworkId === input.metricId || f.frameworkName === input.metricName);
  const metricPayload = framework ??
    (input.metricId === "style" ? input.reportCard.styleScore : input.metricId === "character" ? input.reportCard.characterScore : input.reportCard.pacingScore);

  return {
    system: `You are LightWriter's screenplay script doctor. Return ONLY a practical improvement plan in markdown bullets. Do not rewrite the whole script yet. Focus on the selected metric and preserve the writer's voice.`,
    user: `${base.user}

SELECTED IMPROVEMENT METRIC: ${input.metricName} (${input.metricId})
CURRENT REPORT DETAIL:
${JSON.stringify(metricPayload, null, 2)}

Create a concise improvement plan with:
- diagnosis
- exact beats/scenes to add, expand, cut, or rewrite
- how to preserve the style contract
- expected score lift
- next command the user should run`,
    temperature: 0.35,
    maxTokens: 3000,
  };
}

function selectedMetricPayload(input: ImproveMetricPromptInput): unknown {
  const framework = input.reportCard.frameworkScores.find((f) => f.frameworkId === input.metricId || f.frameworkName === input.metricName);
  return framework ??
    (input.metricId === "style" ? input.reportCard.styleScore : input.metricId === "character" ? input.reportCard.characterScore : input.reportCard.pacingScore);
}

// Shared hard formatting rules for every prompt that writes screenplay text.
// The editor classifies elements from Fountain shape, so a violation doesn't just
// look wrong — cues/dialogue land left-justified as action.
export const FOUNTAIN_FORMAT_RULES = `FOUNTAIN FORMAT RULES (hard requirements — violations break the editor's rendering):
- Character cue: the name ALONE, ALL CAPS, on its own line, one blank line BEFORE it, and the dialogue starting on the VERY NEXT line (no blank line between cue and dialogue).
- NEVER write dialogue as "NAME: dialogue" on a single line.
- Action lines: sentence-case prose (never ALL CAPS), separated from other elements by a blank line.
- Camera shots keep the "!!" prefix (e.g. "!!WS THE ROOM"); a shot without "!!" is mis-read as a character cue.
- Transitions ("CUT TO:", "FADE OUT.") on their own line.
- Scene headings: "INT./EXT. LOCATION - TIME" in caps.`;

function rewriteJsonInstructions(): string {
  return `Return ONLY this JSON shape:
{
  "rewrittenScript": "complete revised screenplay in Fountain/plain screenplay format",
  "changeSummary": ["specific change made"],
  "warnings": ["risk or unresolved issue, empty if none"]
}`;
}

export function buildMetricRewritePrompt(input: ImproveMetricPromptInput): { system: string; user: string; temperature: number; maxTokens: number } {
  const base = buildScriptReportCardPrompt(input);
  const metricPayload = selectedMetricPayload(input);
  const totalLines = input.script.split("\n").length;
  const blueprint = selectedFrameworkBlueprint(input.metricId, input.targetPages || estimatePages(totalLines), totalLines);
  const structureBlock = targetStructureBlock(blueprint, input.metricName);
  const expansion = expansionDirective(input.script, input.targetPages || estimatePages(totalLines));
  return {
    system: `You are LightWriter's controlled screenplay rewrite engine. Return ONLY valid JSON. Preserve Fountain/plain screenplay formatting. Preserve the writer's style contract, character voices, plot facts, and existing good material. Do not summarize. Do not omit scenes unless explicitly cutting dead weight.`,
    user: `${base.user}

SELECTED REWRITE METRIC: ${input.metricName} (${input.metricId})
CURRENT REPORT DETAIL:
${JSON.stringify(metricPayload, null, 2)}${structureBlock}${expansion}${input.seriesContext ? `\n\n${input.seriesContext}` : ""}${castLockBlock(input.allowedCast)}

Rewrite the current script to improve this selected metric, expanding the draft toward its target length.
Rules:
- Return the complete revised script, not a patch and not notes.
- Keep existing scene headings and useful dialogue where they still work.
- Add, expand, cut, or reorder what materially improves ${input.metricName}; when below target length, that means writing substantial NEW scenes for the metric's weak/missing beats.
- Preserve the STYLE CONTRACT and target/director style.
- Preserve KB continuity and character voice.${input.seriesContext ? "\n- Honor the SERIES CONTEXT above: keep the active arcs advancing, open on the prior cliffhanger if given, and end this episode on its cliffhanger if given." : ""}${input.allowedCast?.length ? "\n- Obey the CAST LOCK above: never invent or add characters that are not in the listed cast." : ""}
- Honor the EXPANSION REQUIREMENT above when present: reach roughly ${input.targetPages} pages with real new scenes, not padding.

${FOUNTAIN_FORMAT_RULES}

${rewriteJsonInstructions()}`,
    temperature: 0.45,
    maxTokens: 14000,
  };
}

function missingBeatSummary(reportCard: ScriptReportCard, targetFrameworkId?: string): string {
  return reportCard.frameworkScores
    .filter((framework) => !targetFrameworkId || framework.frameworkId === targetFrameworkId)
    .flatMap((framework) => framework.beatScores
      .filter((beat) => beat.missing || beat.score < 55)
      .map((beat) => `${framework.frameworkName}: ${beat.beatName} (${beat.expectedPageRange || "no range"}) score ${beat.score}${beat.missing ? " MISSING" : ""}. Suggestions: ${beat.suggestions.join("; ")}`))
    .join("\n") || "No explicit missing beats were returned; use the lowest report card scores and top fixes.";
}

export function buildFillGapsRewritePrompt(input: FillGapsRewritePromptInput): { system: string; user: string; temperature: number; maxTokens: number } {
  const base = buildScriptReportCardPrompt(input);
  const modeLabel = input.mode === "target_pages" ? "complete toward the target page count" : "fill missing/weak structural beats";
  const totalLines = input.script.split("\n").length;
  const targetFramework = input.targetFrameworkId ? ALL_FRAMEWORKS.find((item) => item.id === input.targetFrameworkId) : undefined;
  const structureBlock = targetFramework
    ? targetStructureBlock(selectedFrameworkBlueprint(targetFramework.id, input.targetPages || estimatePages(totalLines), totalLines), targetFramework.name)
    : "";
  const expansion = input.mode === "target_pages" ? expansionDirective(input.script, input.targetPages || estimatePages(totalLines)) : "";
  return {
    system: `You are LightWriter's gap-filling screenplay rewrite engine. Return ONLY valid JSON. Preserve screenplay/Fountain formatting, existing strengths, the writer's style contract, KB continuity, and character voices.`,
    user: `${base.user}

FILL GAPS / COMPLETE TO TARGET PAGES
Mode: ${modeLabel}
Target pages: ${input.targetPages}${structureBlock}${expansion}${input.seriesContext ? `\n\n${input.seriesContext}` : ""}${castLockBlock(input.allowedCast)}

Priority missing beats / weak beats:
${missingBeatSummary(input.reportCard, input.targetFrameworkId)}

Top report-card fixes:
${input.reportCard.topFixes.map((fix, index) => `${index + 1}. ${fix}`).join("\n") || "No top fixes supplied."}

Rewrite the script as a complete revised draft.
Rules:
- Return the complete revised script in rewrittenScript.
- Fill missing beats with real dramatic scenes, not outline notes.
- Complete toward target pages by adding causally connected scenes, reversals, character choices, and payoffs.
- Keep the writer's style contract and target/director style visible in the prose.
- Keep all additions consistent with the KB and current script.${input.allowedCast?.length ? "\n- Obey the CAST LOCK above: never invent or add characters that are not in the listed cast." : ""}
- Expand fully to the target page count with real new scenes. Use warnings ONLY for a genuine creative constraint — never as an excuse to return a short draft.

${FOUNTAIN_FORMAT_RULES}

${rewriteJsonInstructions()}`,
    temperature: 0.5,
    maxTokens: 16000,
  };
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) return text.slice(first, last + 1).trim();
  return text.trim();
}

export function normalizeReportCard(card: Partial<ScriptReportCard>, frameworks: FrameworkDefinition[] = ALL_FRAMEWORKS): ScriptReportCard {
  const supplied = Array.isArray(card.frameworkScores) ? card.frameworkScores : [];
  const frameworkScores = frameworks.map((framework) => {
    const found = supplied.find((item) => item.frameworkId === framework.id || item.frameworkName === framework.name);
    const suppliedBeats = Array.isArray(found?.beatScores) ? found.beatScores : [];
    // Canonicalize to the framework's FIXED beat ladder, matched by name. This is
    // what makes scoring stable: every sample ends up with the SAME beat vector
    // (same names, same order), so the cross-sample median in aggregateReportCards
    // compares like-with-like instead of medianing beat i of one sample against an
    // unrelated beat i of another. Beats the model OMITTED entirely are dropped
    // (not zero-filled): if we zero-filled, a beat the model skipped in one pass
    // would median in a 0 and tank the framework. The aggregator then medians
    // each canonical beat only over the samples that actually returned it, and
    // only emits a 0 for a beat NO sample returned.
    let beatScores: ReportBeatScore[];
    if (suppliedBeats.length) {
      const byName = new Map<string, Partial<ReportBeatScore>>();
      for (const beat of suppliedBeats) byName.set(normBeatName(String(beat.beatName || "")), beat);
      beatScores = framework.beats
        .map((canonical): ReportBeatScore | null => {
          const m = byName.get(normBeatName(canonical.name));
          if (!m) return null;
          return {
            beatName: canonical.name,
            expectedPageRange: m.expectedPageRange ? String(m.expectedPageRange) : undefined,
            detectedEvidence: String(m.detectedEvidence || ""),
            score: clampScore(m.score),
            missing: Boolean(m.missing),
            suggestions: asStringArray(m.suggestions),
          };
        })
        .filter((b): b is ReportBeatScore => b !== null);
    } else {
      beatScores = [];
    }
    // Derive the framework score from the per-beat scores rather than trusting a
    // separate holistic 0-100 guess. Averaging the beats cancels noise and makes
    // the framework score a stable function of the (more concrete) beat judgments.
    const derivedScore = beatScores.length
      ? Math.round(beatScores.reduce((sum, b) => sum + b.score, 0) / beatScores.length)
      : clampScore(found?.score);
    return {
      frameworkId: framework.id,
      frameworkName: framework.name,
      score: derivedScore,
      summary: found?.summary ? String(found.summary) : "Not scored yet.",
      beatScores,
    };
  });

  const styleScore = {
    score: clampScore(card.styleScore?.score),
    matchedTraits: asStringArray(card.styleScore?.matchedTraits),
    drift: asStringArray(card.styleScore?.drift),
    suggestions: asStringArray(card.styleScore?.suggestions),
  };
  const characterScore = {
    score: clampScore(card.characterScore?.score),
    summary: String(card.characterScore?.summary || ""),
    suggestions: asStringArray(card.characterScore?.suggestions),
  };
  const pacingScore = {
    score: clampScore(card.pacingScore?.score),
    summary: String(card.pacingScore?.summary || ""),
    suggestions: asStringArray(card.pacingScore?.suggestions),
  };

  // overallScore is a DETERMINISTIC rollup of the evidence-based sub-scores, not
  // the model's separate (rubric-less) holistic guess. Weight the BEST-matching
  // framework — a script written toward one framework cannot also satisfy the
  // others (e.g. Propp's 31 functions), so averaging all five would cap it far
  // below the truth. 70% best framework + 30% craft average.
  const bestFramework = frameworkScores.length ? Math.max(...frameworkScores.map((f) => f.score)) : 0;
  const craftAvg = Math.round((styleScore.score + characterScore.score + pacingScore.score) / 3);
  const overallScore = clampScore(Math.round(0.7 * bestFramework + 0.3 * craftAvg));

  return {
    overallScore,
    frameworkScores,
    styleScore,
    characterScore,
    pacingScore,
    topFixes: asStringArray(card.topFixes),
    recommendedNextAction: String(card.recommendedNextAction || ""),
  };
}

/** Read a single metric's 0-100 score from a card (framework id, style/character/pacing, or overall). */
export function metricScoreFromCard(card: ScriptReportCard, metricId: string): number {
  if (metricId === "style") return card.styleScore.score;
  if (metricId === "character") return card.characterScore.score;
  if (metricId === "pacing") return card.pacingScore.score;
  if (metricId === "overall") return card.overallScore;
  return card.frameworkScores.find((f) => f.frameworkId === metricId)?.score ?? card.overallScore;
}

function median(values: number[]): number {
  const xs = values.filter((n) => typeof n === "number" && !Number.isNaN(n)).sort((a, b) => a - b);
  if (!xs.length) return 0;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : Math.round((xs[mid - 1] + xs[mid]) / 2);
}

// Combine several independent score samples of the SAME draft into one stable
// card. Reasoning models are noisy even at temperature 0, so a single pass can
// swing a framework several points run-to-run. We denoise at the BEAT level —
// take the median of each beat across samples, then let normalizeReportCard
// re-derive framework + overall scores from those medianed beats with the exact
// same deterministic formula a single-sample card uses. Beat-level medians
// compound: a framework's ~8 medianed beats are far steadier than 3 medianed
// framework totals. Text (summaries, evidence, fixes) comes from the sample
// nearest the median so the prose matches the numbers.
export function aggregateReportCards(cards: ScriptReportCard[], frameworks: FrameworkDefinition[] = ALL_FRAMEWORKS): ScriptReportCard {
  if (cards.length <= 1) return cards[0];

  const overallMedian = median(cards.map((c) => c.overallScore));
  const repCard = cards.reduce((best, c) =>
    Math.abs(c.overallScore - overallMedian) < Math.abs(best.overallScore - overallMedian) ? c : best, cards[0]);

  const frameworkScores = frameworks.map((framework) => {
    const peers = cards
      .map((c) => c.frameworkScores.find((f) => f.frameworkId === framework.id))
      .filter((f): f is FrameworkReportScore => Boolean(f));
    // Median each beat across samples by CANONICAL NAME (not array index), so a
    // sample that reordered/omitted a beat can't contaminate the median with an
    // unrelated beat. When NO sample returned beats for this framework (every
    // pass only gave a holistic score), leave beats empty so normalizeReportCard
    // falls back to the median framework score instead of averaging zeros to 0.
    const anyBeats = peers.some((p) => p.beatScores.length > 0);
    const beatScores = anyBeats
      ? framework.beats.map((canonical) => {
          const beatPeers = peers
            .map((p) => p.beatScores.find((b) => normBeatName(b.beatName) === normBeatName(canonical.name)))
            .filter((b): b is ReportBeatScore => Boolean(b));
          const scoreMedian = median(beatPeers.map((b) => b.score));
          const rep = beatPeers.reduce((best, b) =>
            Math.abs(b.score - scoreMedian) < Math.abs(best.score - scoreMedian) ? b : best, beatPeers[0]);
          const missingVotes = beatPeers.filter((b) => b.missing).length;
          return {
            beatName: canonical.name,
            expectedPageRange: rep?.expectedPageRange,
            detectedEvidence: rep?.detectedEvidence ?? "",
            score: scoreMedian,
            missing: beatPeers.length ? missingVotes * 2 > beatPeers.length : true,
            suggestions: rep?.suggestions ?? [],
          };
        })
      : [];
    const fwScoreMedian = median(peers.map((p) => p.score));
    const repFw = peers.reduce((best, p) =>
      Math.abs(p.score - fwScoreMedian) < Math.abs(best.score - fwScoreMedian) ? p : best, peers[0]);
    return {
      frameworkId: framework.id,
      frameworkName: framework.name,
      // normalizeReportCard re-derives this from the medianed beats; the median
      // here is only the fallback when a framework had no beats in any sample.
      score: fwScoreMedian,
      summary: repFw?.summary ?? "",
      beatScores,
    };
  });

  // Re-normalize so framework totals (mean of medianed beats) and overallScore
  // (the 0.7 best-framework + 0.3 craft rollup) are computed identically to a
  // single-sample card — only the inputs are denoised.
  return normalizeReportCard({
    frameworkScores,
    styleScore: { ...repCard.styleScore, score: median(cards.map((c) => c.styleScore.score)) },
    characterScore: { ...repCard.characterScore, score: median(cards.map((c) => c.characterScore.score)) },
    pacingScore: { ...repCard.pacingScore, score: median(cards.map((c) => c.pacingScore.score)) },
    topFixes: repCard.topFixes,
    recommendedNextAction: repCard.recommendedNextAction,
  }, frameworks);
}

export function parseReportCardResponse(text: string, fallbackFrameworkId?: string, frameworks: FrameworkDefinition[] = ALL_FRAMEWORKS): ScriptReportCard {
  const parsed = JSON.parse(extractJson(text)) as Partial<ScriptReportCard>;
  if (fallbackFrameworkId && Array.isArray(parsed.frameworkScores)) {
    parsed.frameworkScores = parsed.frameworkScores.map((score) => score.frameworkId ? score : { ...score, frameworkId: fallbackFrameworkId });
  }
  return normalizeReportCard(parsed, frameworks);
}

export function validateRewriteScript(script: string): RewriteValidationResult {
  const trimmed = script.trim();
  const lines = trimmed.split("\n").map((line) => line.trim()).filter(Boolean);
  const sceneHeadingCountValue = sceneHeadingCount(trimmed);
  const hasDialogueCue = lines.some((line, index) => /^[A-Z][A-Z0-9 .'-]{1,32}(?:\s*\([^)]*\))?$/.test(line) && Boolean(lines[index + 1]) && !/^(INT\.|EXT\.|INT\/EXT\.|I\/E\.)/i.test(line));
  const hasScreenplayAction = lines.some((line) => /\b(opens|runs|walks|looks|finds|turns|enters|exits|stands|sits|holds|moves|crosses|stares|reveals|takes|drops|pulls|pushes)\b/i.test(line));
  const hasScreenplayShape = sceneHeadingCountValue > 0 || (hasDialogueCue && hasScreenplayAction);
  const hasObviousProviderNotes = /^(here(?:'s| is)|i (?:rewrote|improved|recommend|would)|summary:|notes?:|change summary:)/i.test(trimmed) && sceneHeadingCountValue === 0;
  const issues: string[] = [];
  if (!trimmed) issues.push("Rewrite is empty.");
  if (!hasScreenplayShape) issues.push("Rewrite does not look like screenplay/Fountain text yet.");
  if (hasObviousProviderNotes) issues.push("Provider returned notes instead of a revised screenplay.");
  return {
    canApply: issues.length === 0,
    issues,
    sceneHeadingCount: sceneHeadingCountValue,
    hasDialogueCue,
    hasScreenplayAction,
  };
}

function rawPreview(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 700);
}

function rewriteCandidateFromParsed(parsed: Record<string, unknown>): { script: string; field: string } {
  const fields = ["rewrittenScript", "revisedScript", "script", "draft", "screenplay"];
  for (const field of fields) {
    const value = parsed[field];
    if (typeof value === "string" && value.trim()) {
      return { script: value.trim(), field };
    }
  }
  return { script: "", field: "" };
}

function rewriteSummaryFromParsed(parsed: Record<string, unknown>): string[] {
  return asStringArray(parsed.changeSummary).length
    ? asStringArray(parsed.changeSummary)
    : asStringArray(parsed.summary).length
      ? asStringArray(parsed.summary)
      : asStringArray(parsed.changes);
}

/** Full deterministic formatting pass on a rewrite candidate, with a safety net:
 *  if the reclassification ever produces something that no longer validates as an
 *  apply-ready screenplay, fall back to the light shot-normalization only. */
function cleanRewriteScript(script: string, characterNames: string[]): string {
  const cleaned = cleanupGeneratedScreenplay(script, characterNames);
  return validateRewriteScript(cleaned).canApply ? cleaned : normalizeShotLines(script);
}

export function parseRewriteResponse(text: string, characterNames: string[] = []): ScriptRewriteResult {
  const preview = rawPreview(text);
  let parsed: Record<string, unknown> | null = null;
  let jsonError: unknown = null;
  try {
    parsed = JSON.parse(extractJson(text)) as Record<string, unknown>;
  } catch (error) {
    jsonError = error;
  }

  if (parsed) {
    const candidate = rewriteCandidateFromParsed(parsed);
    if (!candidate.script) {
      throw new Error(`The rewrite response did not include a rewrittenScript, revisedScript, script, draft, or screenplay field. Raw response preview: ${preview}`);
    }
    const validation = validateRewriteScript(candidate.script);
    if (!validation.canApply) {
      throw new Error(`The rewrite response field "${candidate.field}" did not include an apply-ready screenplay: ${validation.issues.join(" ")} Raw response preview: ${preview}`);
    }
    const recoveredWarnings = candidate.field === "rewrittenScript" ? [] : [`Recovered screenplay from provider field "${candidate.field}"; preferred field is "rewrittenScript".`];
    return {
      // Full deterministic formatting pass (cues/dialogue/shots/transitions), not
      // just shot normalization — rewrite models emit sloppy Fountain (mis-spaced
      // cues, "NAME: dialogue") that otherwise renders left-justified as action.
      rewrittenScript: cleanRewriteScript(candidate.script, characterNames),
      changeSummary: rewriteSummaryFromParsed(parsed),
      warnings: [...recoveredWarnings, ...asStringArray(parsed.warnings)],
      rawResponsePreview: preview,
      recoveredFrom: candidate.field === "rewrittenScript" ? undefined : candidate.field,
    };
  }

  const plainText = text.trim();
  const validation = validateRewriteScript(plainText);
  if (validation.canApply) {
    return {
      rewrittenScript: cleanRewriteScript(plainText, characterNames),
      changeSummary: ["Recovered plain screenplay text from a non-JSON provider response."],
      warnings: [`Provider response was not valid JSON (${jsonError instanceof Error ? jsonError.message : "parse failed"}); recovered because it looked like screenplay text.`],
      rawResponsePreview: preview,
      recoveredFrom: "plainText",
    };
  }
  throw new Error(`The rewrite response did not include a recoverable screenplay. ${validation.issues.join(" ")} Raw response preview: ${preview}`);
}

function sceneHeadingCount(script: string): number {
  return script
    .split("\n")
    .filter((line) => /^(INT\.|EXT\.|INT\/EXT\.|I\/E\.)/i.test(line.trim()))
    .length;
}

export function summarizeRewriteDiff(beforeScript: string, afterScript: string): RewriteDiffSummary {
  const beforeLines = beforeScript.split("\n");
  const afterLines = afterScript.split("\n");
  const max = Math.max(beforeLines.length, afterLines.length);
  let changedLineCount = 0;
  for (let i = 0; i < max; i += 1) {
    if ((beforeLines[i] || "") !== (afterLines[i] || "")) changedLineCount += 1;
  }
  const beforeSceneHeadings = sceneHeadingCount(beforeScript);
  const afterSceneHeadings = sceneHeadingCount(afterScript);
  return {
    beforeLines: beforeLines.length,
    afterLines: afterLines.length,
    lineDelta: afterLines.length - beforeLines.length,
    beforeCharacters: beforeScript.length,
    afterCharacters: afterScript.length,
    characterDelta: afterScript.length - beforeScript.length,
    beforeSceneHeadings,
    afterSceneHeadings,
    sceneHeadingDelta: afterSceneHeadings - beforeSceneHeadings,
    changedLineCount,
  };
}

export function compareReportCards(before: ScriptReportCard, after: ScriptReportCard): ReportCardComparison {
  const frameworkDeltas = before.frameworkScores.map((beforeFramework) => {
    const afterFramework = after.frameworkScores.find((framework) => framework.frameworkId === beforeFramework.frameworkId || framework.frameworkName === beforeFramework.frameworkName);
    const afterScore = clampScore(afterFramework?.score);
    return {
      id: beforeFramework.frameworkId,
      name: beforeFramework.frameworkName,
      before: clampScore(beforeFramework.score),
      after: afterScore,
      delta: afterScore - clampScore(beforeFramework.score),
    };
  });
  const craftDeltas: ReportMetricDelta[] = [
    { id: "style", name: "Style Match", before: clampScore(before.styleScore.score), after: clampScore(after.styleScore.score), delta: clampScore(after.styleScore.score) - clampScore(before.styleScore.score) },
    { id: "character", name: "Character Consistency", before: clampScore(before.characterScore.score), after: clampScore(after.characterScore.score), delta: clampScore(after.characterScore.score) - clampScore(before.characterScore.score) },
    { id: "pacing", name: "Pacing", before: clampScore(before.pacingScore.score), after: clampScore(after.pacingScore.score), delta: clampScore(after.pacingScore.score) - clampScore(before.pacingScore.score) },
  ];
  const metricDeltas = [...frameworkDeltas, ...craftDeltas];
  const topImprovement = metricDeltas.length ? [...metricDeltas].sort((a, b) => b.delta - a.delta)[0] : null;
  return {
    beforeOverall: clampScore(before.overallScore),
    afterOverall: clampScore(after.overallScore),
    overallDelta: clampScore(after.overallScore) - clampScore(before.overallScore),
    metricDeltas,
    topImprovement: topImprovement && topImprovement.delta > 0 ? topImprovement : null,
  };
}

// How many independent score samples to take and median together. Reasoning
// models bounce a few points run-to-run even at temperature 0; medianing a
// handful of samples (run in parallel, so wall-clock stays ~one call) makes the
// score stable enough that "did the rewrite improve it?" is a real signal.
export const SCORING_SAMPLES = 5;
// Bump when scoring logic changes so cached cards from an older method invalidate.
const SCORER_VERSION = "2";

export interface ReportCardCacheOptions {
  projectId: string;
  /** Skip the cache and recompute (the "Re-score" path), then overwrite the cache. */
  force?: boolean;
}

export async function runScriptReportCard(
  input: ScriptReportPromptInput,
  options?: { samples?: number; completeOverride?: Completion; cache?: ReportCardCacheOptions },
): Promise<ScriptReportCard> {
  const frameworks = input.frameworks?.length ? input.frameworks : ALL_FRAMEWORKS;
  const prompt = buildScriptReportCardPrompt(input);
  const n = Math.max(1, options?.samples ?? SCORING_SAMPLES);

  // Content-addressed cache: identical scoring inputs return the IDENTICAL stored
  // card, so re-scoring unchanged text gives the same score (and the card persists
  // across tab switches / restarts). `force` bypasses and overwrites.
  const cache = options?.cache;
  let hash = "";
  if (cache) {
    const analyst = getAnalystProviderSettings();
    // Include the FULL script (prompt.user truncates it at 120k, so edits past
    // that window would otherwise not bust the cache) and targetPages explicitly.
    hash = simpleScriptHash(
      `v${SCORER_VERSION}|n${n}|${analyst.provider}:${analyst.model}|${frameworks.map((f) => f.id).sort().join(",")}|tp${input.targetPages}|len${input.script.length}|${input.script}|${prompt.system}\n${prompt.user}`,
    );
    if (!cache.force) {
      const stored = loadStoredReportCard(cache.projectId);
      if (stored && stored.hash === hash) return stored.card;
    }
  }

  // Scoring is an ANALYST task — use the analyst model (e.g. grok), not the
  // creative writer model, which tends to score loose and high.
  const service = TextAiService.forAnalyst();
  const complete: Completion = options?.completeOverride ?? service.complete.bind(service);
  const runOnce = () =>
    complete(prompt.system, prompt.user, { temperature: prompt.temperature, maxTokens: prompt.maxTokens }).then((r) =>
      parseReportCardResponse(r, undefined, frameworks));

  let card: ScriptReportCard;
  if (n === 1) {
    card = await runOnce();
  } else {
    // Run the samples concurrently and median whatever comes back. A flaky
    // sample (network/parse) is dropped; we only fail if every sample fails.
    const settled = await Promise.allSettled(Array.from({ length: n }, runOnce));
    const cards = settled
      .filter((s): s is PromiseFulfilledResult<ScriptReportCard> => s.status === "fulfilled")
      .map((s) => s.value);
    if (!cards.length) {
      const firstRejection = settled.find((s) => s.status === "rejected") as PromiseRejectedResult | undefined;
      throw firstRejection?.reason ?? new Error("Report card scoring failed for every sample.");
    }
    card = aggregateReportCards(cards, frameworks);
  }

  if (cache) saveStoredReportCard(cache.projectId, hash, card);
  return card;
}

export async function generateMetricImprovementPlan(input: ImproveMetricPromptInput): Promise<string> {
  const prompt = buildImproveMetricPrompt(input);
  const service = TextAiService.forAnalyst();
  return service.complete(prompt.system, prompt.user, {
    temperature: prompt.temperature,
    maxTokens: prompt.maxTokens,
  });
}

export type FillGapsProgress = ExpandProgress;

// Format the weak/missing beats of the chosen framework as guidance for the
// scene-insertion expansion engine.
function beatGuidanceFor(reportCard: ScriptReportCard, frameworkId: string | undefined): string {
  const fw = frameworkId ? reportCard.frameworkScores.find((f) => f.frameworkId === frameworkId) : undefined;
  if (!fw || !fw.beatScores.length) {
    return reportCard.topFixes.slice(0, 6).map((fix, i) => `${i + 1}. ${fix}`).join("\n");
  }
  return fw.beatScores
    .map((b) => `- ${b.beatName}${b.expectedPageRange ? ` (pages ${b.expectedPageRange})` : ""}: score ${b.score}${b.missing ? " — MISSING, write full scenes" : b.score < 60 ? " — WEAK, expand with new scenes" : " — present"}`)
    .join("\n");
}

// After a quality rewrite, if the draft is still well under the target page
// count, grow it to target by inserting whole new scenes (reliable expansion).
export async function expandToTargetIfNeeded(
  result: ScriptRewriteResult,
  opts: { targetPages: number; frameworkId?: string; reportCard: ScriptReportCard; knowledgeBase: KnowledgeBase | null; styleProfile: StyleProfile | null; seriesContext?: string; allowedCast?: string[] },
  onProgress?: (p: ExpandProgress) => void,
  completeOverride?: Completion,
): Promise<ScriptRewriteResult> {
  if (!opts.targetPages) return result;
  const currentPages = estimatePages(result.rewrittenScript.split("\n").length);
  if (currentPages >= Math.floor(opts.targetPages * 0.9)) return result;

  const framework = opts.frameworkId ? ALL_FRAMEWORKS.find((f) => f.id === opts.frameworkId) : undefined;
  const expanded = await expandScriptToTargetPages(
    result.rewrittenScript,
    {
      targetPages: opts.targetPages,
      frameworkName: framework?.name,
      beatGuidance: beatGuidanceFor(opts.reportCard, opts.frameworkId),
      knowledgeBase: opts.knowledgeBase,
      styleProfile: opts.styleProfile,
      seriesContext: opts.seriesContext,
      allowedCast: opts.allowedCast,
    },
    onProgress,
    completeOverride,
  );
  return {
    ...result,
    rewrittenScript: expanded.script,
    changeSummary: Array.from(new Set([...result.changeSummary, ...expanded.changeSummary])),
    warnings: Array.from(new Set([...result.warnings, ...expanded.warnings])),
  };
}

export async function rewriteScriptForMetric(
  input: ImproveMetricPromptInput,
  onProgress?: (progress: ExpandProgress) => void,
): Promise<ScriptRewriteResult> {
  const prompt = buildMetricRewritePrompt(input);
  const service = new TextAiService();
  onProgress?.({ completed: 0, total: 1, label: `Rewriting for ${input.metricName}...` });
  const response = await service.complete(prompt.system, prompt.user, {
    temperature: prompt.temperature,
    maxTokens: prompt.maxTokens,
  });
  const result = parseRewriteResponse(response, input.allowedCast);
  return expandToTargetIfNeeded(
    result,
    {
      targetPages: input.targetPages || estimatePages(input.script.split("\n").length),
      frameworkId: input.metricId,
      reportCard: input.reportCard,
      knowledgeBase: input.knowledgeBase,
      styleProfile: input.styleProfile,
      seriesContext: input.seriesContext,
      allowedCast: input.allowedCast,
    },
    onProgress,
  );
}

export async function fillScriptGaps(
  input: FillGapsRewritePromptInput,
  onProgress?: (progress: ExpandProgress) => void,
): Promise<ScriptRewriteResult> {
  const prompt = buildFillGapsRewritePrompt(input);
  const service = new TextAiService();
  onProgress?.({ completed: 0, total: 1, label: input.mode === "target_pages" ? "Completing structure..." : "Filling missing beats..." });
  const response = await service.complete(prompt.system, prompt.user, {
    temperature: prompt.temperature,
    maxTokens: prompt.maxTokens,
  });
  const result = parseRewriteResponse(response, input.allowedCast);
  if (input.mode !== "target_pages") return result;
  return expandToTargetIfNeeded(
    result,
    {
      targetPages: input.targetPages || estimatePages(input.script.split("\n").length),
      frameworkId: input.targetFrameworkId,
      reportCard: input.reportCard,
      knowledgeBase: input.knowledgeBase,
      styleProfile: input.styleProfile,
      seriesContext: input.seriesContext,
      allowedCast: input.allowedCast,
    },
    onProgress,
  );
}
