import { useEffect, useMemo, useState } from "react";
import type { GeneratedAsset, AssetProvider, AssetKind } from "../../types/assets";
import { AssetService } from "../../services/assetService";
import {
  extractCharacters,
  extractScriptScenes,
  extractShotLines,
  simpleScriptHash,
  type ScriptCharacterRef,
  type ScriptSceneRef,
  type ScriptShotRef,
} from "../../services/scriptStructure";
import { buildLightWriterPackage, buildScript2ScreenManifest, exportJsonDownload } from "../../services/assetManifestExporter";
import {
  buildGeneratedAssetFromResult,
  clearImageProviderApiKey,
  generateImageAsset,
  getImageModelOptions,
  getImageProviderSettings,
  listGeminiImageModels,
  providerLabel,
  saveImageProviderSettings,
  type ImageGenerationRequest,
} from "../../services/imageGenerationService";
import { downloadImageDataUrl, persistGeneratedImageFile } from "../../services/imageAssetStorageService";
import { generateReviewedAssetPrompt } from "../../services/llmAssetPromptService";
import type { Project } from "../../services/storageService";
import { StyleReferenceService, type ScriptStyleReference } from "../../services/styleReferenceService";
import "./AssetPanel.css";

interface AssetPanelProps {
  project: Project;
  assets: GeneratedAsset[];
  onAssetsChange: (assets: GeneratedAsset[]) => void;
}

type SourceKind = "scene_set" | "character" | "shot";

function providerOptions(): AssetProvider[] {
  return ["gemini-nano-banana", "grok-imagine"];
}

function assetName(asset: GeneratedAsset): string {
  const ref = asset.scriptRef;
  return asset.kind === "character" ? ref.characterName || asset.name : ref.sceneHeading || asset.name;
}

function isKnownModel(modelOptions: { id: string }[], model: string): boolean {
  return modelOptions.some((option) => option.id === model);
}

export default function AssetPanel({ project, assets, onAssetsChange }: AssetPanelProps) {
  const [provider, setProvider] = useState<AssetProvider>("gemini-nano-banana");
  const [sourceKind, setSourceKind] = useState<SourceKind>("scene_set");
  const [selectedKey, setSelectedKey] = useState("0");
  const [userPrompt, setUserPrompt] = useState("");
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [customModel, setCustomModel] = useState("");
  const [modelOptions, setModelOptions] = useState(() => getImageModelOptions("gemini-nano-banana"));
  const [isPollingModels, setIsPollingModels] = useState(false);
  const [styleReference, setStyleReference] = useState<ScriptStyleReference | null>(() => StyleReferenceService.get(project.id));
  const [settingsMessage, setSettingsMessage] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isGeneratingPrompt, setIsGeneratingPrompt] = useState(false);
  const [promptOverride, setPromptOverride] = useState("");

  const scenes = useMemo(() => extractScriptScenes(project.content), [project.content]);
  const characters = useMemo(() => extractCharacters(project.content), [project.content]);
  const shots = useMemo(() => extractShotLines(project.content), [project.content]);
  const scriptHash = useMemo(() => simpleScriptHash(project.content), [project.content]);
  const effectiveModel = selectedModel === "custom" ? customModel.trim() : selectedModel;
  const hasStoredKey = Boolean(getImageProviderSettings(provider).apiKey?.trim());

  useEffect(() => {
    const settings = getImageProviderSettings(provider);
    const options = getImageModelOptions(provider);
    const model = settings.selectedModel || "";
    setModelOptions(options);
    setApiKeyDraft(settings.apiKey || "");
    setSelectedModel(model && isKnownModel(options, model) ? model : model ? "custom" : "");
    setCustomModel(model && isKnownModel(options, model) ? "" : model);
    setSettingsMessage("");
  }, [provider]);

  useEffect(() => {
    setStyleReference(StyleReferenceService.get(project.id));
  }, [project.id]);

  const choices = sourceKind === "character" ? characters : sourceKind === "shot" ? shots : scenes;
  const selected = choices[Number(selectedKey)] || choices[0];

  useEffect(() => {
    setPromptOverride("");
  }, [selectedKey, sourceKind, userPrompt, project.content, styleReference]);

  const prompt = promptOverride;

  const refreshAssets = () => onAssetsChange(AssetService.getAssets(project.id));

  const handleSaveProviderSettings = () => {
    saveImageProviderSettings(provider, {
      apiKey: apiKeyDraft.trim(),
      selectedModel: effectiveModel,
    });
    setSettingsMessage(`${providerLabel(provider)} settings saved locally.`);
  };

  const handlePollGeminiModels = async () => {
    if (provider !== "gemini-nano-banana") return;
    const apiKey = apiKeyDraft.trim() || getImageProviderSettings(provider).apiKey || "";
    if (!apiKey.trim()) {
      setSettingsMessage("Paste and save a Gemini API key before polling live models.");
      return;
    }
    setIsPollingModels(true);
    setSettingsMessage("Polling Gemini for available image models...");
    try {
      const options = await listGeminiImageModels(apiKey);
      setModelOptions(options);
      if (!isKnownModel(options, effectiveModel)) {
        setSelectedModel(options[0]?.id || "");
        setCustomModel("");
      }
      setSettingsMessage(`Loaded ${options.length} Gemini image model options from the API.`);
    } catch (error) {
      setSettingsMessage(error instanceof Error ? error.message : "Gemini model polling failed.");
    } finally {
      setIsPollingModels(false);
    }
  };

  const handleClearProviderKey = () => {
    clearImageProviderApiKey(provider);
    setApiKeyDraft("");
    setSettingsMessage(`${providerLabel(provider)} API key cleared.`);
  };

  const handleStyleReferenceChange = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setSettingsMessage("Style reference must be an image file.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      if (!dataUrl) return;
      const saved = StyleReferenceService.save(project.id, { name: file.name, mimeType: file.type, dataUrl });
      setStyleReference(saved);
      setSettingsMessage(`Script style reference saved: ${file.name}`);
    };
    reader.onerror = () => setSettingsMessage("Could not read style reference image.");
    reader.readAsDataURL(file);
  };

  const handleClearStyleReference = () => {
    StyleReferenceService.clear(project.id);
    setStyleReference(null);
    setSettingsMessage("Script style reference cleared.");
  };

  const buildAssetRequestForChoice = (choice: ScriptSceneRef | ScriptCharacterRef | ScriptShotRef, promptText: string): ImageGenerationRequest | null => {
    if (!choice || !promptText.trim()) return null;
    const kind: AssetKind = sourceKind === "shot" ? "shot" : sourceKind;
    const scene = choice as ScriptSceneRef;
    const character = choice as ScriptCharacterRef;
    const shot = choice as ScriptShotRef;
    return {
      projectId: project.id,
      kind,
      provider,
      model: effectiveModel,
      name:
        sourceKind === "character"
          ? character.name
          : sourceKind === "shot"
            ? shot.shotKey
            : scene.heading,
      prompt: promptText,
      scriptRef:
        sourceKind === "character"
          ? { scriptHash, characterName: character.name, contentExcerpt: character.evidence.join("\n") }
          : sourceKind === "shot"
            ? {
                scriptHash,
                sceneHeading: shot.sceneHeading,
                sceneIndex: shot.sceneIndex,
                shotLine: shot.text,
                shotLineNumber: shot.lineNumber,
                contentExcerpt: shot.text,
              }
            : {
                scriptHash,
                sceneHeading: scene.heading,
                sceneIndex: scene.sceneIndex,
                sceneStartLine: scene.startLine,
                sceneEndLine: scene.endLine,
                contentExcerpt: scene.description,
              },
      aspectRatio: sourceKind === "character" ? "2:3" : "16:9",
      styleReference,
    };
  };

  const buildPromptForChoice = async (choice: ScriptSceneRef | ScriptCharacterRef | ScriptShotRef): Promise<string> => {
    return generateReviewedAssetPrompt({
      kind: sourceKind,
      scene: sourceKind === "scene_set" ? (choice as ScriptSceneRef) : undefined,
      character: sourceKind === "character" ? (choice as ScriptCharacterRef) : undefined,
      shot: sourceKind === "shot" ? (choice as ScriptShotRef) : undefined,
      fullScriptContent: project.content,
      styleReference,
      userPrompt,
    });
  };

  const handleGenerateLlmPrompt = async () => {
    if (!selected) return;
    setIsGeneratingPrompt(true);
    setSettingsMessage("LLM prompt pass 1 drafting, pass 2 reviewing against LightWriter rules...");
    try {
      const nextPrompt = await buildPromptForChoice(selected as ScriptSceneRef | ScriptCharacterRef | ScriptShotRef);
      setPromptOverride(nextPrompt);
      setSettingsMessage("LLM prompt drafted and reviewed. You can edit it before generating.");
    } catch (error) {
      setSettingsMessage(error instanceof Error ? error.message : "LLM prompt generation failed.");
    } finally {
      setIsGeneratingPrompt(false);
    }
  };

  const buildCurrentAssetRequest = () => {
    if (!selected) return null;
    return buildAssetRequestForChoice(selected as ScriptSceneRef | ScriptCharacterRef | ScriptShotRef, prompt);
  };

  const handleStageAsset = () => {
    const request = buildCurrentAssetRequest();
    if (!request) {
      setSettingsMessage("Generate or write a reviewed prompt before staging metadata.");
      return;
    }
    const asset = AssetService.addAsset(project.id, {
      ...buildGeneratedAssetFromResult(request, { mimeType: "image/png" }),
      metadata: {
        ...buildGeneratedAssetFromResult(request, { mimeType: "image/png" }).metadata,
        script2ScreenShotKey:
          sourceKind === "shot"
            ? (selected as ScriptShotRef).shotKey
            : sourceKind === "scene_set"
              ? `s${(selected as ScriptSceneRef).sceneIndex}_sh0`
              : undefined,
        styleReferenceName: styleReference?.name,
        hasStyleReference: Boolean(styleReference),
      },
    });
    onAssetsChange([...assets, asset]);
    setSettingsMessage("Prompt metadata staged locally. Use Generate Image to call the provider.");
  };

  const saveGeneratedAssetFromRequest = async (request: ImageGenerationRequest): Promise<GeneratedAsset> => {
    const result = await generateImageAsset(request);
    const filePath = await persistGeneratedImageFile({
      projectId: request.projectId,
      name: request.name,
      mimeType: result.mimeType,
      dataUrl: result.imageDataUrl,
    });
    const generated = buildGeneratedAssetFromResult(request, { ...result, filePath: filePath || result.filePath });
    return AssetService.addAsset(project.id, {
      ...generated,
      metadata: {
        ...generated.metadata,
        script2ScreenShotKey:
          request.kind === "shot"
            ? request.scriptRef.shotLine
              ? request.name
              : undefined
            : request.kind === "scene_set"
              ? `s${request.scriptRef.sceneIndex}_sh0`
              : undefined,
        styleReferenceName: styleReference?.name,
        hasStyleReference: Boolean(styleReference),
      },
    });
  };

  const handleGenerateAsset = async () => {
    if (!selected) return;
    if (!effectiveModel.trim()) {
      setSettingsMessage("Poll Gemini models or enter a custom model ID before generating.");
      return;
    }
    setIsGenerating(true);
    setSettingsMessage(prompt.trim() ? `Generating image with ${providerLabel(provider)}...` : "No prompt yet: running LLM draft + LLM rule review first...");
    try {
      const finalPrompt = prompt.trim() || (await buildPromptForChoice(selected as ScriptSceneRef | ScriptCharacterRef | ScriptShotRef));
      if (!prompt.trim()) setPromptOverride(finalPrompt);
      const request = buildAssetRequestForChoice(selected as ScriptSceneRef | ScriptCharacterRef | ScriptShotRef, finalPrompt);
      if (!request) return;
      const asset = await saveGeneratedAssetFromRequest(request);
      onAssetsChange([...assets, asset]);
      setSettingsMessage(asset.filePath ? `Image generated and saved: ${asset.filePath}` : "Image generated and saved to Project Assets. Use Download Image to save a file.");
    } catch (error) {
      setSettingsMessage(error instanceof Error ? error.message : "Image generation failed.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateAll = async () => {
    if (choices.length === 0) return;
    if (!effectiveModel.trim()) {
      setSettingsMessage("Poll Gemini models or enter a custom model ID before generating all.");
      return;
    }
    setIsGenerating(true);
    setSettingsMessage(`Generating ${choices.length} ${sourceKind} asset${choices.length === 1 ? "" : "s"}...`);
    const generatedAssets: GeneratedAsset[] = [];
    try {
      for (const choice of choices as Array<ScriptSceneRef | ScriptCharacterRef | ScriptShotRef>) {
        const finalPrompt = await buildPromptForChoice(choice);
        const request = buildAssetRequestForChoice(choice, finalPrompt);
        if (!request) continue;
        const asset = await saveGeneratedAssetFromRequest(request);
        generatedAssets.push(asset);
        setSettingsMessage(`Generated ${generatedAssets.length}/${choices.length}: ${asset.name}`);
      }
      onAssetsChange([...assets, ...generatedAssets]);
      setSettingsMessage(`Generate All complete: ${generatedAssets.length} image${generatedAssets.length === 1 ? "" : "s"} saved.`);
    } catch (error) {
      onAssetsChange([...assets, ...generatedAssets]);
      setSettingsMessage(error instanceof Error ? `Generate All stopped after ${generatedAssets.length}: ${error.message}` : "Generate All failed.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDelete = (assetId: string) => {
    AssetService.deleteAsset(project.id, assetId);
    refreshAssets();
  };

  const handleExportLightWriterPackage = () => {
    const pkg = buildLightWriterPackage({ project, assets });
    exportJsonDownload(pkg, `${project.name.replace(/[^a-zA-Z0-9_-]/g, "_")}.lightwriter-package.json`);
  };

  const handleExportScript2ScreenManifest = () => {
    const manifest = buildScript2ScreenManifest({ resolveProjectName: project.name, assets });
    exportJsonDownload(manifest, `${project.name.replace(/[^a-zA-Z0-9_-]/g, "_")}.script2screen-manifest.json`);
  };

  return (
    <aside className="asset-panel">
      <div className="asset-panel-header">
        <div>
          <h2>AI Assets</h2>
          <p>Generate and tag sets, characters, and shot start frames for Script2Screen.</p>
        </div>
      </div>

      <section className="asset-settings-box">
        <h3>Provider Settings</h3>
        <p className="asset-muted">
          Keys and model choices are saved locally in this LightWriter app profile. They are not exported in packages.
        </p>
        <label>
          Provider
          <select value={provider} onChange={(event) => setProvider(event.target.value as AssetProvider)}>
            {providerOptions().map((item) => (
              <option key={item} value={item}>{providerLabel(item)}</option>
            ))}
          </select>
        </label>
        <label>
          API key
          <input
            type="password"
            value={apiKeyDraft}
            onChange={(event) => setApiKeyDraft(event.target.value)}
            placeholder={hasStoredKey ? "Stored locally" : `Paste ${providerLabel(provider)} API key`}
          />
        </label>
        <label>
          Image model
          <select value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)}>
            <option value="">Poll models first...</option>
            {modelOptions.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
            <option value="custom">Custom model ID...</option>
          </select>
        </label>
        {selectedModel === "custom" && (
          <label>
            Custom model ID
            <input
              value={customModel}
              onChange={(event) => setCustomModel(event.target.value)}
              placeholder="provider-specific-model-id"
            />
          </label>
        )}
        <p className="asset-muted">Selected model: {effectiveModel || "none yet — poll Gemini models or enter a custom model ID"}</p>
        <div className="asset-settings-actions">
          <button onClick={handleSaveProviderSettings}>Save Settings</button>
          {provider === "gemini-nano-banana" && (
            <button onClick={handlePollGeminiModels} disabled={isPollingModels}>
              {isPollingModels ? "Polling..." : "Poll Gemini Models"}
            </button>
          )}
          <button onClick={handleClearProviderKey}>Clear Key</button>
        </div>
        {settingsMessage && <p className="asset-status">{settingsMessage}</p>}
      </section>

      <label>
        Asset source
        <select
          value={sourceKind}
          onChange={(event) => {
            setSourceKind(event.target.value as SourceKind);
            setSelectedKey("0");
          }}
        >
          <option value="scene_set">Scene set from headings</option>
          <option value="character">Character from script</option>
          <option value="shot">Shot start frame</option>
        </select>
      </label>

      <label>
        Script reference
        <select value={selectedKey} onChange={(event) => setSelectedKey(event.target.value)}>
          {choices.map((choice, index) => (
            <option key={index} value={String(index)}>
              {sourceKind === "character"
                ? (choice as ScriptCharacterRef).name
                : sourceKind === "shot"
                  ? `${(choice as ScriptShotRef).shotKey} ${(choice as ScriptShotRef).text}`
                  : (choice as ScriptSceneRef).heading}
            </option>
          ))}
        </select>
      </label>

      <label>
        User prompt additions
        <textarea
          value={userPrompt}
          onChange={(event) => setUserPrompt(event.target.value)}
          placeholder="Add visual style, era, camera/lens, palette, wardrobe, exclusions..."
        />
      </label>

      <section className="asset-settings-box asset-style-reference-box">
        <h3>Script Style Reference</h3>
        <p className="asset-muted">
          Optional look reference for the whole script. Scene prompts will ask providers to use it for palette, texture, mood, and continuity.
        </p>
        <label>
          Reference image
          <input type="file" accept="image/*" onChange={(event) => handleStyleReferenceChange(event.target.files?.[0])} />
        </label>
        {styleReference && (
          <div className="asset-style-reference-preview">
            <img src={styleReference.dataUrl} alt="Script style reference" />
            <div>
              <strong>{styleReference.name}</strong>
              <span>{styleReference.mimeType}</span>
              <button onClick={handleClearStyleReference}>Clear Reference</button>
            </div>
          </div>
        )}
      </section>

      <label>
        Editable generated prompt
        <textarea
          className="asset-prompt"
          value={prompt}
          onChange={(event) => setPromptOverride(event.target.value)}
          placeholder="Click Generate/Review Prompt to run the two-step LLM prompt builder, or write your final provider prompt here."
        />
      </label>

      <div className="asset-generation-actions">
        <button onClick={handleGenerateLlmPrompt} disabled={!selected || isGeneratingPrompt || isGenerating}>
          {isGeneratingPrompt ? "Reviewing Prompt..." : "Generate/Review Prompt"}
        </button>
        <button className="asset-primary" onClick={handleGenerateAsset} disabled={!selected || isGenerating || isGeneratingPrompt}>
          {isGenerating ? "Generating..." : "Generate Image"}
        </button>
        <button className="asset-primary" onClick={handleGenerateAll} disabled={choices.length === 0 || isGenerating || isGeneratingPrompt}>
          Generate All
        </button>
        <button onClick={handleStageAsset} disabled={!selected || isGenerating || isGeneratingPrompt}>
          Stage Prompt Only
        </button>
      </div>

      <div className="asset-export-row">
        <button onClick={handleExportLightWriterPackage}>Export LW Package</button>
        <button onClick={handleExportScript2ScreenManifest}>Export STS Manifest</button>
      </div>

      <div className="asset-list">
        <h3>Project Assets ({assets.length})</h3>
        {assets.length === 0 && <p className="asset-empty">No generated/staged assets yet.</p>}
        {assets.map((asset) => (
          <div className="asset-card" key={asset.id}>
            {asset.imageDataUrl && <img className="asset-card-preview" src={asset.imageDataUrl} alt={asset.name} />}
            <div>
              <strong>{assetName(asset)}</strong>
              <span>{asset.kind} · {providerLabel(asset.provider)}</span>
              <span>{asset.model}</span>
              {asset.metadata.script2ScreenShotKey && <em>{asset.metadata.script2ScreenShotKey}</em>}
              {asset.filePath ? <code className="asset-file-path">{asset.filePath}</code> : asset.imageDataUrl && <code className="asset-file-path">Stored in LightWriter app data; use Download Image for a copy.</code>}
            </div>
            <div className="asset-card-actions">
              {asset.imageDataUrl && <button onClick={() => downloadImageDataUrl({ name: asset.name, mimeType: asset.mimeType, dataUrl: asset.imageDataUrl })}>Download Image</button>}
              <button onClick={() => handleDelete(asset.id)}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
