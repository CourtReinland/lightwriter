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
