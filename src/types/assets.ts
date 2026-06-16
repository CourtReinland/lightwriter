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
  /** Scene-level key for ScriptToScreen locations{} (0-based scene index as string). Used for scene_set backgrounds. */
  script2ScreenSceneKey?: string;
  /** Human-facing location/scene name carried into the ScriptToScreen locations entry description. */
  locationName?: string;
  /** Durable filesystem path of the style reference used to generate this asset (Electron only). */
  styleReferencePath?: string;
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
