import { TextAiService, type TextCompleteOptions } from "./textAiService";
import { KnowledgeBaseService, type KnowledgeBase } from "./knowledgeBase";
import { StyleProfileService, type StyleProfile } from "./styleProfile";
import { extractShotScenes, type ShotSceneBlock, type ShotPassProgress } from "./shotDirectionService";
import { extractCharacters } from "./scriptStructure";
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

// ---------------------------------------------------------------------------
// Scoped scene-description fill. Instead of rewriting every scene (slow, and it
// touches dialogue/action handled elsewhere), this pass only ensures each
// INT./EXT. scene OPENS with a short visual description of the LOCATION — the
// thing the asset-gen "describe" pass needs. It detects the genre once, finds
// scenes that jump straight into a shot / character cue / character action (no
// establishing description), generates a 1-2 sentence setting description for
// each (batched), and inserts it right under the heading.
// ---------------------------------------------------------------------------

const SHOT_TOKEN = /^(WS|MS|CU|ECU|LS|OTS|POV)\b/;
function isAllCapsLine(t: string): boolean { return /[A-Z]/.test(t) && t === t.toUpperCase(); }
function cueKey(t: string): string { return t.replace(/\s*\([^)]*\)\s*$/, "").trim().toUpperCase(); }

function characterNames(content: string, kb: KnowledgeBase | null): Set<string> {
  const names = new Set<string>();
  for (const c of extractCharacters(content)) names.add(c.name.toUpperCase());
  for (const c of kb?.characters ?? []) { const n = c.name.trim().toUpperCase(); if (n) names.add(n); }
  return names;
}

// True when a scene does NOT open with descriptive prose about the location —
// i.e. the first body line is blank, a shot, a character cue, or character
// action (a line starting with a character's name).
export function sceneNeedsDescription(scene: ShotSceneBlock, names: Set<string>): boolean {
  const body = scene.text.split("\n").slice(1);
  const first = body.map((l) => l.trim()).find((l) => l !== "");
  if (!first) return true;
  if (first.startsWith("!!") || (SHOT_TOKEN.test(first) && isAllCapsLine(first))) return true;
  if (names.has(cueKey(first))) return true;
  if (isAllCapsLine(first)) return true;
  const firstWord = (first.split(/[\s,.!?;:]+/)[0] || "").toUpperCase();
  if (names.has(firstWord)) return true; // "Aliyah …" — character action, not a setting line
  return false;
}

function insertDescriptionAfterHeading(sceneText: string, description: string): string {
  const lines = sceneText.split("\n");
  const heading = lines[0];
  const rest = lines.slice(1);
  while (rest.length && rest[0].trim() === "") rest.shift();
  return [heading, "", description.trim(), "", ...rest].join("\n");
}

function stripToJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let t = fenced ? fenced[1] : text;
  const a = t.indexOf("{");
  const b = t.lastIndexOf("}");
  if (a >= 0 && b > a) t = t.slice(a, b + 1);
  return t.trim();
}

function parseSceneDescriptions(text: string): Map<number, string> {
  const map = new Map<number, string>();
  try {
    const obj = JSON.parse(stripToJson(text)) as { descriptions?: Array<{ id?: number; description?: string }> };
    for (const d of obj.descriptions ?? []) {
      if (typeof d.id === "number" && d.description && d.description.trim()) {
        map.set(d.id, d.description.trim().replace(/\s+/g, " "));
      }
    }
  } catch { /* leave empty — the batch is skipped */ }
  return map;
}

async function detectGenre(content: string, complete: PassCompletion): Promise<string> {
  const system = `You identify the genre and tone of a screenplay. Reply with ONLY a short phrase (e.g. "coming-of-age dramedy", "neo-noir thriller", "whimsical family fantasy"). No other text.`;
  const user = `Screenplay excerpt:\n---\n${content.slice(0, 5000)}\n---\nGenre and tone:`;
  const raw = await complete(system, user, { temperature: 0, maxTokens: 40, timeoutMs: EXPAND_TIMEOUT_MS });
  return raw.replace(/^["'\s]+|["'\s.]+$/g, "").split("\n")[0].slice(0, 80).trim();
}

function buildSceneDescriptionPrompt(
  batch: Array<{ id: number; heading: string; clue: string }>,
  genre: string,
  kb: KnowledgeBase | null,
  style: StyleProfile | null,
): { system: string; user: string; maxTokens: number } {
  const kbText = kb ? KnowledgeBaseService.serializeForPrompt(kb, 3000) : "";
  const styleText = style ? StyleProfileService.serializeForPrompt(style) : "";
  const system = `You write SHORT establishing scene descriptions for a screenplay so a downstream image generator knows what each location looks like. For each scene, write 1-2 sentences of CONCRETE, FILMABLE visual detail about the LOCATION and its atmosphere — set dressing, light, mood. Do NOT describe character actions, do NOT write camera/shot directions, do NOT write dialogue, do NOT start with a character's name. Use the scene's existing content as clues; where there are none, use tasteful detail appropriate to the ${genre || "story's"} genre, consistent with any location already established. Return ONLY valid JSON.`;
  const scenesJson = batch.map((b) => ({ id: b.id, heading: b.heading, existing: b.clue.slice(0, 500) }));
  const user = `Genre/tone: ${genre || "unspecified"}.
${kbText ? `\nStory knowledge base:\n${kbText}\n` : ""}${styleText ? `\nStyle:\n${styleText}\n` : ""}
Write a location description for each scene below. Return JSON exactly:
{"descriptions":[{"id":<id>,"description":"<1-2 sentence visual setting description>"}]}

Scenes:
${JSON.stringify(scenesJson, null, 1)}`;
  return { system, user, maxTokens: 1200 + batch.length * 120 };
}

export async function fillSceneDescriptions(
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

  // 1-2. Genre — from the KB if set, otherwise one quick detection call.
  let genre = (knowledgeBase?.toneStyle?.genre || "").trim();
  if (!genre) {
    onProgress?.({ completed: 0, total: 1, label: "Reading the script and detecting genre…" });
    try { genre = await detectGenre(content, complete); } catch { genre = ""; }
  }

  // 3-5. Scenes that open without a setting description.
  const names = characterNames(content, knowledgeBase);
  const needing = scenes
    .map((scene, index) => ({ scene, index }))
    .filter(({ scene }) => sceneNeedsDescription(scene, names));
  if (needing.length === 0) return content;

  const descByIndex = new Map<number, string>();
  const BATCH = 8;
  for (let b = 0; b < needing.length; b += BATCH) {
    const slice = needing.slice(b, b + BATCH);
    onProgress?.({ completed: b, total: needing.length, label: `Describing ${Math.min(b + BATCH, needing.length)} of ${needing.length} scenes…` });
    const batch = slice.map(({ scene, index }) => ({
      id: index,
      heading: scene.heading,
      clue: scene.text.split("\n").slice(1).join("\n").trim(),
    }));
    const prompt = buildSceneDescriptionPrompt(batch, genre, knowledgeBase, styleProfile);
    try {
      const raw = await complete(prompt.system, prompt.user, { temperature: 0.5, maxTokens: prompt.maxTokens, timeoutMs: EXPAND_TIMEOUT_MS });
      for (const [id, desc] of parseSceneDescriptions(raw)) descByIndex.set(id, desc);
    } catch {
      // Skip this batch; keep whatever else succeeds rather than failing the run.
    }
  }

  const outScenes = scenes.map((scene, index) => {
    const desc = descByIndex.get(index);
    return desc ? insertDescriptionAfterHeading(scene.text, desc) : scene.text;
  });
  const parts: string[] = [];
  if (preamble.trim()) parts.push(preamble.trimEnd());
  parts.push(...outScenes);
  return parts.join("\n\n");
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
