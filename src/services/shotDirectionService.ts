import { GrokService } from "./grokService";
import { KnowledgeBaseService, type KnowledgeBase } from "./knowledgeBase";

export interface ShotSceneBlock {
  idx: number;
  heading: string;
  text: string;
  startLine: number;
  endLine: number;
}

export interface ShotPassProgress {
  completed: number;
  total: number;
  label: string;
}

const SCENE_PATTERN = /^\.((?!\.)\S)|^(INT|EXT|EST|INT\.\/EXT|I\/E)[.\s]/i;

export function extractShotScenes(content: string): { preamble: string; scenes: ShotSceneBlock[] } {
  const lines = content.split("\n");
  const sceneStarts: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (SCENE_PATTERN.test(lines[i].trim())) sceneStarts.push(i);
  }

  if (sceneStarts.length === 0) {
    return {
      preamble: "",
      scenes: content.trim()
        ? [{ idx: 0, heading: "SCRIPT", text: content, startLine: 0, endLine: lines.length - 1 }]
        : [],
    };
  }

  const preamble = lines.slice(0, sceneStarts[0]).join("\n");
  const scenes: ShotSceneBlock[] = [];

  for (let i = 0; i < sceneStarts.length; i++) {
    const start = sceneStarts[i];
    const endExclusive = sceneStarts[i + 1] ?? lines.length;
    scenes.push({
      idx: i,
      heading: lines[start].trim().replace(/^\.\s*/, ""),
      text: lines.slice(start, endExclusive).join("\n"),
      startLine: start,
      endLine: endExclusive - 1,
    });
  }

  return { preamble, scenes };
}

export function buildShotRewritePrompt(args: {
  scene: ShotSceneBlock;
  previousHeading?: string;
  nextHeading?: string;
  knowledgeBase: KnowledgeBase | null;
}): { system: string; user: string; temperature: number; maxTokens: number } {
  const kbText = args.knowledgeBase
    ? KnowledgeBaseService.serializeForPrompt(args.knowledgeBase, 5000)
    : "";

  const system = `You are a professional shooting-script pass editor for a screenplay-to-image/video generation workflow.

Your job is to rewrite ONE scene by adding a complete, filmable shot plan as Fountain forced-shot lines. Return ONLY the rewritten scene text.

CRITICAL OUTPUT RULES:
- Preserve the original scene heading, action, character names, dialogue, parentheticals, transitions, and story order.
- Do not summarize. Do not explain. Do not wrap in markdown.
- Keep existing shot lines that start with !! unless they are clearly malformed.
- Add missing shot direction lines before the action/dialogue beats they cover.
- Every added shot line MUST start with !! so it is parsed as a Fountain shot.
- Use the compact shot vocabulary primarily as: WS, MS, CU.
- Use OTS coverage by spelling it inside an MS shot, e.g. !!MS OVER MARA'S SHOULDER ON AIDEN AS HE HESITATES.
- Use camera movement or composition in natural language after the shot size when useful, e.g. !!WS TRACKING WITH AIDEN THROUGH THE CROWD.
- Write shot lines in uppercase: !!SHOT CHARACTER NAME ACTION IN CONTEXT.

COVERAGE STANDARD:
- Add enough shots for a downstream image/video generator to create and sync the scene visually.
- Establish each new location or geography with WS when appropriate.
- Use MS for blocking, dialogue coverage, and character action.
- Use CU for reactions, important objects, emotional turns, clues, and tactile details.
- For dialogue, add practical coverage: two-shots when useful, over-the-shoulder singles, reaction CUs, and inserts for significant props.
- For complex action, add rapid camera changes and movement shots at each meaningful visual beat.
- Do not add shots to title-page metadata or non-scene front matter.
- Do not over-explain the camera; each shot line should be concise and directly filmable.`;

  const contextLines = [
    args.previousHeading ? `Previous scene: ${args.previousHeading}` : "Previous scene: none",
    args.nextHeading ? `Next scene: ${args.nextHeading}` : "Next scene: none",
  ];

  if (kbText) contextLines.push(kbText);

  const user = `${contextLines.join("\n\n")}\n\nRewrite this scene with full professional shot direction coverage:\n---\n${args.scene.text}\n---`;

  return {
    system,
    user,
    temperature: 0.45,
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

export async function rewriteScriptWithShotDirections(
  content: string,
  apiKey: string,
  knowledgeBase: KnowledgeBase | null,
  onProgress?: (progress: ShotPassProgress) => void,
): Promise<string> {
  const { preamble, scenes } = extractShotScenes(content);
  if (scenes.length === 0) return content;

  const service = new GrokService(apiKey);
  const rewrittenScenes: string[] = [];

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    onProgress?.({
      completed: i,
      total: scenes.length,
      label: `Adding shots to scene ${i + 1}/${scenes.length}: ${scene.heading}`,
    });

    const prompt = buildShotRewritePrompt({
      scene,
      previousHeading: scenes[i - 1]?.heading,
      nextHeading: scenes[i + 1]?.heading,
      knowledgeBase,
    });

    const rewritten = await service.complete(prompt.system, prompt.user, {
      temperature: prompt.temperature,
      maxTokens: prompt.maxTokens,
    });

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
