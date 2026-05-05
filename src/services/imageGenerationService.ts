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

export interface ImageProviderSettings {
  provider: AssetProvider;
  apiKey?: string;
  selectedModel: string;
  updatedAt: number;
}

export interface ImageModelOption {
  id: string;
  label: string;
  description: string;
}

const SETTINGS_KEY = "lw-image-provider-settings";

const MODEL_OPTIONS: Record<AssetProvider, ImageModelOption[]> = {
  "gemini-nano-banana": [
    {
      id: "gemini-2.5-flash-image",
      label: "Gemini 2.5 Flash Image / Nano Banana",
      description: "Default fast image model target for scene sets and characters.",
    },
    {
      id: "gemini-2.5-flash-image-preview",
      label: "Gemini 2.5 Flash Image Preview",
      description: "Preview model name option for Google image-generation accounts that expose it.",
    },
    {
      id: "gemini-2.0-flash-preview-image-generation",
      label: "Gemini 2.0 Flash Preview Image Generation",
      description: "Fallback image-generation preview model name used by some Gemini API setups.",
    },
  ],
  "grok-imagine": [
    {
      id: "grok-imagine-latest",
      label: "Grok Imagine Latest",
      description: "Default Grok Imagine target for fast creative image generation.",
    },
    {
      id: "grok-2-image-1212",
      label: "Grok 2 Image 1212",
      description: "xAI image model name option for accounts exposing the image generation API.",
    },
  ],
};

const DEFAULT_MODELS: Record<AssetProvider, string> = {
  "gemini-nano-banana": MODEL_OPTIONS["gemini-nano-banana"][0].id,
  "grok-imagine": MODEL_OPTIONS["grok-imagine"][0].id,
};

function readAllSettings(): Partial<Record<AssetProvider, ImageProviderSettings>> {
  if (typeof localStorage === "undefined") return {};
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Partial<Record<AssetProvider, ImageProviderSettings>>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveAllSettings(settings: Partial<Record<AssetProvider, ImageProviderSettings>>): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function providerLabel(provider: AssetProvider): string {
  return provider === "gemini-nano-banana" ? "Gemini / Nano Banana" : "Grok Imagine";
}

export function getImageModelOptions(provider: AssetProvider): ImageModelOption[] {
  return MODEL_OPTIONS[provider];
}

export function getDefaultImageModel(provider: AssetProvider): string {
  return DEFAULT_MODELS[provider];
}

export function getImageProviderSettings(provider: AssetProvider): ImageProviderSettings {
  const stored = readAllSettings()[provider];
  return {
    provider,
    apiKey: stored?.apiKey || "",
    selectedModel: stored?.selectedModel || getDefaultImageModel(provider),
    updatedAt: stored?.updatedAt || 0,
  };
}

export function saveImageProviderSettings(provider: AssetProvider, updates: Partial<ImageProviderSettings>): ImageProviderSettings {
  const all = readAllSettings();
  const current = getImageProviderSettings(provider);
  const next: ImageProviderSettings = {
    ...current,
    ...updates,
    provider,
    selectedModel: updates.selectedModel || current.selectedModel || getDefaultImageModel(provider),
    updatedAt: Date.now(),
  };
  all[provider] = next;
  saveAllSettings(all);
  return next;
}

export function clearImageProviderApiKey(provider: AssetProvider): ImageProviderSettings {
  return saveImageProviderSettings(provider, { apiKey: "" });
}

export function hasImageProviderApiKey(provider: AssetProvider): boolean {
  return Boolean(getImageProviderSettings(provider).apiKey?.trim());
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
    model: request.model || getImageProviderSettings(request.provider).selectedModel || getDefaultImageModel(request.provider),
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
