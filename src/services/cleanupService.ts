import { TextAiService, type TextCompleteOptions } from "./textAiService";
import { KnowledgeBaseService, type KnowledgeBase } from "./knowledgeBase";
import { extractShotScenes, type ShotSceneBlock, type ShotPassProgress } from "./shotDirectionService";
import type { TextAiProviderSettings } from "./textAiSettingsService";

const CLEANUP_TIMEOUT_MS = 240_000;

type PassCompletion = (systemPrompt: string, userMessage: string, options?: TextCompleteOptions) => Promise<string>;

export function formatCleanupError(scene: ShotSceneBlock, sceneNumber: number, totalScenes: number, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error || "Unknown error");
  return new Error(`Clean up failed on scene ${sceneNumber}/${totalScenes} (${scene.heading}): ${message}`);
}

/**
 * Deterministic safety pass: collapse immediately-consecutive identical shot lines
 * (same !! text, nothing between them). The AI handles the nuanced cases; this guarantees
 * the obvious exact-duplicate-shot case is always removed even if the model misses it.
 */
export function collapseDuplicateShotLines(sceneText: string): string {
  const lines = sceneText.split("\n");
  const out: string[] = [];
  let lastShot: string | null = null;
  for (const line of lines) {
    const trimmed = line.trim();
    const isShot = /^!!/.test(trimmed);
    if (isShot && trimmed === lastShot) {
      continue; // drop exact-duplicate consecutive shot line
    }
    out.push(line);
    if (isShot) {
      lastShot = trimmed;
    } else if (trimmed) {
      lastShot = null; // any non-empty non-shot line breaks the adjacency
    }
  }
  return out.join("\n");
}

export function buildCleanupPrompt(args: {
  scene: ShotSceneBlock;
  knowledgeBase: KnowledgeBase | null;
}): { system: string; user: string; temperature: number; maxTokens: number } {
  const kbText = args.knowledgeBase ? KnowledgeBaseService.serializeForPrompt(args.knowledgeBase, 3000) : "";

  const system = `You are a meticulous screenplay copy editor. Clean up ONE scene. Return ONLY the cleaned scene text.

FIX:
- Spelling, grammar, punctuation, and capitalization errors.
- Obvious typos and doubled words.
- Unnecessary duplications: repeated or near-identical lines; consecutive !! shot lines that describe the same framing with no action or dialogue between them (keep the single most complete one); redundant restatements of the same action back-to-back.

DO NOT:
- Change the story, the meaning of any dialogue, or a character's voice.
- Rewrite for style, expand, compress, or add new content.
- Add or remove !! shot lines except to delete a redundant duplicate as described above.
- Alter the scene heading, character cue lines, parentheticals, or transitions other than fixing clear typos.
- Wrap in markdown or add commentary.

Preserve Fountain formatting markers exactly (!! for shots, @ for forced characters, > for transitions). Return only the cleaned scene.`;

  const user = `${kbText ? kbText + "\n\n" : ""}Clean up this scene (grammar, spelling, and redundant duplications only):\n---\n${args.scene.text}\n---`;

  return {
    system,
    user,
    temperature: 0.2,
    maxTokens: Math.max(2000, Math.min(6000, Math.ceil(args.scene.text.length * 1.5))),
  };
}

function cleanSceneRewrite(text: string): string {
  return text
    .trim()
    .replace(/^```(?:fountain|text)?\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .trim();
}

export async function rewriteScriptWithCleanup(
  content: string,
  settings: TextAiProviderSettings,
  knowledgeBase: KnowledgeBase | null,
  onProgress?: (progress: ShotPassProgress) => void,
  completeOverride?: PassCompletion,
): Promise<string> {
  const { preamble, scenes } = extractShotScenes(content);
  if (scenes.length === 0) return content;

  const service = new TextAiService(settings);
  const complete: PassCompletion = completeOverride ?? service.complete.bind(service);
  const rewrittenScenes: string[] = [];

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    onProgress?.({
      completed: i,
      total: scenes.length,
      label: `Cleaning scene ${i + 1}/${scenes.length}: ${scene.heading}`,
    });

    const prompt = buildCleanupPrompt({ scene, knowledgeBase });

    let rewritten: string;
    try {
      rewritten = await complete(prompt.system, prompt.user, {
        temperature: prompt.temperature,
        maxTokens: prompt.maxTokens,
        timeoutMs: CLEANUP_TIMEOUT_MS,
      });
    } catch (error) {
      throw formatCleanupError(scene, i + 1, scenes.length, error);
    }

    // AI cleanup first, then a deterministic guarantee against exact-duplicate consecutive shots.
    const aiCleaned = cleanSceneRewrite(rewritten) || scene.text;
    rewrittenScenes.push(collapseDuplicateShotLines(aiCleaned));

    onProgress?.({
      completed: i + 1,
      total: scenes.length,
      label: `Completed scene ${i + 1}/${scenes.length}`,
    });
  }

  const parts: string[] = [];
  if (preamble.trim()) parts.push(preamble.trimEnd());
  parts.push(...rewrittenScenes);
  return parts.join("\n\n");
}
