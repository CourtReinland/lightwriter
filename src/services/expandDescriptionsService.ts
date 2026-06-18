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

// Time-of-day / continuation tokens that don't identify a location.
const TIME_TOKENS = /\b(DAY|NIGHT|MORNING|AFTERNOON|EVENING|DUSK|DAWN|MIDDAY|MIDNIGHT|LATER|CONTINUOUS|SAME|NOW|MOMENTS)\b/g;

// Reduce a scene heading to a stable location key so scenes set in the same place
// can share a visual reference (e.g. "INT. KITCHEN - DAY" and "INT. KITCHEN - NIGHT").
export function normalizeLocationKey(heading: string): string {
  let h = (heading || "").toUpperCase().trim();
  h = h.replace(/^\.?\s*/, "");
  h = h.replace(/^(INT\.?\/EXT\.?|EXT\.?\/INT\.?|I\/E\.?|INT\.?|EXT\.?|EST\.?)\s*/, "");
  h = h.replace(TIME_TOKENS, "");
  h = h.replace(/[\s,.\-–—]+/g, " ").trim();
  return h;
}

// For each scene whose location appears elsewhere, point it at the richest
// same-location scene as a visual reference, so invented descriptions stay
// consistent with how that place already looks in the script.
export function buildLocationReferences(scenes: ShotSceneBlock[]): Map<number, string> {
  const byKey = new Map<string, number[]>();
  scenes.forEach((s, i) => {
    const key = normalizeLocationKey(s.heading);
    if (!key) return;
    const arr = byKey.get(key) || [];
    arr.push(i);
    byKey.set(key, arr);
  });

  const refForScene = new Map<number, string>();
  for (const indices of byKey.values()) {
    if (indices.length < 2) continue;
    let bestIdx = indices[0];
    for (const idx of indices) {
      if (scenes[idx].text.length > scenes[bestIdx].text.length) bestIdx = idx;
    }
    const refText = scenes[bestIdx].text.slice(0, 1000).trim();
    if (!refText) continue;
    for (const idx of indices) {
      if (idx !== bestIdx) refForScene.set(idx, refText);
    }
  }
  return refForScene;
}

export function buildExpandDescriptionsPrompt(args: {
  scene: ShotSceneBlock;
  previousHeading?: string;
  nextHeading?: string;
  knowledgeBase: KnowledgeBase | null;
  styleProfile: StyleProfile | null;
  locationReference?: string;
}): { system: string; user: string; temperature: number; maxTokens: number } {
  const kbText = args.knowledgeBase ? KnowledgeBaseService.serializeForPrompt(args.knowledgeBase, 5000) : "";
  const styleText = args.styleProfile ? StyleProfileService.serializeForPrompt(args.styleProfile) : "";

  const system = `You are a screenplay description editor preparing a script for downstream AI image/video generation.

Your job is to rewrite ONE scene so its VISUAL descriptions are concrete, complete, and never missing. Return ONLY the rewritten scene text.

WHAT TO DO:
- DEEPEN existing scene-setting/action lines: make location, time of day, lighting, weather, set dressing, and key props explicit and filmable.
- INVENT where missing: if the scene has little or no establishing description (e.g. just a heading followed by dialogue or shots), WRITE a vivid 1-3 sentence establishing description of the location and atmosphere, placed right after the scene heading. Make a confident, specific guess at what the scene looks like by reading every available cue: the scene heading (INT/EXT, place, time of day), who is speaking and acting, what the dialogue and action imply is happening, any !! shot lines, the previous/next scenes, how this same location appears elsewhere in the script (see VISUAL REFERENCE if provided), and the knowledge base. Never leave a scene with no description because none was written — infer one.
- GROUND characters: the first time a character acts or speaks in this scene, give a brief concrete visual (age range, wardrobe, distinguishing look) consistent with the knowledge base, if not already established nearby.
- Turn thin or abstract action ("things change", "it gets tense") into observable, photographable action.

WHAT YOU MAY INVENT (encouraged): the physical look of locations, lighting, weather, time-of-day atmosphere, set dressing, props, character appearance and wardrobe, and small ambient/background detail — as long as it fits the script and knowledge base.

WHAT YOU MUST NOT INVENT: new plot events or story beats, new spoken dialogue, or new named/speaking characters. Do not change WHAT happens or WHO is present — only describe HOW it looks.

HARD RULES:
- Preserve the scene heading, all dialogue, character cue lines, parentheticals, transitions, and existing !! shot lines EXACTLY. Do not reword dialogue.
- Do NOT add new !! shot lines or camera directions — that is a separate pass. Only write prose action/description lines.
- Every scene must end up with a concrete establishing description and no blank or purely abstract beats; give an image generator something specific to render.
- Match the writer's established voice and the style contract below. Keep additions proportional — vivid, not bloated.
- Do not summarize, explain, or wrap in markdown. Return only the rewritten scene.`;

  const contextLines = [
    args.previousHeading ? `Previous scene: ${args.previousHeading}` : "Previous scene: none",
    args.nextHeading ? `Next scene: ${args.nextHeading}` : "Next scene: none",
  ];
  if (args.locationReference) {
    contextLines.push(
      `VISUAL REFERENCE — this location appears elsewhere in the script; match its established look (do NOT copy its dialogue or action, only reuse the visual feel of the place):\n${args.locationReference}`,
    );
  }
  if (styleText) contextLines.push(styleText);
  if (kbText) contextLines.push(kbText);

  const user = `${contextLines.join("\n\n")}\n\nDeepen existing descriptions AND invent vivid scene-setting wherever this scene has none, inferring the look from the cues above — without changing the story or any dialogue:\n---\n${args.scene.text}\n---`;

  return {
    system,
    user,
    temperature: 0.5,
    maxTokens: Math.max(2500, Math.min(6000, Math.ceil(args.scene.text.length * 2.2))),
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
  const locationRefs = buildLocationReferences(scenes);
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
      locationReference: locationRefs.get(i),
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
