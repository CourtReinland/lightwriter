import { useEffect, useMemo, useState } from "react";
import type { GeneratedAsset, AssetProvider, AssetKind } from "../../types/assets";
import { AssetService } from "../../services/assetService";
import {
  buildAssetPrompt,
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
  clearImageProviderApiKey,
  getDefaultImageModel,
  getImageModelOptions,
  getImageProviderSettings,
  providerLabel,
  saveImageProviderSettings,
} from "../../services/imageGenerationService";
import type { Project } from "../../services/storageService";
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

function isKnownModel(provider: AssetProvider, model: string): boolean {
  return getImageModelOptions(provider).some((option) => option.id === model);
}

export default function AssetPanel({ project, assets, onAssetsChange }: AssetPanelProps) {
  const [provider, setProvider] = useState<AssetProvider>("gemini-nano-banana");
  const [sourceKind, setSourceKind] = useState<SourceKind>("scene_set");
  const [selectedKey, setSelectedKey] = useState("0");
  const [userPrompt, setUserPrompt] = useState("");
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [selectedModel, setSelectedModel] = useState(getDefaultImageModel("gemini-nano-banana"));
  const [customModel, setCustomModel] = useState("");
  const [settingsMessage, setSettingsMessage] = useState("");

  const scenes = useMemo(() => extractScriptScenes(project.content), [project.content]);
  const characters = useMemo(() => extractCharacters(project.content), [project.content]);
  const shots = useMemo(() => extractShotLines(project.content), [project.content]);
  const scriptHash = useMemo(() => simpleScriptHash(project.content), [project.content]);
  const modelOptions = useMemo(() => getImageModelOptions(provider), [provider]);
  const effectiveModel = selectedModel === "custom" ? customModel.trim() || getDefaultImageModel(provider) : selectedModel;
  const hasStoredKey = Boolean(getImageProviderSettings(provider).apiKey?.trim());

  useEffect(() => {
    const settings = getImageProviderSettings(provider);
    const model = settings.selectedModel || getDefaultImageModel(provider);
    setApiKeyDraft(settings.apiKey || "");
    setSelectedModel(isKnownModel(provider, model) ? model : "custom");
    setCustomModel(isKnownModel(provider, model) ? "" : model);
    setSettingsMessage("");
  }, [provider]);

  const choices = sourceKind === "character" ? characters : sourceKind === "shot" ? shots : scenes;
  const selected = choices[Number(selectedKey)] || choices[0];

  const prompt = useMemo(() => {
    if (!selected) return "";
    if (sourceKind === "character") {
      return buildAssetPrompt({ kind: "character", character: selected as ScriptCharacterRef, userPrompt });
    }
    if (sourceKind === "shot") {
      const shot = selected as ScriptShotRef;
      return [
        `Generate a cinematic start-frame image for shot ${shot.shotKey} in ${shot.sceneHeading}.`,
        `Shot direction: ${shot.text}`,
        "Style: production still, cinematic lighting, coherent with the script world, 16:9 frame.",
        userPrompt ? `User direction: ${userPrompt}` : "",
      ]
        .filter(Boolean)
        .join("\n");
    }
    return buildAssetPrompt({ kind: "scene_set", scene: selected as ScriptSceneRef, userPrompt });
  }, [selected, sourceKind, userPrompt]);

  const refreshAssets = () => onAssetsChange(AssetService.getAssets(project.id));

  const handleSaveProviderSettings = () => {
    saveImageProviderSettings(provider, {
      apiKey: apiKeyDraft.trim(),
      selectedModel: effectiveModel,
    });
    setSettingsMessage(`${providerLabel(provider)} settings saved locally.`);
  };

  const handleClearProviderKey = () => {
    clearImageProviderApiKey(provider);
    setApiKeyDraft("");
    setSettingsMessage(`${providerLabel(provider)} API key cleared.`);
  };

  const handleStageAsset = () => {
    if (!selected || !prompt.trim()) return;
    const now = Date.now();
    const kind: AssetKind = sourceKind === "shot" ? "shot" : sourceKind;
    const scene = selected as ScriptSceneRef;
    const character = selected as ScriptCharacterRef;
    const shot = selected as ScriptShotRef;
    const asset = AssetService.addAsset(project.id, {
      id: "",
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
      prompt,
      mimeType: "image/png",
      createdAt: now,
      updatedAt: now,
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
      metadata: {
        promptVersion: 1,
        aspectRatio: sourceKind === "character" ? "2:3" : "16:9",
        script2ScreenShotKey:
          sourceKind === "shot" ? shot.shotKey : sourceKind === "scene_set" ? `s${scene.sceneIndex}_sh0` : undefined,
        handoffStatus: "local",
      },
    });
    onAssetsChange([...assets, asset]);
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
        <p className="asset-muted">Selected model: {effectiveModel}</p>
        <div className="asset-settings-actions">
          <button onClick={handleSaveProviderSettings}>Save Settings</button>
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

      <label>
        Editable generated prompt
        <textarea className="asset-prompt" value={prompt} readOnly />
      </label>

      <button className="asset-primary" onClick={handleStageAsset} disabled={!selected}>
        Stage Asset Metadata
      </button>

      <div className="asset-export-row">
        <button onClick={handleExportLightWriterPackage}>Export LW Package</button>
        <button onClick={handleExportScript2ScreenManifest}>Export STS Manifest</button>
      </div>

      <div className="asset-list">
        <h3>Project Assets ({assets.length})</h3>
        {assets.length === 0 && <p className="asset-empty">No generated/staged assets yet.</p>}
        {assets.map((asset) => (
          <div className="asset-card" key={asset.id}>
            <div>
              <strong>{assetName(asset)}</strong>
              <span>{asset.kind} · {providerLabel(asset.provider)}</span>
              <span>{asset.model}</span>
              {asset.metadata.script2ScreenShotKey && <em>{asset.metadata.script2ScreenShotKey}</em>}
            </div>
            <button onClick={() => handleDelete(asset.id)}>Delete</button>
          </div>
        ))}
      </div>
    </aside>
  );
}
