import type { AssetProvider, GeneratedAsset } from "../types/assets";

export interface ImageGenerationRequest {
  projectId: string;
  kind: GeneratedAsset["kind"];
  provider: AssetProvider;
  model?: string;
  name: string;
  prompt: string;
  negativePrompt?: string;
  scriptRef: GeneratedAsset["scriptRef"];
  aspectRatio?: string;
  stylePreset?: string;
}

export interface ImageGenerationResult {
  imageDataUrl?: string;
  filePath?: string;
  mimeType: string;
  providerRequestId?: string;
  safetyInfo?: string;
}

const DEFAULT_MODELS: Record<AssetProvider, string> = {
  "gemini-nano-banana": "gemini-2.5-flash-image",
  "grok-imagine": "grok-imagine-latest",
};

export function providerLabel(provider: AssetProvider): string {
  return provider === "gemini-nano-banana" ? "Gemini / Nano Banana" : "Grok Imagine";
}

export function getDefaultImageModel(provider: AssetProvider): string {
  return DEFAULT_MODELS[provider];
}

export function buildGeneratedAssetFromResult(
  request: ImageGenerationRequest,
  result: ImageGenerationResult,
): GeneratedAsset {
  const now = Date.now();
  return {
    id: "",
    projectId: request.projectId,
    kind: request.kind,
    provider: request.provider,
    model: request.model || getDefaultImageModel(request.provider),
    name: request.name,
    prompt: request.prompt,
    negativePrompt: request.negativePrompt,
    mimeType: result.mimeType,
    imageDataUrl: result.imageDataUrl,
    filePath: result.filePath,
    createdAt: now,
    updatedAt: now,
    scriptRef: request.scriptRef,
    metadata: {
      promptVersion: 1,
      aspectRatio: request.aspectRatio,
      stylePreset: request.stylePreset,
      providerRequestId: result.providerRequestId,
      safetyInfo: result.safetyInfo,
      handoffStatus: "local",
    },
  };
}

export async function generateImageAsset(_request: ImageGenerationRequest): Promise<ImageGenerationResult> {
  throw new Error(
    "Image generation provider calls are not wired yet. This interface is ready for Gemini/Nano Banana and Grok Imagine adapters.",
  );
}
