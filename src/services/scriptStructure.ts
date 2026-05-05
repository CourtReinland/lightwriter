import type { AssetKind } from "../types/assets";

export interface ScriptSceneRef {
  sceneIndex: number;
  heading: string;
  locationType: string;
  location: string;
  timeOfDay: string;
  startLine: number;
  endLine: number;
  description: string;
}

export interface ScriptShotRef {
  shotKey: string;
  sceneIndex: number;
  shotIndex: number;
  sceneHeading: string;
  lineNumber: number;
  text: string;
}

export interface ScriptCharacterRef {
  name: string;
  description: string;
  firstLine: number;
  evidence: string[];
}

const SCENE_HEADING_RE = /^(INT\.|EXT\.|EST\.|INT\.\/EXT\.|I\/E\.)\s+(.+?)(?:\s+-\s+([A-Z0-9 .]+))?$/i;
const FORCED_SHOT_RE = /^!!\s*(.+)$/;
const CHARACTER_CUE_RE = /^@?([A-Z][A-Z0-9 '\-.]{1,40})(?:\s*\(([^)]+)\))?$/;
const DESCRIPTION_WITH_NAME_RE = /\b([A-Z][A-Z0-9 '\-.]{1,30})\s*\(([^)]+)\)/g;

function linesOf(content: string): string[] {
  return content.replace(/\r\n/g, "\n").split("\n");
}

function parseSceneHeading(line: string) {
  const match = line.trim().match(SCENE_HEADING_RE);
  if (!match) return null;
  return {
    locationType: match[1].toUpperCase(),
    location: match[2].trim().replace(/\s+/g, " "),
    timeOfDay: (match[3] || "").trim(),
  };
}

export function simpleScriptHash(content: string): string {
  let hash = 5381;
  for (let i = 0; i < content.length; i += 1) {
    hash = (hash * 33) ^ content.charCodeAt(i);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function extractScriptScenes(content: string): ScriptSceneRef[] {
  const lines = linesOf(content);
  const starts: Array<{ lineIndex: number; heading: string; parsed: ReturnType<typeof parseSceneHeading> }> = [];

  lines.forEach((line, index) => {
    const parsed = parseSceneHeading(line);
    if (parsed) starts.push({ lineIndex: index, heading: line.trim().toUpperCase(), parsed });
  });

  return starts.map((start, sceneIndex) => {
    const next = starts[sceneIndex + 1];
    const endLine = next ? next.lineIndex : lines.length - 1;
    const bodyLines = lines.slice(start.lineIndex + 1, endLine + 1);
    const description = bodyLines
      .map((line) => line.trim())
      .filter((line) => line && !FORCED_SHOT_RE.test(line) && !CHARACTER_CUE_RE.test(line))
      .slice(0, 4)
      .join(" ");

    return {
      sceneIndex,
      heading: start.heading,
      locationType: start.parsed?.locationType || "",
      location: start.parsed?.location || "",
      timeOfDay: start.parsed?.timeOfDay || "",
      startLine: start.lineIndex + 1,
      endLine: endLine + 1,
      description,
    };
  });
}

export function extractShotLines(content: string): ScriptShotRef[] {
  const lines = linesOf(content);
  const scenes = extractScriptScenes(content);
  const shotCounts = new Map<number, number>();
  const shots: ScriptShotRef[] = [];

  lines.forEach((line, index) => {
    const match = line.trim().match(FORCED_SHOT_RE);
    if (!match) return;

    const lineNumber = index + 1;
    const scene =
      [...scenes].reverse().find((candidate) => candidate.startLine <= lineNumber && candidate.endLine >= lineNumber) ||
      scenes[0];
    if (!scene) return;

    const shotIndex = shotCounts.get(scene.sceneIndex) || 0;
    shotCounts.set(scene.sceneIndex, shotIndex + 1);
    shots.push({
      shotKey: `s${scene.sceneIndex}_sh${shotIndex}`,
      sceneIndex: scene.sceneIndex,
      shotIndex,
      sceneHeading: scene.heading,
      lineNumber,
      text: match[1].trim(),
    });
  });

  return shots;
}

export function extractCharacters(content: string): ScriptCharacterRef[] {
  const lines = linesOf(content);
  const byName = new Map<string, ScriptCharacterRef>();

  lines.forEach((line, index) => {
    const trimmed = line.trim();

    const descriptionMatches = Array.from(trimmed.matchAll(DESCRIPTION_WITH_NAME_RE));
    for (const match of descriptionMatches) {
      const name = match[1].trim().toUpperCase();
      const description = match[2].trim();
      if (!byName.has(name)) {
        byName.set(name, { name, description, firstLine: index + 1, evidence: [trimmed] });
      }
    }

    if (parseSceneHeading(trimmed)) return;

    const cue = trimmed.match(CHARACTER_CUE_RE);
    if (!cue) return;
    const name = cue[1].trim().toUpperCase();
    if (["INT", "EXT", "EST", "CUT TO", "FADE OUT"].includes(name)) return;
    const description = cue[2]?.trim() || "";
    if (!byName.has(name)) {
      byName.set(name, { name, description, firstLine: index + 1, evidence: [trimmed] });
    } else if (description && !byName.get(name)?.description) {
      byName.set(name, { ...byName.get(name)!, description });
    }
  });

  return Array.from(byName.values()).sort((a, b) => a.firstLine - b.firstLine);
}

export function buildAssetPrompt(input:
  | { kind: Extract<AssetKind, "scene_set">; scene: ScriptSceneRef; userPrompt?: string }
  | { kind: Extract<AssetKind, "character">; character: ScriptCharacterRef; userPrompt?: string },
): string {
  if (input.kind === "scene_set") {
    const base = [
      `Generate a cinematic scene background / set image for Hollywood screenplay heading: ${input.scene.heading}.`,
      input.scene.description ? `Scene description: ${input.scene.description}` : "",
      "No text, no subtitles, no characters unless explicitly required by the scene description.",
      "Style: production design concept art, cinematic lighting, practical set detail, 16:9 frame.",
      input.userPrompt ? `User direction: ${input.userPrompt}` : "",
    ];
    return base.filter(Boolean).join("\n");
  }

  return [
    `Generate a character design image for ${input.character.name}.`,
    input.character.description ? `Script description: ${input.character.description}` : "Use screenplay context to infer a grounded cinematic look.",
    "Style: film character reference sheet, expressive face, costume silhouette, neutral background.",
    input.userPrompt ? `User direction: ${input.userPrompt}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
