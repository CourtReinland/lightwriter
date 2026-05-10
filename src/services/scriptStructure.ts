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
const CAMERA_CUE_RE = /^(?:CU|MS|WS|ECU|OTS|POV|INSERT|ANGLE|TRACKING|DOLLY|PAN|TILT|WIDE SHOT|MEDIUM SHOT|CLOSE UP|CLOSE-UP|EXTREME CLOSE UP)\b/i;
const PAREN_CHARACTER_DETAIL_RE = /\b[A-Z][A-Z0-9 '\-.]{1,30}\s*\([^)]+\)/g;
const TRANSITION_RE = /^(CUT TO:|FADE OUT\.?|FADE IN:?|DISSOLVE TO:)$/i;
const HUMAN_ACTION_SUBJECT_RE = /\b(?:he|she|they|we|i|you|man|woman|boy|girl|child|kid|teen|mother|father|mom|dad|person|people|[A-Z][a-z]+)\b\s+(?:sits?|sat|stands?|stood|walks?|runs?|moves?|goes?|turns?|looks?|watches?|waits?|reads?|writes?|holds?|takes?|puts?|starts?|begins?|cries|crying|sobs?|sniffles?|sniffling|sighs?|smiles?|frowns?|laughs?|speaks?|says?|whispers?|shouts?|enters?|exits?|has|had|is|are|was|were)\b/i;
const READABLE_TEXT_RE = /\b(?:book cover|cover|sign|poster|screen|letter|note|page|label|logo)\s+(?:reads?|says?|states?|shows?)\b/i;
const ENVIRONMENTAL_SUBJECT_RE = /\b(?:wind|rain|lightning|thunder|storm|snow|fog|mist|smoke|dust|leaves|grass|waves|water|fire|flames|shadows?|sunlight|moonlight|neon|lamps?|candles?|curtains?|doors?|windows?)\b/i;

function sentenceFragments(text: string): string[] {
  return text
    .replace(PAREN_CHARACTER_DETAIL_RE, "")
    .split(/(?<=[.!?])\s+/)
    .map((fragment) => fragment.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function isPersonActionSentence(sentence: string): boolean {
  if (READABLE_TEXT_RE.test(sentence)) return true;
  if (ENVIRONMENTAL_SUBJECT_RE.test(sentence)) return false;
  return HUMAN_ACTION_SUBJECT_RE.test(sentence);
}

function cleanBackgroundDescription(text: string): string {
  return sentenceFragments(text)
    .filter((sentence) => !isPersonActionSentence(sentence))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function inferScriptTone(content = ""): string {
  const lower = content.toLowerCase();
  const signals: string[] = [];
  if (/children|kids?|cartoon|animated|animation|playful|toy|storybook|exaggerated|sniffling|melodramatic/.test(lower)) signals.push("children's cartoon");
  if (/gothic|manor|moor|fog|ancient|haunted|storm|candle|shadow/.test(lower)) signals.push("gothic romance");
  if (/love|romance|kiss|heart|desire|wedding|rose/.test(lower)) signals.push("romantic drama");
  if (/spaceship|planet|android|alien|neon|cyber/.test(lower)) signals.push("science fiction");
  if (/magic|kingdom|dragon|witch|prophecy|enchanted/.test(lower)) signals.push("fantasy");
  if (/murder|detective|crime|noir|blood|gun/.test(lower)) signals.push("crime thriller");
  if (/school|cafe|apartment|city street|office/.test(lower)) signals.push("grounded contemporary drama");
  if (signals.length === 0) return "cinematic screenplay tone inferred from genre, setting, pacing, and recurring imagery";
  return Array.from(new Set(signals)).join(", ");
}

function titleCaseSignal(signal: string): string {
  return signal
    .split(/\s+/)
    .map((word) => (word ? `${word.charAt(0).toUpperCase()}${word.slice(1)}` : word))
    .join(" ");
}

function compactLocation(scene: ScriptSceneRef): string {
  return (scene.location || scene.heading)
    .replace(/\b(INT\.|EXT\.|EST\.|INT\.\/EXT\.|I\/E\.)\b/gi, "")
    .replace(/\s+-\s+[A-Z0-9 .]+$/i, "")
    .replace(/,/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function inferredBackgroundResult(scene: ScriptSceneRef, fullScriptContent?: string): string {
  const tone = inferScriptTone(fullScriptContent);
  const primaryTone = tone.split(",")[0].trim();
  const location = compactLocation(scene);
  const time = (scene.timeOfDay || "").trim().toLowerCase();
  const tonePrefix = primaryTone ? titleCaseSignal(primaryTone) : "Cinematic";
  const timePhrase = time ? ` at ${time}` : "";
  const base = `${tonePrefix} ${location || "screenplay location"}${timePhrase}`.replace(/\s+/g, " ").trim();

  if (primaryTone === "children's cartoon") {
    return `${base}, empty background, bright playful home interior, cozy couch and furniture, rounded cartoon shapes, colorful storybook props, soft daylight, cheerful production design, 16:9.`;
  }
  if (primaryTone === "gothic romance") {
    return `${base}, empty background, candlelit architecture, moody period set dressing, aged textures, deep shadows, atmospheric fog, ornate props, dramatic cinematic palette, 16:9.`;
  }
  if (primaryTone === "romantic drama") {
    return `${base}, empty background, warm practical lighting, intimate set dressing, soft color palette, lived-in props, cinematic interior atmosphere, 16:9.`;
  }
  if (primaryTone === "science fiction") {
    return `${base}, empty background, futuristic architecture, controlled light panels, advanced props, sleek surfaces, atmospheric depth, 16:9.`;
  }
  if (primaryTone === "fantasy") {
    return `${base}, empty background, enchanted architecture, textured handmade props, atmospheric lighting, magical environment detail, 16:9.`;
  }
  if (primaryTone === "crime thriller") {
    return `${base}, empty background, tense practical lighting, noir shadows, gritty set dressing, suspenseful atmosphere, 16:9.`;
  }
  if (primaryTone === "grounded contemporary drama") {
    return `${base}, empty background, realistic modern set dressing, natural light, believable props, lived-in surfaces, 16:9.`;
  }
  return `${base}, empty background, architecture, props, set dressing, lighting, atmosphere, color palette, texture, era cues, cinematic production design, 16:9.`;
}

function backgroundDetailOrInference(scene: ScriptSceneRef, fullScriptContent?: string): string {
  const detail = cleanBackgroundDescription(scene.description);
  if (detail) return `Scene background: ${detail}`;
  return inferredBackgroundResult(scene, fullScriptContent);
}

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
    let insideDialogue = false;
    const description = bodyLines
      .map((line) => line.trim())
      .filter((line) => {
        if (!line) {
          insideDialogue = false;
          return false;
        }
        if (FORCED_SHOT_RE.test(line) || TRANSITION_RE.test(line)) return false;
        if (CHARACTER_CUE_RE.test(line)) {
          insideDialogue = true;
          return false;
        }
        if (insideDialogue) return false;
        return true;
      })
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

function isLikelyCharacterCue(lines: string[], index: number, cueName: string): boolean {
  const trimmed = lines[index].trim();
  const name = cueName.trim().toUpperCase();
  if (["INT", "EXT", "EST", "CUT TO", "FADE OUT", "FADE IN", "DISSOLVE TO"].includes(name)) return false;
  if (parseSceneHeading(trimmed) || FORCED_SHOT_RE.test(trimmed) || TRANSITION_RE.test(trimmed) || CAMERA_CUE_RE.test(trimmed)) return false;
  if (name.length > 30) return false;

  for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex += 1) {
    const next = lines[nextIndex].trim();
    if (!next) continue;
    if (parseSceneHeading(next) || FORCED_SHOT_RE.test(next) || TRANSITION_RE.test(next) || CAMERA_CUE_RE.test(next)) return false;
    if (CHARACTER_CUE_RE.test(next)) return false;
    return true;
  }

  return false;
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
    if (!isLikelyCharacterCue(lines, index, name)) return;
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
  | {
      kind: Extract<AssetKind, "scene_set">;
      scene: ScriptSceneRef;
      userPrompt?: string;
      fullScriptContent?: string;
      styleReference?: { name: string; mimeType: string; dataUrl: string } | null;
    }
  | { kind: Extract<AssetKind, "character">; character: ScriptCharacterRef; userPrompt?: string },
): string {
  if (input.kind === "scene_set") {
    const base = [
      `Empty scene background for ${input.scene.heading}.`,
      backgroundDetailOrInference(input.scene, input.fullScriptContent),
      input.styleReference
        ? `Match the style reference palette, texture, lighting, and lens mood; do not copy its objects or composition.`
        : "",
      input.userPrompt ? input.userPrompt : "",
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
