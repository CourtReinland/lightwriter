export type AssetProvider = "gemini-nano-banana" | "grok-imagine";

export type AssetKind = "scene_set" | "character" | "prop" | "shot";

export interface ScriptRef {
  scriptHash: string;
  sceneHeading?: string;
  sceneIndex?: number;
  sceneStartLine?: number;
  sceneEndLine?: number;
  characterName?: string;
  shotLine?: string;
  shotLineNumber?: number;
  contentExcerpt?: string;
}

export interface AssetGenerationMetadata {
  promptVersion: number;
  aspectRatio?: string;
  stylePreset?: string;
  seed?: string | number;
  providerRequestId?: string;
  safetyInfo?: string;
  script2ScreenShotKey?: string;
  handoffStatus?: "local" | "exported" | "imported-by-script2screen";
  script2ScreenExportedAt?: number;
  [key: string]: unknown;
}

export interface GeneratedAsset {
  id: string;
  projectId: string;
  kind: AssetKind;
  provider: AssetProvider;
  model: string;
  name: string;
  prompt: string;
  negativePrompt?: string;
  mimeType: string;
  imageDataUrl?: string;
  filePath?: string;
  createdAt: number;
  updatedAt: number;
  scriptRef: ScriptRef;
  metadata: AssetGenerationMetadata;
}
