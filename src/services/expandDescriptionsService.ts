import { TextAiService, type TextCompleteOptions } from "./textAiService";
import { KnowledgeBaseService, type KnowledgeBase } from "./knowledgeBase";
import { StyleProfileService, type StyleProfile } from "./styleProfile";
import { extractShotScenes, type ShotSceneBlock, type ShotPassProgress } from "./shotDirectionService";
import type { TextAiProviderSettings } from "./textAiSettingsService";

const EXPAND_TIMEOUT_MS = 240_000;

type PassCompletion = (systemPrompt: string, userMessage: string, options?: TextCompleteOptions) => Promise<string>;

export function formatExpandError(scene: ShotSceneBlock, sceneNumber: number, totalScenes: number, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error || "Unknown error");
  return new Error(`Expand descriptions failed on scene ${sceneNumber}/${totalScenes} (${scene.heading}): ${message}`);
}

export function buildExpandDescriptionsPrompt(args: {
  scene: ShotSceneBlock;
  previousHeading?: string;
  nextHeading?: string;
  knowledgeBase: KnowledgeBase | null;
  styleProfile: StyleProfile | null;
}): { system: string; user: string; temperature: number; maxTokens: number } {
  const kbText = args.knowledgeBase ? KnowledgeBaseService.serializeForPrompt(args.knowledgeBase, 5000) : "";
  const styleText = args.styleProfile ? StyleProfileService.serializeForPrompt(args.styleProfile) : "";

  const system = `You are a screenplay description editor preparing a script for downstream AI image/video generation.

Your job is to rewrite ONE scene so its VISUAL descriptions are concrete and complete. Return ONLY the rewritten scene text.

WHAT TO DEEPEN:
- Scene-setting/action lines: make the location, time of day, lighting, weather, set dressing, and key props explicit and filmable. No empty or vague scene description.
- Character-introduction action: the first time a character acts in this scene, ground them with a brief concrete visual (age range, wardrobe, distinguishing look) consistent with the knowledge base — only if not already established nearby.
- Action beats: turn thin or abstract action ("things change", "it gets tense") into observable, photographable action.

HARD RULES:
- Preserve the scene heading, all dialogue, character cue lines, parentheticals, transitions, and existing !! shot lines EXACTLY. Do not reword dialogue.
- Do NOT add new !! shot lines or camera directions — that is a separate pass. Only enrich prose action/description lines.
- Do NOT invent new plot events, new characters, or new dialogue. Only make what already happens visually concrete.
- Do NOT leave any action/description beat blank or purely abstract; every described moment should give an image generator something to render.
- Match the writer's established voice and the style contract below. Keep additions proportional — enrich, do not bloat.
- Do not summarize, explain, or wrap in markdown. Return only the rewritten scene.`;

  const contextLines = [
    args.previousHeading ? `Previous scene: ${args.previousHeading}` : "Previous scene: none",
    args.nextHeading ? `Next scene: ${args.nextHeading}` : "Next scene: none",
  ];
  if (styleText) contextLines.push(styleText);
  if (kbText) contextLines.push(kbText);

  const user = `${contextLines.join("\n\n")}\n\nDeepen the visual descriptions in this scene without changing story or dialogue:\n---\n${args.scene.text}\n---`;

  return {
    system,
    user,
    temperature: 0.4,
    maxTokens: Math.max(2500, Math.min(6000, Math.ceil(args.scene.text.length * 1.8))),
  };
}

function cleanSceneRewrite(text: string): string {
  return text
    .trim()
    .replace(/^```(?:fountain|text)?\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .trim();
}

export async function rewriteScriptWithExpandedDescriptions(
  content: string,
  settings: TextAiProviderSettings,
  knowledgeBase: KnowledgeBase | null,
  styleProfile: StyleProfile | null,
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
      label: `Deepening descriptions in scene ${i + 1}/${scenes.length}: ${scene.heading}`,
    });

    const prompt = buildExpandDescriptionsPrompt({
      scene,
      previousHeading: scenes[i - 1]?.heading,
      nextHeading: scenes[i + 1]?.heading,
      knowledgeBase,
      styleProfile,
    });

    let rewritten: string;
    try {
      rewritten = await complete(prompt.system, prompt.user, {
        temperature: prompt.temperature,
        maxTokens: prompt.maxTokens,
        timeoutMs: EXPAND_TIMEOUT_MS,
      });
    } catch (error) {
      throw formatExpandError(scene, i + 1, scenes.length, error);
    }

    rewrittenScenes.push(cleanSceneRewrite(rewritten) || scene.text);

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
