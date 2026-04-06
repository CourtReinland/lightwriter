import { GrokService } from "./grokService";
import type { KnowledgeBase } from "./knowledgeBase";
import type { StyleProfile } from "./styleProfile";
import { computeBeatRanges, type ComputedBeat } from "../frameworks/utils";
import { ALL_FRAMEWORKS } from "../frameworks";

// ── Result Types ──

export interface ScenePacingResult {
  sceneIdx: number;
  heading: string;
  score: number; // 1-10
  notes: string;
}

export interface PacingAnalysis {
  scenes: ScenePacingResult[];
  overallScore: number;
}

export interface CharacterConsistencyResult {
  characterName: string;
  score: number; // 1-10
  issues: string[];
  notes: string;
}

export interface BeatAlignmentResult {
  frameworkId: string;
  frameworkName: string;
  beatName: string;
  beatColor: string;
  startPage: number;
  endPage: number;
  score: number; // 1-10
  accomplished: string;
  missing: string;
}

export interface SceneDialogueResult {
  sceneIdx: number;
  heading: string;
  subtext: number; // 1-10
  naturalness: number; // 1-10
  distinctiveness: number; // 1-10
  notes: string;
}

export interface AnalysisResult {
  projectId: string;
  timestamp: number;
  pacing: PacingAnalysis | null;
  characterConsistency: CharacterConsistencyResult[];
  beatAlignment: BeatAlignmentResult[];
  dialogueQuality: SceneDialogueResult[];
  overallScore: number;
}

export type AnalysisSection = "pacing" | "character" | "beat" | "dialogue";

export interface AnalysisProgress {
  section: AnalysisSection;
  completed: number;
  total: number;
  label: string;
}

// ── Scene extraction ──

interface SceneBlock {
  idx: number;
  heading: string;
  text: string;
  startLine: number;
  endLine: number;
}

function extractScenes(content: string): SceneBlock[] {
  const lines = content.split("\n");
  const scenePattern = /^\.((?!\.)\S)|^(INT|EXT|EST|INT\.\/EXT|I\/E)[.\s]/i;
  const scenes: SceneBlock[] = [];

  let currentStart = -1;
  let currentHeading = "";

  for (let i = 0; i < lines.length; i++) {
    if (scenePattern.test(lines[i].trim())) {
      if (currentStart >= 0) {
        scenes.push({
          idx: scenes.length,
          heading: currentHeading,
          text: lines.slice(currentStart, i).join("\n"),
          startLine: currentStart,
          endLine: i - 1,
        });
      }
      currentStart = i;
      currentHeading = lines[i].trim().replace(/^\.\s*/, "");
    }
  }

  if (currentStart >= 0) {
    scenes.push({
      idx: scenes.length,
      heading: currentHeading,
      text: lines.slice(currentStart).join("\n"),
      startLine: currentStart,
      endLine: lines.length - 1,
    });
  }

  return scenes;
}

// ── Dialogue extraction per character ──

function extractCharacterDialogue(content: string, characterName: string): string {
  const lines = content.split("\n");
  const targetUpper = characterName.toUpperCase().trim();
  const dialogue: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    // Match character name line (ALL CAPS, may have extensions like (V.O.) or (CONT'D))
    if (line === targetUpper || line.startsWith(targetUpper + " (") || line === "@" + targetUpper) {
      // Collect dialogue until blank line or next character
      const block: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j];
        if (!next.trim()) break; // Blank line ends dialogue
        block.push(next);
      }
      if (block.length > 0) dialogue.push(block.join("\n"));
    }
  }

  return dialogue.join("\n---\n");
}

// ── JSON parsing helper ──

function parseJsonResponse<T>(text: string, fallback: T): T {
  try {
    const cleaned = text.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "").trim();
    return JSON.parse(cleaned) as T;
  } catch {
    return fallback;
  }
}

// ── Pacing Analysis ──

async function analyzePacingBatch(
  scenes: SceneBlock[],
  service: GrokService,
): Promise<ScenePacingResult[]> {
  // Batch 3 scenes per API call
  const results: ScenePacingResult[] = [];
  const batches: SceneBlock[][] = [];
  for (let i = 0; i < scenes.length; i += 3) {
    batches.push(scenes.slice(i, i + 3));
  }

  for (const batch of batches) {
    const sceneTexts = batch.map((s, i) =>
      `SCENE ${i + 1} (${s.heading}):\n${s.text.slice(0, 1500)}`,
    ).join("\n\n---\n\n");

    const system = `You are a screenplay pacing analyst. Analyze each scene's pacing effectiveness. Return ONLY a JSON array of objects, no markdown:
[{"sceneIdx": number, "score": number (1-10), "notes": "string (1-2 sentences)"}]

Consider: does the scene move with appropriate speed? Is there enough breathing room? Does it drag or rush? Does it advance the story?`;

    const user = `Analyze the pacing of these scenes:\n\n${sceneTexts}`;

    try {
      const response = await service.complete(system, user, { temperature: 0.3, maxTokens: 1500 });
      const parsed = parseJsonResponse<Array<{ sceneIdx: number; score: number; notes: string }>>(response, []);

      for (let i = 0; i < batch.length; i++) {
        const found = parsed.find(p => p.sceneIdx === i + 1) || parsed[i];
        results.push({
          sceneIdx: batch[i].idx,
          heading: batch[i].heading,
          score: found?.score ?? 5,
          notes: found?.notes ?? "Analysis unavailable",
        });
      }
    } catch {
      // On error, push placeholder results
      for (const scene of batch) {
        results.push({
          sceneIdx: scene.idx,
          heading: scene.heading,
          score: 5,
          notes: "Analysis failed",
        });
      }
    }
  }

  return results;
}

// ── Character Consistency ──

async function analyzeCharacterConsistency(
  kb: KnowledgeBase,
  content: string,
  service: GrokService,
): Promise<CharacterConsistencyResult[]> {
  const results: CharacterConsistencyResult[] = [];

  for (const char of kb.characters) {
    const dialogue = extractCharacterDialogue(content, char.name);
    if (!dialogue.trim()) {
      results.push({
        characterName: char.name,
        score: 0,
        issues: ["No dialogue found for this character in the script"],
        notes: "",
      });
      continue;
    }

    const truncated = dialogue.length > 4000 ? dialogue.slice(0, 4000) : dialogue;

    const system = `You are a character consistency analyst. Compare this character's dialogue against their established profile. Return ONLY a JSON object, no markdown:
{"score": number (1-10), "issues": ["string", "string"], "notes": "string (1-2 sentences overall assessment)"}

Look for: voice inconsistencies, behavioral contradictions, vocabulary mismatches, tone shifts that don't match the character.`;

    const user = `CHARACTER PROFILE:
Name: ${char.name}
Description: ${char.description}
Traits: ${char.traits.join(", ")}
Voice notes: ${char.voiceNotes}

DIALOGUE FROM SCRIPT:
${truncated}

Does the dialogue match the profile? Score 1-10.`;

    try {
      const response = await service.complete(system, user, { temperature: 0.3, maxTokens: 800 });
      const parsed = parseJsonResponse<{ score: number; issues: string[]; notes: string }>(
        response,
        { score: 5, issues: [], notes: "Analysis unavailable" },
      );

      results.push({
        characterName: char.name,
        score: parsed.score,
        issues: parsed.issues || [],
        notes: parsed.notes,
      });
    } catch {
      results.push({
        characterName: char.name,
        score: 0,
        issues: ["Analysis failed"],
        notes: "",
      });
    }
  }

  return results;
}

// ── Beat Alignment ──

async function analyzeBeatAlignment(
  content: string,
  activeFrameworks: string[],
  targetPages: number,
  totalLines: number,
  service: GrokService,
): Promise<BeatAlignmentResult[]> {
  const results: BeatAlignmentResult[] = [];
  const lines = content.split("\n");

  for (const fw of ALL_FRAMEWORKS) {
    if (!activeFrameworks.includes(fw.id)) continue;

    const beats: ComputedBeat[] = computeBeatRanges(fw, targetPages, totalLines);

    // Analyze top 6 beats per framework to limit API calls
    const topBeats = beats.slice(0, 6);

    for (const beat of topBeats) {
      const beatText = lines.slice(beat.startLine, beat.endLine + 1).join("\n");
      if (!beatText.trim()) {
        results.push({
          frameworkId: fw.id,
          frameworkName: fw.name,
          beatName: beat.name,
          beatColor: beat.color,
          startPage: beat.startPage,
          endPage: beat.endPage,
          score: 0,
          accomplished: "",
          missing: "No content in this page range yet",
        });
        continue;
      }

      const truncated = beatText.length > 3000 ? beatText.slice(0, 3000) : beatText;

      const system = `You are a screenplay structure analyst. Evaluate how well the script section serves its expected story beat. Return ONLY a JSON object, no markdown:
{"score": number (1-10), "accomplished": "string", "missing": "string"}`;

      const user = `EXPECTED BEAT: ${beat.name} (${fw.name})
Description: ${beat.description}
Examples: ${beat.examples.slice(0, 2).join("; ")}

SCRIPT SECTION (pp ${beat.startPage}-${beat.endPage}):
${truncated}

How well does this section serve the expected beat?`;

      try {
        const response = await service.complete(system, user, { temperature: 0.3, maxTokens: 600 });
        const parsed = parseJsonResponse<{ score: number; accomplished: string; missing: string }>(
          response,
          { score: 5, accomplished: "", missing: "Analysis unavailable" },
        );

        results.push({
          frameworkId: fw.id,
          frameworkName: fw.name,
          beatName: beat.name,
          beatColor: beat.color,
          startPage: beat.startPage,
          endPage: beat.endPage,
          score: parsed.score,
          accomplished: parsed.accomplished,
          missing: parsed.missing,
        });
      } catch {
        results.push({
          frameworkId: fw.id,
          frameworkName: fw.name,
          beatName: beat.name,
          beatColor: beat.color,
          startPage: beat.startPage,
          endPage: beat.endPage,
          score: 0,
          accomplished: "",
          missing: "Analysis failed",
        });
      }
    }
  }

  return results;
}

// ── Dialogue Quality ──

async function analyzeDialogueQuality(
  scenes: SceneBlock[],
  service: GrokService,
): Promise<SceneDialogueResult[]> {
  const results: SceneDialogueResult[] = [];

  // Filter to scenes with dialogue (heuristic: contains ALL CAPS single-word lines)
  const dialogueScenes = scenes.filter(s => /^[A-Z][A-Z0-9 ']{0,40}$/m.test(s.text));

  // Batch 2 scenes per call
  for (let i = 0; i < dialogueScenes.length; i += 2) {
    const batch = dialogueScenes.slice(i, i + 2);
    const sceneTexts = batch.map((s, j) =>
      `SCENE ${j + 1} (${s.heading}):\n${s.text.slice(0, 2000)}`,
    ).join("\n\n---\n\n");

    const system = `You are a dialogue quality analyst. Rate each scene's dialogue on three dimensions. Return ONLY a JSON array:
[{"sceneIdx": number, "subtext": number (1-10), "naturalness": number (1-10), "distinctiveness": number (1-10), "notes": "string"}]

- Subtext: how much is said vs. unsaid, implied meaning
- Naturalness: does it sound like real speech
- Distinctiveness: do characters have unique voices`;

    const user = `Analyze dialogue in these scenes:\n\n${sceneTexts}`;

    try {
      const response = await service.complete(system, user, { temperature: 0.3, maxTokens: 1500 });
      const parsed = parseJsonResponse<Array<{
        sceneIdx: number; subtext: number; naturalness: number; distinctiveness: number; notes: string;
      }>>(response, []);

      for (let j = 0; j < batch.length; j++) {
        const found = parsed.find(p => p.sceneIdx === j + 1) || parsed[j];
        results.push({
          sceneIdx: batch[j].idx,
          heading: batch[j].heading,
          subtext: found?.subtext ?? 5,
          naturalness: found?.naturalness ?? 5,
          distinctiveness: found?.distinctiveness ?? 5,
          notes: found?.notes ?? "Analysis unavailable",
        });
      }
    } catch {
      for (const scene of batch) {
        results.push({
          sceneIdx: scene.idx,
          heading: scene.heading,
          subtext: 0,
          naturalness: 0,
          distinctiveness: 0,
          notes: "Analysis failed",
        });
      }
    }
  }

  return results;
}

// ── Cache ──

function cacheKey(projectId: string): string {
  return `lw-analysis-${projectId}`;
}

export function loadCachedAnalysis(projectId: string): AnalysisResult | null {
  try {
    const raw = localStorage.getItem(cacheKey(projectId));
    if (raw) return JSON.parse(raw);
  } catch {
    // corrupt
  }
  return null;
}

export function saveCachedAnalysis(result: AnalysisResult): void {
  localStorage.setItem(cacheKey(result.projectId), JSON.stringify(result));
}

export function clearCachedAnalysis(projectId: string): void {
  localStorage.removeItem(cacheKey(projectId));
}

// ── Main orchestrator ──

export async function runFullAnalysis(
  projectId: string,
  content: string,
  kb: KnowledgeBase,
  _styleProfile: StyleProfile | null,
  activeFrameworks: string[],
  targetPages: number,
  apiKey: string,
  onProgress: (progress: AnalysisProgress, partialResult: Partial<AnalysisResult>) => void,
): Promise<AnalysisResult> {
  const service = new GrokService(apiKey);
  const scenes = extractScenes(content);
  const totalLines = content.split("\n").length;

  const result: AnalysisResult = {
    projectId,
    timestamp: Date.now(),
    pacing: null,
    characterConsistency: [],
    beatAlignment: [],
    dialogueQuality: [],
    overallScore: 0,
  };

  // ── Phase 1: Pacing ──
  onProgress(
    { section: "pacing", completed: 0, total: Math.ceil(scenes.length / 3), label: "Analyzing pacing..." },
    result,
  );

  const pacingResults = await analyzePacingBatch(scenes, service);
  const pacingScore = pacingResults.reduce((sum, r) => sum + r.score, 0) / Math.max(1, pacingResults.length);
  result.pacing = { scenes: pacingResults, overallScore: pacingScore };

  onProgress(
    { section: "pacing", completed: Math.ceil(scenes.length / 3), total: Math.ceil(scenes.length / 3), label: "Pacing complete" },
    { ...result },
  );

  // ── Phase 2: Character consistency ──
  if (kb.characters.length > 0) {
    onProgress(
      { section: "character", completed: 0, total: kb.characters.length, label: "Analyzing characters..." },
      { ...result },
    );

    const charResults = await analyzeCharacterConsistency(kb, content, service);
    result.characterConsistency = charResults;

    onProgress(
      { section: "character", completed: kb.characters.length, total: kb.characters.length, label: "Characters complete" },
      { ...result },
    );
  }

  // ── Phase 3: Beat alignment ──
  const activeFwCount = activeFrameworks.length;
  if (activeFwCount > 0) {
    onProgress(
      { section: "beat", completed: 0, total: activeFwCount * 6, label: "Analyzing beats..." },
      { ...result },
    );

    const beatResults = await analyzeBeatAlignment(content, activeFrameworks, targetPages, totalLines, service);
    result.beatAlignment = beatResults;

    onProgress(
      { section: "beat", completed: activeFwCount * 6, total: activeFwCount * 6, label: "Beats complete" },
      { ...result },
    );
  }

  // ── Phase 4: Dialogue quality ──
  const dialogueScenes = scenes.filter(s => /^[A-Z][A-Z0-9 ']{0,40}$/m.test(s.text));
  if (dialogueScenes.length > 0) {
    onProgress(
      { section: "dialogue", completed: 0, total: Math.ceil(dialogueScenes.length / 2), label: "Analyzing dialogue..." },
      { ...result },
    );

    const dialogueResults = await analyzeDialogueQuality(scenes, service);
    result.dialogueQuality = dialogueResults;

    onProgress(
      { section: "dialogue", completed: Math.ceil(dialogueScenes.length / 2), total: Math.ceil(dialogueScenes.length / 2), label: "Dialogue complete" },
      { ...result },
    );
  }

  // ── Overall score ──
  const scores: number[] = [];
  if (result.pacing) scores.push(result.pacing.overallScore);
  if (result.characterConsistency.length > 0) {
    scores.push(result.characterConsistency.reduce((s, r) => s + r.score, 0) / result.characterConsistency.length);
  }
  if (result.beatAlignment.length > 0) {
    scores.push(result.beatAlignment.reduce((s, r) => s + r.score, 0) / result.beatAlignment.length);
  }
  if (result.dialogueQuality.length > 0) {
    const avgDialogue = result.dialogueQuality.reduce(
      (s, r) => s + (r.subtext + r.naturalness + r.distinctiveness) / 3,
      0,
    ) / result.dialogueQuality.length;
    scores.push(avgDialogue);
  }
  result.overallScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

  saveCachedAnalysis(result);
  return result;
}
