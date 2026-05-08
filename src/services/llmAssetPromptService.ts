import { GrokService } from "./grokService";
import { getImageProviderSettings } from "./imageGenerationService";
import { buildAssetPrompt, extractCharacters, type ScriptCharacterRef, type ScriptSceneRef, type ScriptShotRef } from "./scriptStructure";

export type LlmPromptKind = "scene_set" | "character" | "shot";

export interface LlmAssetPromptRequest {
  kind: LlmPromptKind;
  scene?: ScriptSceneRef;
  character?: ScriptCharacterRef;
  shot?: ScriptShotRef;
  fullScriptContent: string;
  userPrompt?: string;
  styleReference?: { name: string; mimeType: string; dataUrl: string } | null;
}

export interface LlmAssetPromptProgress {
  index: number;
  total: number;
  phase: "start" | "complete";
  label: string;
}

const INSTRUCTION_RE = /\b(?:empty scene background for|generate |create |make |do not|don't|no characters?|no people|avoid|must|should|style reference|match the style reference|copy its|shot direction|user direction|script description|use screenplay context|return only|prompt|aspect ratio)\b/i;
const PLACEHOLDER_RE = /\b(?:description goes here|placeholder|tbd|to be determined|insert|fill in|n\/a)\b/i;
const SCENE_HEADING_RE = /(?:^|\s)(?:INT\.|EXT\.|EST\.|INT\.\/EXT\.|I\/E\.)\s+/i;

function stripCodeFences(text: string): string {
  return text
    .trim()
    .replace(/^```(?:text|json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

function extractTextOnly(raw: string): string {
  const cleaned = stripCodeFences(raw);
  try {
    const parsed = JSON.parse(cleaned) as { prompt?: string };
    if (typeof parsed.prompt === "string") return parsed.prompt.trim();
  } catch {
    // Plain-text model response is allowed.
  }
  return cleaned
    .replace(/^prompt\s*[:=-]\s*/i, "")
    .split("\n")
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean)
    .join(", ")
    .trim();
}

export function characterNamesFromScript(script: string): string[] {
  return extractCharacters(script).map((character) =>
    character.name
      .toLowerCase()
      .replace(/\b\w/g, (letter) => letter.toUpperCase()),
  );
}

export function promptViolations(prompt: string, characterNames: string[] = []): string[] {
  const violations: string[] = [];
  if (INSTRUCTION_RE.test(prompt)) violations.push("contains instruction-style wording");
  if (PLACEHOLDER_RE.test(prompt)) violations.push("contains placeholder wording");
  if (SCENE_HEADING_RE.test(prompt)) violations.push("contains screenplay scene heading");
  for (const name of characterNames) {
    if (!name.trim()) continue;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${escaped}\\b`, "i").test(prompt)) violations.push(`contains character name: ${name}`);
  }
  return violations;
}

function deterministicSeed(request: LlmAssetPromptRequest): string {
  if (request.kind === "scene_set" && request.scene) {
    return buildAssetPrompt({
      kind: "scene_set",
      scene: request.scene,
      fullScriptContent: request.fullScriptContent,
      styleReference: request.styleReference,
      userPrompt: request.userPrompt,
    });
  }
  if (request.kind === "character" && request.character) {
    return buildAssetPrompt({ kind: "character", character: request.character, userPrompt: request.userPrompt });
  }
  if (request.kind === "shot" && request.shot) {
    return [
      `Shot ${request.shot.shotKey} in ${request.shot.sceneHeading}`,
      request.shot.text,
      request.userPrompt || "",
    ]
      .filter(Boolean)
      .join("\n");
  }
  return request.userPrompt || "";
}

function sourceText(request: LlmAssetPromptRequest): string {
  if (request.kind === "scene_set" && request.scene) {
    return [
      `Scene heading: ${request.scene.heading}`,
      `Scene location: ${request.scene.location}`,
      `Time of day: ${request.scene.timeOfDay}`,
      `Scene excerpt: ${request.scene.description}`,
    ].join("\n");
  }
  if (request.kind === "shot" && request.shot) {
    return [`Scene heading: ${request.shot.sceneHeading}`, `Shot key: ${request.shot.shotKey}`, `Shot text: ${request.shot.text}`].join("\n");
  }
  if (request.kind === "character" && request.character) {
    return [`Character: ${request.character.name}`, `Description/evidence: ${request.character.evidence.join("\n")}`].join("\n");
  }
  return "";
}

function passOneSystem(): string {
  return `PASS 1 — screenplay-to-image-prompt drafting.
You are creating the visible image prompt that appears in LightWriter's Editable Generated Prompt box.
Return ONLY the prompt text, no labels, no markdown, no explanation.

For scene_set assets, produce a clean environmental/set/background prompt only.
For shot assets, produce a clean cinematic frame prompt.
For character assets, produce a clean character design prompt.

Critical output style:
- Write the final image prompt itself, not instructions to another model.
- Do not include phrases like "generate", "create", "empty scene background for", "do not", "no characters", "style reference", "match the style reference", "description goes here", or "user direction".
- For scene_set prompts, do not name characters and do not describe character actions, bodies, faces, emotions, or readable text.
- Use concrete visual nouns/adjectives: room, furniture, palette, lighting, era, materials, weather, set dressing, lens mood.
- Keep it concise: one comma-separated line under 70 words.`;
}

function passTwoSystem(characterNames: string[]): string {
  return `PASS 2 — rule-conformance reviewer and prompt cleaner.
You are the final gatekeeper for LightWriter's Editable Generated Prompt box.
Return ONLY the corrected image prompt text, no labels, no markdown, no explanation.

Hard rules:
- Remove ALL instruction-style wording: generate, create, make, do not, no characters, avoid, must, should, prompt, style reference, match the style reference, copy its composition.
- Remove screenplay scene headings such as INT., EXT., EST., INT./EXT., I/E.
- Remove placeholders such as "description goes here", TBD, insert, fill in.
- Remove character names: ${characterNames.length ? characterNames.join(", ") : "none detected"}.
- For scene_set prompts, the result must be only environment/background/set design, not people or actions.
- Keep environmental motion/weather if useful: rain, wind, lightning, fog, smoke, shadows, water, fire.
- Output one polished comma-separated visual prompt under 70 words.`;
}

async function generateReviewedAssetPromptWithService(request: LlmAssetPromptRequest, service: GrokService): Promise<string> {
  const characterNames = characterNamesFromScript(request.fullScriptContent);
  const seed = deterministicSeed(request);
  const draft = await service.complete(
    passOneSystem(),
    [
      `Asset kind: ${request.kind}`,
      "Script/source excerpt:",
      sourceText(request),
      "\nWhole-script context:",
      request.fullScriptContent.slice(0, 12000),
      "\nExisting deterministic seed to improve, not copy if it contains instructions:",
      seed,
      request.userPrompt ? `\nUser visual additions to preserve if valid: ${request.userPrompt}` : "",
    ].join("\n"),
    { temperature: 0.45, maxTokens: 600 },
  );

  const reviewed = await service.complete(
    passTwoSystem(characterNames),
    [
      "Draft prompt:",
      extractTextOnly(draft),
      "\nOriginal source excerpt for checking:",
      sourceText(request),
    ].join("\n"),
    { temperature: 0.15, maxTokens: 450 },
  );

  return extractTextOnly(reviewed);
}

function promptService(): GrokService {
  const apiKey = GrokService.getStoredApiKey() || getImageProviderSettings("grok-imagine").apiKey;
  if (!apiKey?.trim()) throw new Error("Set a Grok API key before generating LLM prompts.");
  return new GrokService(apiKey);
}

export async function generateReviewedAssetPrompt(request: LlmAssetPromptRequest): Promise<string> {
  return generateReviewedAssetPromptWithService(request, promptService());
}

function promptLabel(request: LlmAssetPromptRequest): string {
  if (request.kind === "scene_set" && request.scene) return request.scene.heading;
  if (request.kind === "shot" && request.shot) return request.shot.shotKey;
  if (request.kind === "character" && request.character) return request.character.name;
  return request.kind;
}

export async function generateReviewedAssetPrompts(
  requests: LlmAssetPromptRequest[],
  onProgress?: (progress: LlmAssetPromptProgress) => void,
): Promise<string[]> {
  const service = promptService();
  const prompts: string[] = [];
  for (let index = 0; index < requests.length; index += 1) {
    const request = requests[index];
    const label = promptLabel(request);
    onProgress?.({ index, total: requests.length, phase: "start", label });
    prompts.push(await generateReviewedAssetPromptWithService(request, service));
    onProgress?.({ index, total: requests.length, phase: "complete", label });
  }
  return prompts;
}
