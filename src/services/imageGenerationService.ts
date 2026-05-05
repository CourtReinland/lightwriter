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
  styleReference?: { name: string; mimeType: string; dataUrl: string } | null;
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
      label: "Gemini Flash 2.5 / Nano Banana",
      description: "Standard Nano Banana image model target for scene sets and characters.",
    },
    {
      id: "gemini-3.1-flash-image",
      label: "Gemini Flash 3.1 / Nano Banana 2",
      description: "Nano Banana 2 flash image model target when available on the configured Gemini account.",
    },
    {
      id: "gemini-3-pro-image",
      label: "Gemini 3 Pro / Nano Banana 2",
      description: "Higher quality Nano Banana 2 / Gemini Pro image model target when available.",
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

function normalizeGeminiModelName(name: string): string {
  return name.replace(/^models\//, "");
}

function isGeminiImageModel(model: { name?: string; displayName?: string; description?: string; supportedGenerationMethods?: string[] }): boolean {
  const haystack = `${model.name || ""} ${model.displayName || ""} ${model.description || ""}`.toLowerCase();
  return (
    Boolean(model.supportedGenerationMethods?.includes("generateContent")) &&
    (haystack.includes("image") || haystack.includes("nano banana")) &&
    !haystack.includes("embedding")
  );
}

export async function listGeminiImageModels(apiKey: string): Promise<ImageModelOption[]> {
  const key = apiKey.trim();
  if (!key) return getImageModelOptions("gemini-nano-banana");

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`);
  if (!response.ok) {
    throw new Error(`Gemini model polling failed: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as {
    models?: Array<{
      name?: string;
      displayName?: string;
      description?: string;
      supportedGenerationMethods?: string[];
    }>;
  };

  const dynamicModels = (data.models || [])
    .filter((model) => model.name && isGeminiImageModel(model))
    .map((model) => ({
      id: normalizeGeminiModelName(model.name || ""),
      label: model.displayName || normalizeGeminiModelName(model.name || ""),
      description: model.description || "Gemini API image-capable model returned by the live models endpoint.",
    }));

  const byId = new Map<string, ImageModelOption>();
  for (const option of dynamicModels) byId.set(option.id, option);
  for (const option of getImageModelOptions("gemini-nano-banana")) {
    if (!byId.has(option.id)) byId.set(option.id, option);
  }
  return Array.from(byId.values());
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

function dataUrlPayload(dataUrl: string): { mimeType: string; data: string } | null {
  const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}

function geminiInlineImagePart(data: unknown): { mimeType: string; data: string } | null {
  const candidates = (data as { candidates?: Array<{ content?: { parts?: Array<Record<string, unknown>> } }> }).candidates || [];
  for (const candidate of candidates) {
    for (const part of candidate.content?.parts || []) {
      const inlineData = (part.inlineData || part.inline_data) as { mimeType?: string; mime_type?: string; data?: string } | undefined;
      if (inlineData?.data) {
        return { mimeType: inlineData.mimeType || inlineData.mime_type || "image/png", data: inlineData.data };
      }
    }
  }
  return null;
}

async function generateGeminiImageAsset(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
  const settings = getImageProviderSettings("gemini-nano-banana");
  const apiKey = settings.apiKey?.trim();
  if (!apiKey) throw new Error("Save a Gemini API key before generating images.");
  const model = request.model || settings.selectedModel || getDefaultImageModel("gemini-nano-banana");
  const parts: Array<Record<string, unknown>> = [];
  const referencePayload = request.styleReference?.dataUrl ? dataUrlPayload(request.styleReference.dataUrl) : null;
  if (referencePayload) {
    parts.push({
      text:
        "Create a new image from the final scene prompt below. The attached image is a STYLE REFERENCE ONLY: use only its color palette, texture, lighting mood, and lens feel. Do not copy its subject, background, objects, layout, composition, characters, scenery, or location.",
    });
    parts.push({ inlineData: { mimeType: request.styleReference?.mimeType || referencePayload.mimeType, data: referencePayload.data } });
  }
  parts.push({ text: `${request.prompt}${request.aspectRatio ? `\nAspect ratio: ${request.aspectRatio}.` : ""}` });

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
      }),
    },
  );
  if (!response.ok) throw new Error(`Gemini image generation failed: ${response.status} ${response.statusText}`);
  const data = await response.json();
  const inlineImage = geminiInlineImagePart(data);
  if (!inlineImage) throw new Error("Gemini did not return an inline image payload.");
  return {
    mimeType: inlineImage.mimeType,
    imageDataUrl: `data:${inlineImage.mimeType};base64,${inlineImage.data}`,
  };
}

export async function generateImageAsset(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
  if (request.provider === "gemini-nano-banana") return generateGeminiImageAsset(request);
  throw new Error("Grok Imagine generation is not wired yet. Use Gemini / Nano Banana generation or stage the prompt metadata for now.");
}
