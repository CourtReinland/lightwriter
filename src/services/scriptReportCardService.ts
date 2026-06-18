import { ALL_FRAMEWORKS, computeBeatRanges, estimatePages } from "../frameworks";
import type { FrameworkDefinition } from "../frameworks";
import { KnowledgeBaseService, type KnowledgeBase } from "./knowledgeBase";
import { StyleProfileService, type StyleProfile } from "./styleProfile";
import { TextAiService } from "./textAiService";

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
  const frameworkText = ALL_FRAMEWORKS
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

Evaluate these frameworks and every beat listed below:
${frameworkText}

Evaluate additional craft metrics:
- STYLE MATCH against the STYLE CONTRACT / target-director style.
- CHARACTER CONSISTENCY against KB characters, arcs, voice, and relationships.
- PACING against target page length, scene density, escalation, and payoff timing.

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
    temperature: 0.25,
    maxTokens: 7000,
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
${JSON.stringify(metricPayload, null, 2)}${structureBlock}${expansion}

Rewrite the current script to improve this selected metric, expanding the draft toward its target length.
Rules:
- Return the complete revised script, not a patch and not notes.
- Keep existing scene headings and useful dialogue where they still work.
- Add, expand, cut, or reorder what materially improves ${input.metricName}; when below target length, that means writing substantial NEW scenes for the metric's weak/missing beats.
- Preserve the STYLE CONTRACT and target/director style.
- Preserve KB continuity and character voice.
- Honor the EXPANSION REQUIREMENT above when present: reach roughly ${input.targetPages} pages with real new scenes, not padding.

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
Target pages: ${input.targetPages}${structureBlock}${expansion}

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
- Keep all additions consistent with the KB and current script.
- Expand fully to the target page count with real new scenes. Use warnings ONLY for a genuine creative constraint — never as an excuse to return a short draft.

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

export function normalizeReportCard(card: Partial<ScriptReportCard>): ScriptReportCard {
  const supplied = Array.isArray(card.frameworkScores) ? card.frameworkScores : [];
  const frameworkScores = ALL_FRAMEWORKS.map((framework) => {
    const found = supplied.find((item) => item.frameworkId === framework.id || item.frameworkName === framework.name);
    return {
      frameworkId: framework.id,
      frameworkName: framework.name,
      score: clampScore(found?.score),
      summary: found?.summary ? String(found.summary) : "Not scored yet.",
      beatScores: Array.isArray(found?.beatScores)
        ? found.beatScores.map((beat) => ({
            beatName: String(beat.beatName || "Unnamed beat"),
            expectedPageRange: beat.expectedPageRange ? String(beat.expectedPageRange) : undefined,
            detectedEvidence: String(beat.detectedEvidence || ""),
            score: clampScore(beat.score),
            missing: Boolean(beat.missing),
            suggestions: asStringArray(beat.suggestions),
          }))
        : [],
    };
  });

  return {
    overallScore: clampScore(card.overallScore),
    frameworkScores,
    styleScore: {
      score: clampScore(card.styleScore?.score),
      matchedTraits: asStringArray(card.styleScore?.matchedTraits),
      drift: asStringArray(card.styleScore?.drift),
      suggestions: asStringArray(card.styleScore?.suggestions),
    },
    characterScore: {
      score: clampScore(card.characterScore?.score),
      summary: String(card.characterScore?.summary || ""),
      suggestions: asStringArray(card.characterScore?.suggestions),
    },
    pacingScore: {
      score: clampScore(card.pacingScore?.score),
      summary: String(card.pacingScore?.summary || ""),
      suggestions: asStringArray(card.pacingScore?.suggestions),
    },
    topFixes: asStringArray(card.topFixes),
    recommendedNextAction: String(card.recommendedNextAction || ""),
  };
}

export function parseReportCardResponse(text: string, fallbackFrameworkId?: string): ScriptReportCard {
  const parsed = JSON.parse(extractJson(text)) as Partial<ScriptReportCard>;
  if (fallbackFrameworkId && Array.isArray(parsed.frameworkScores)) {
    parsed.frameworkScores = parsed.frameworkScores.map((score) => score.frameworkId ? score : { ...score, frameworkId: fallbackFrameworkId });
  }
  return normalizeReportCard(parsed);
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

export function parseRewriteResponse(text: string): ScriptRewriteResult {
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
      rewrittenScript: candidate.script,
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
      rewrittenScript: plainText,
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

export async function runScriptReportCard(input: ScriptReportPromptInput): Promise<ScriptReportCard> {
  const prompt = buildScriptReportCardPrompt(input);
  const service = new TextAiService();
  const response = await service.complete(prompt.system, prompt.user, {
    temperature: prompt.temperature,
    maxTokens: prompt.maxTokens,
  });
  return parseReportCardResponse(response);
}

export async function generateMetricImprovementPlan(input: ImproveMetricPromptInput): Promise<string> {
  const prompt = buildImproveMetricPrompt(input);
  const service = new TextAiService();
  return service.complete(prompt.system, prompt.user, {
    temperature: prompt.temperature,
    maxTokens: prompt.maxTokens,
  });
}

export async function rewriteScriptForMetric(input: ImproveMetricPromptInput): Promise<ScriptRewriteResult> {
  const prompt = buildMetricRewritePrompt(input);
  const service = new TextAiService();
  const response = await service.complete(prompt.system, prompt.user, {
    temperature: prompt.temperature,
    maxTokens: prompt.maxTokens,
  });
  return parseRewriteResponse(response);
}

export interface FillGapsProgress {
  completed: number;
  total: number;
  label: string;
}

export async function fillScriptGaps(
  input: FillGapsRewritePromptInput,
  onProgress?: (progress: FillGapsProgress) => void,
): Promise<ScriptRewriteResult> {
  const service = new TextAiService();
  const targetPages = input.targetPages || estimatePages(input.script.split("\n").length);
  // Models rarely jump from 13 -> 23 pages in one shot. For target-page completion,
  // feed the growing draft back in and keep expanding until it nears the target.
  const maxPasses = input.mode === "target_pages" ? 3 : 1;

  let currentScript = input.script;
  let lastResult: ScriptRewriteResult | null = null;
  const allChanges: string[] = [];
  const allWarnings: string[] = [];

  for (let pass = 0; pass < maxPasses; pass++) {
    const currentPages = estimatePages(currentScript.split("\n").length);
    if (input.mode === "target_pages" && currentPages >= Math.floor(targetPages * 0.95)) break;

    onProgress?.({
      completed: pass,
      total: maxPasses,
      label: input.mode === "target_pages"
        ? `Expanding toward ${targetPages} pages (pass ${pass + 1}/${maxPasses}, ~${currentPages} so far)`
        : "Filling missing beats",
    });

    const prompt = buildFillGapsRewritePrompt({ ...input, script: currentScript });
    const response = await service.complete(prompt.system, prompt.user, {
      temperature: prompt.temperature,
      maxTokens: prompt.maxTokens,
    });
    const result = parseRewriteResponse(response);

    const grew = result.rewrittenScript.trim().split("\n").length > currentScript.split("\n").length;
    if (result.rewrittenScript.trim() && (grew || lastResult === null)) {
      currentScript = result.rewrittenScript;
      lastResult = result;
      allChanges.push(...result.changeSummary);
      allWarnings.push(...result.warnings);
    } else {
      // This pass didn't grow the draft — stop rather than spin.
      if (!lastResult) lastResult = result;
      break;
    }
  }

  const base = lastResult ?? { rewrittenScript: currentScript, changeSummary: [], warnings: [] };
  return {
    ...base,
    rewrittenScript: currentScript,
    changeSummary: allChanges.length ? Array.from(new Set(allChanges)) : base.changeSummary,
    warnings: Array.from(new Set(allWarnings)),
  };
}
