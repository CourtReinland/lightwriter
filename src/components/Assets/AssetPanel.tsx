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
  generateImageAsset,
  getImageModelOptions,
  getImageProviderSettings,
  listImageModelsForProvider,
  providerLabel,
  saveImageProviderSettings,
  type ImageGenerationRequest,
} from "../../services/imageGenerationService";
import { downloadImageDataUrl, loadPersistedImageDataUrl, persistGeneratedImageFile } from "../../services/imageAssetStorageService";
import { mergeReviewedPromptDrafts, promptDraftKey } from "../../services/assetPromptDraftService";
import { generateReviewedAssetPrompt, generateReviewedAssetPrompts } from "../../services/llmAssetPromptService";
import type { Project } from "../../services/storageService";
import { StyleReferenceService, type ScriptStyleReference, type StyleReferenceScope } from "../../services/styleReferenceService";
import {
  getAnalystProviderSettings,
  getTextAiProviderSettings,
  getTextAiSettings,
  saveAnalystOverride,
  saveTextAiProviderSettings,
  saveTextAiSettings,
  textAiProviderLabel,
  textAiProviderOptions,
  type TextAiProvider,
} from "../../services/textAiSettingsService";
import ModelPicker from "../ModelPicker";
import { parseCharactersWithTextAi, buildCharacterAssetPrompt } from "../../services/characterParserService";
import "./AssetPanel.css";

interface AssetPanelProps {
  project: Project;
  assets: GeneratedAsset[];
  onAssetsChange: (assets: GeneratedAsset[]) => void;
  onGenerationComplete?: (assets: GeneratedAsset[], kind: AssetKind) => void;
  /**
   * "settings" — provider/API-key/style config + export (shown under the Settings toggle).
   * "generation" — character/scene image generation, embedded inside the KB panel.
   * "full" — everything (legacy/standalone).
   */
  mode?: "settings" | "generation" | "full";
}

type SourceKind = "scene_set" | "character" | "shot";
type AssetSubTab = "settings" | "characters" | "scenes";

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

export default function AssetPanel({ project, assets, onAssetsChange, onGenerationComplete, mode = "full" }: AssetPanelProps) {
  const showSettings = mode === "settings" || mode === "full";
  const showGeneration = mode === "generation" || mode === "full";
  const [activeTab, setActiveTab] = useState<AssetSubTab>(mode === "generation" ? "characters" : "settings");
  const [provider, setProvider] = useState<AssetProvider>("gemini-nano-banana");
  const [sourceKind, setSourceKind] = useState<SourceKind>("scene_set");
  const [selectedKey, setSelectedKey] = useState("0");
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [modelOptions, setModelOptions] = useState(() => getImageModelOptions("gemini-nano-banana"));
  const [isPollingModels, setIsPollingModels] = useState(false);
  const [sceneStyleReference, setSceneStyleReference] = useState<ScriptStyleReference | null>(() => StyleReferenceService.get(project.id, "scene"));
  const [characterStyleReference, setCharacterStyleReference] = useState<ScriptStyleReference | null>(() => StyleReferenceService.get(project.id, "character"));
  const [textAiProvider, setTextAiProvider] = useState<TextAiProvider>(() => getTextAiSettings().selectedProvider);
  const [textAiKeyDrafts, setTextAiKeyDrafts] = useState<Record<TextAiProvider, string>>(() =>
    Object.fromEntries(textAiProviderOptions().map((item) => [item, getTextAiProviderSettings(item).apiKey])) as Record<TextAiProvider, string>,
  );
  const [textAiModelDrafts, setTextAiModelDrafts] = useState<Record<TextAiProvider, string>>(() =>
    Object.fromEntries(textAiProviderOptions().map((item) => [item, getTextAiProviderSettings(item).model])) as Record<TextAiProvider, string>,
  );
  // The analyst (scoring/parsing) model — an override on the writing model.
  const [analystProvider, setAnalystProvider] = useState<TextAiProvider>(() => getAnalystProviderSettings().provider);
  const [analystModel, setAnalystModel] = useState<string>(() => getAnalystProviderSettings().model);
  const [settingsMessage, setSettingsMessage] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isGeneratingPrompt, setIsGeneratingPrompt] = useState(false);
  const [promptOverride, setPromptOverride] = useState("");
  const [promptDrafts, setPromptDrafts] = useState<Record<string, string>>({});
  const [assetPreviewDataUrls, setAssetPreviewDataUrls] = useState<Record<string, string>>({});
  const [aiParsedCharacters, setAiParsedCharacters] = useState<ScriptCharacterRef[] | null>(null);
  const [isParsingCharacters, setIsParsingCharacters] = useState(false);
  const [characterParserMessage, setCharacterParserMessage] = useState("");

  const scenes = useMemo(() => extractScriptScenes(project.content), [project.content]);
  const deterministicCharacters = useMemo(() => extractCharacters(project.content), [project.content]);
  const characters = aiParsedCharacters?.length ? aiParsedCharacters : deterministicCharacters;
  const shots = useMemo(() => extractShotLines(project.content), [project.content]);
  const scriptHash = useMemo(() => simpleScriptHash(project.content), [project.content]);
  const effectiveModel = selectedModel;
  const styleReference = sourceKind === "character" ? characterStyleReference : sceneStyleReference;
  const [settingsReadyProvider, setSettingsReadyProvider] = useState<AssetProvider | null>(null);

  const seedCharacterPromptDrafts = (parsedCharacters: ScriptCharacterRef[]) => {
    if (!parsedCharacters.length) return;
    const nextDrafts = Object.fromEntries(
      parsedCharacters.map((character, index) => [promptDraftKey("character", String(index)), buildCharacterAssetPrompt(character)]),
    );
    setPromptDrafts(nextDrafts);
    setPromptOverride(nextDrafts[promptDraftKey("character", selectedKey)] || nextDrafts[promptDraftKey("character", "0")] || "");
  };

  useEffect(() => {
    let cancelled = false;
    providerOptions().forEach((item) => {
      const apiKey = getImageProviderSettings(item).apiKey?.trim();
      if (!apiKey) return;
      listImageModelsForProvider(item, apiKey)
        .then((options) => {
          if (cancelled || item !== provider) return;
          setModelOptions(options);
          setSelectedModel((current) => (isKnownModel(options, current) ? current : options[0]?.id || ""));
        })
        .catch(() => {
          // Silent boot preload: the visible provider effect surfaces current-provider failures.
        });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setSettingsReadyProvider(null);
    const settings = getImageProviderSettings(provider);
    const options = getImageModelOptions(provider);
    const model = settings.selectedModel || options[0]?.id || "";
    setModelOptions(options);
    setApiKeyDraft(settings.apiKey || "");
    setSelectedModel(model && isKnownModel(options, model) ? model : options[0]?.id || "");
    setSettingsMessage("");
    setSettingsReadyProvider(provider);
  }, [provider]);

  useEffect(() => {
    if (settingsReadyProvider !== provider) return;
    saveImageProviderSettings(provider, {
      apiKey: apiKeyDraft.trim(),
      selectedModel: effectiveModel,
    });
  }, [provider, apiKeyDraft, effectiveModel, settingsReadyProvider]);

  useEffect(() => {
    if (settingsReadyProvider !== provider) return;
    const apiKey = apiKeyDraft.trim();
    if (!apiKey) {
      const options = getImageModelOptions(provider);
      setModelOptions(options);
      setSelectedModel((current) => (isKnownModel(options, current) ? current : options[0]?.id || ""));
      return;
    }

    let cancelled = false;
    setIsPollingModels(true);
    setSettingsMessage(`Loading ${providerLabel(provider)} models...`);
    listImageModelsForProvider(provider, apiKey)
      .then((options) => {
        if (cancelled) return;
        setModelOptions(options);
        setSelectedModel((current) => (isKnownModel(options, current) ? current : options[0]?.id || ""));
        setSettingsMessage(options.length ? `${providerLabel(provider)} models loaded.` : `No image models found for ${providerLabel(provider)}.`);
      })
      .catch((error) => {
        if (cancelled) return;
        setSettingsMessage(error instanceof Error ? error.message : `${providerLabel(provider)} model loading failed.`);
      })
      .finally(() => {
        if (!cancelled) setIsPollingModels(false);
      });

    return () => {
      cancelled = true;
    };
  }, [provider, apiKeyDraft, settingsReadyProvider]);

  useEffect(() => {
    setSceneStyleReference(StyleReferenceService.get(project.id, "scene"));
    setCharacterStyleReference(StyleReferenceService.get(project.id, "character"));
  }, [project.id]);

  useEffect(() => {
    saveTextAiSettings({ selectedProvider: textAiProvider });
  }, [textAiProvider]);

  useEffect(() => {
    textAiProviderOptions().forEach((item) => {
      saveTextAiProviderSettings(item, { apiKey: textAiKeyDrafts[item].trim() });
    });
  }, [textAiKeyDrafts]);

  useEffect(() => {
    setAiParsedCharacters(null);
    setCharacterParserMessage("");
  }, [project.id, project.content]);

  useEffect(() => {
    if (activeTab !== "characters") return;
    const apiKey = textAiKeyDrafts[textAiProvider]?.trim();
    if (!apiKey) {
      setAiParsedCharacters(null);
      seedCharacterPromptDrafts(deterministicCharacters);
      setCharacterParserMessage(
        deterministicCharacters.length
          ? `Using local Fountain character cues (${deterministicCharacters.length}). Add a ${textAiProviderLabel(textAiProvider)} key in Settings for the LLM parser.`
          : `No local character cues found. Add a ${textAiProviderLabel(textAiProvider)} key in Settings for the LLM parser.`,
      );
      return;
    }

    let cancelled = false;
    setIsParsingCharacters(true);
    setCharacterParserMessage(`Parsing characters with ${textAiProviderLabel(textAiProvider)}...`);
    parseCharactersWithTextAi(project.content)
      .then(async (parsed) => {
        if (cancelled) return;
        setAiParsedCharacters(parsed);
        setSelectedKey("0");
        if (parsed.length) {
          setCharacterParserMessage(
            `${textAiProviderLabel(textAiProvider)} parser found ${parsed.length} character${parsed.length === 1 ? "" : "s"}; drafting reviewed prompt for ${parsed[0].name}...`,
          );
          setIsGeneratingPrompt(true);
          const reviewedPrompt = await generateReviewedAssetPrompt({
            kind: "character",
            character: parsed[0],
            fullScriptContent: project.content,
            styleReference,
            userPrompt: "",
          });
          if (cancelled) return;
          const draftKey = promptDraftKey("character", "0");
          setPromptDrafts((current) => ({ ...current, [draftKey]: reviewedPrompt }));
          setPromptOverride(reviewedPrompt);
        }
        setCharacterParserMessage(
          parsed.length
            ? `${textAiProviderLabel(textAiProvider)} parser found ${parsed.length} character${parsed.length === 1 ? "" : "s"}; reviewed prompt is ready.`
            : "LLM parser returned no characters; check the script text or parser key.",
        );
      })
      .catch((error) => {
        if (cancelled) return;
        setAiParsedCharacters(null);
        seedCharacterPromptDrafts(deterministicCharacters);
        setCharacterParserMessage(
          error instanceof Error
            ? `LLM character parser failed: ${error.message}. Using local Fountain cues.`
            : "LLM character parser failed. Using local Fountain cues.",
        );
      })
      .finally(() => {
        if (!cancelled) {
          setIsParsingCharacters(false);
          setIsGeneratingPrompt(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeTab, project.content, textAiProvider, textAiKeyDrafts, deterministicCharacters.length, styleReference]);

  useEffect(() => {
    if (activeTab === "characters" && sourceKind !== "character") {
      setSourceKind("character");
      setSelectedKey("0");
    }
    if (activeTab === "scenes" && sourceKind === "character") {
      setSourceKind("scene_set");
      setSelectedKey("0");
    }
  }, [activeTab, sourceKind]);

  const choices = sourceKind === "character" ? characters : sourceKind === "shot" ? shots : scenes;
  const selected = choices[Number(selectedKey)] || choices[0];
  const selectedPromptDraftKey = promptDraftKey(sourceKind, selectedKey);

  useEffect(() => {
    setPromptDrafts({});
    setPromptOverride("");
  }, [project.id, project.content, sourceKind, styleReference]);

  useEffect(() => {
    setPromptOverride(promptDrafts[selectedPromptDraftKey] || "");
  }, [promptDrafts, selectedPromptDraftKey]);

  useEffect(() => {
    if (activeTab !== "characters" || sourceKind !== "character") return;
    if (textAiKeyDrafts[textAiProvider]?.trim()) return;
    if (promptDrafts[selectedPromptDraftKey]) return;
    seedCharacterPromptDrafts(characters);
  }, [activeTab, sourceKind, selectedPromptDraftKey, characters, promptDrafts, textAiProvider, textAiKeyDrafts]);

  useEffect(() => {
    if (activeTab !== "characters" || sourceKind !== "character") return;
    if (!textAiKeyDrafts[textAiProvider]?.trim()) return;
    if (!aiParsedCharacters?.length) return;
    if (!selected || promptDrafts[selectedPromptDraftKey] || isParsingCharacters || isGeneratingPrompt) return;
    let cancelled = false;
    const character = selected as ScriptCharacterRef;
    setIsGeneratingPrompt(true);
    setCharacterParserMessage(`Drafting reviewed prompt for ${character.name} with ${textAiProviderLabel(textAiProvider)}...`);
    generateReviewedAssetPrompt({
      kind: "character",
      character,
      fullScriptContent: project.content,
      styleReference,
      userPrompt: "",
    })
      .then((reviewedPrompt) => {
        if (cancelled) return;
        setPromptDrafts((current) => ({ ...current, [selectedPromptDraftKey]: reviewedPrompt }));
        setPromptOverride(reviewedPrompt);
        setCharacterParserMessage(`Reviewed prompt ready for ${character.name}.`);
      })
      .catch((error) => {
        if (cancelled) return;
        seedCharacterPromptDrafts([character]);
        setCharacterParserMessage(
          error instanceof Error
            ? `Reviewed prompt failed for ${character.name}: ${error.message}. Using local character summary.`
            : `Reviewed prompt failed for ${character.name}. Using local character summary.`,
        );
      })
      .finally(() => {
        if (!cancelled) setIsGeneratingPrompt(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, sourceKind, selectedKey, selectedPromptDraftKey, selected, promptDrafts, aiParsedCharacters, isParsingCharacters, textAiProvider, textAiKeyDrafts, project.content, styleReference]);

  useEffect(() => {
    let cancelled = false;
    const missingPreviewAssets = assets.filter((asset) => asset.filePath && !asset.imageDataUrl && !assetPreviewDataUrls[asset.id]);
    if (missingPreviewAssets.length === 0) return;

    missingPreviewAssets.forEach((asset) => {
      loadPersistedImageDataUrl(asset.filePath)
        .then((dataUrl) => {
          if (!cancelled && dataUrl) {
            setAssetPreviewDataUrls((current) => ({ ...current, [asset.id]: dataUrl }));
          }
        })
        .catch(() => {
          // Keep the asset card and file path visible even if thumbnail hydration fails.
        });
    });

    return () => {
      cancelled = true;
    };
  }, [assets, assetPreviewDataUrls]);

  const prompt = promptOverride;

  const refreshAssets = () => onAssetsChange(AssetService.getAssets(project.id));

  const handleStyleReferenceChange = (scope: StyleReferenceScope, file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setSettingsMessage("Style reference must be an image file.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      if (!dataUrl) return;
      const saved = StyleReferenceService.save(project.id, { scope, name: file.name, mimeType: file.type, dataUrl });
      if (scope === "character") setCharacterStyleReference(saved);
      else setSceneStyleReference(saved);
      setSettingsMessage(`${scope === "character" ? "Character" : "Scene"} style reference saved: ${file.name}`);
    };
    reader.onerror = () => setSettingsMessage("Could not read style reference image.");
    reader.readAsDataURL(file);
  };

  const handleClearStyleReference = (scope: StyleReferenceScope) => {
    StyleReferenceService.clear(project.id, scope);
    if (scope === "character") setCharacterStyleReference(null);
    else setSceneStyleReference(null);
    setSettingsMessage(`${scope === "character" ? "Character" : "Scene"} style reference cleared.`);
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

  const buildPromptRequestForChoice = (choice: ScriptSceneRef | ScriptCharacterRef | ScriptShotRef) => ({
    kind: sourceKind,
    scene: sourceKind === "scene_set" ? (choice as ScriptSceneRef) : undefined,
    character: sourceKind === "character" ? (choice as ScriptCharacterRef) : undefined,
    shot: sourceKind === "shot" ? (choice as ScriptShotRef) : undefined,
    fullScriptContent: project.content,
    styleReference,
    userPrompt: "",
  });

  const buildPromptForChoice = async (choice: ScriptSceneRef | ScriptCharacterRef | ScriptShotRef): Promise<string> => {
    return generateReviewedAssetPrompt(buildPromptRequestForChoice(choice));
  };

  const handleGenerateLlmPrompt = async () => {
    if (!selected) return;
    setIsGeneratingPrompt(true);
    setSettingsMessage("LLM prompt pass 1 drafting, pass 2 reviewing against LightWriter rules...");
    try {
      const nextPrompt = await buildPromptForChoice(selected as ScriptSceneRef | ScriptCharacterRef | ScriptShotRef);
      setPromptDrafts((current) => ({ ...current, [selectedPromptDraftKey]: nextPrompt }));
      setPromptOverride(nextPrompt);
      setSettingsMessage("LLM prompt drafted and reviewed. You can edit it before generating.");
    } catch (error) {
      setSettingsMessage(error instanceof Error ? error.message : "LLM prompt generation failed.");
    } finally {
      setIsGeneratingPrompt(false);
    }
  };

  const handleGenerateAllPrompts = async () => {
    if (choices.length === 0) return;
    setIsGeneratingPrompt(true);
    setSettingsMessage(`Generating and reviewing ${choices.length} ${sourceKind} prompt${choices.length === 1 ? "" : "s"}...`);
    try {
      const typedChoices = choices as Array<ScriptSceneRef | ScriptCharacterRef | ScriptShotRef>;
      const prompts = await generateReviewedAssetPrompts(
        typedChoices.map(buildPromptRequestForChoice),
        ({ index, total, phase, label, prompt: completedPrompt }) => {
          const step = phase === "start" ? "reviewing" : "finished";
          setSettingsMessage(`Prompt ${index + 1}/${total} ${step}: ${label}`);
          if (phase === "complete" && completedPrompt) {
            setPromptDrafts((current) => ({
              ...current,
              [promptDraftKey(sourceKind, index)]: completedPrompt,
            }));
            if (index === Number(selectedKey)) setPromptOverride(completedPrompt);
          }
        },
      );
      setPromptDrafts((current) => mergeReviewedPromptDrafts(current, sourceKind, prompts));
      if (prompts[Number(selectedKey)]) setPromptOverride(prompts[Number(selectedKey)]);
      setSettingsMessage(
        `Generate All Prompts complete: ${prompts.length} reviewed prompt${prompts.length === 1 ? "" : "s"} prepared. No Project Assets were created; use Stage Prompt Only, Generate Image, or Generate All when you want asset records.`,
      );
    } catch (error) {
      setSettingsMessage(error instanceof Error ? `Generate All Prompts failed: ${error.message}` : "Generate All Prompts failed.");
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
      setSettingsMessage("Choose an image model before generating.");
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
      onGenerationComplete?.([asset], asset.kind);
      setSettingsMessage(asset.filePath ? `Done — image generated and saved: ${asset.filePath}` : "Done — image generated and saved to Project Assets. Use Download Image to save a file.");
    } catch (error) {
      setSettingsMessage(error instanceof Error ? error.message : "Image generation failed.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateAll = async () => {
    if (choices.length === 0) return;
    if (!effectiveModel.trim()) {
      setSettingsMessage("Choose an image model before generating all.");
      return;
    }
    setIsGenerating(true);
    setSettingsMessage(`Generating ${choices.length} ${sourceKind} asset${choices.length === 1 ? "" : "s"}...`);
    const generatedAssets: GeneratedAsset[] = [];
    try {
      for (const choice of choices as Array<ScriptSceneRef | ScriptCharacterRef | ScriptShotRef>) {
        setSettingsMessage(`Prompt ${generatedAssets.length + 1}/${choices.length} reviewing before image generation...`);
        const finalPrompt = await buildPromptForChoice(choice);
        const request = buildAssetRequestForChoice(choice, finalPrompt);
        if (!request) continue;
        setSettingsMessage(`Image ${generatedAssets.length + 1}/${choices.length} generating: ${request.name}`);
        const asset = await saveGeneratedAssetFromRequest(request);
        generatedAssets.push(asset);
        setSettingsMessage(`Generated ${generatedAssets.length}/${choices.length}: ${asset.name}`);
      }
      onAssetsChange([...assets, ...generatedAssets]);
      onGenerationComplete?.(generatedAssets, generatedAssets[0]?.kind || (sourceKind as AssetKind));
      setSettingsMessage(`Done — Generate All complete: ${generatedAssets.length} image${generatedAssets.length === 1 ? "" : "s"} saved.`);
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
    const sceneCount = Object.keys(manifest.locations).length;
    const charCount = Object.keys(manifest.characters).length;
    const shotCount = Object.keys(manifest.generated_media).length;
    const skipped = manifest._lightwriter_warnings?.length ?? 0;
    const parts = [
      `Exported Script2Screen manifest: ${sceneCount} scene background${sceneCount === 1 ? "" : "s"}, ${charCount} character${charCount === 1 ? "" : "s"}, ${shotCount} shot${shotCount === 1 ? "" : "s"}.`,
    ];
    if (skipped > 0) {
      parts.push(`Skipped ${skipped} asset${skipped === 1 ? "" : "s"} with no saved image file — generate/persist them in the desktop app to include them.`);
    }
    setSettingsMessage(parts.join(" "));
  };

  return (
    <aside className={`asset-panel${mode === "generation" ? " asset-panel-embedded" : ""}`}>
      <div className="asset-panel-header">
        <div>
          <h2>{mode === "settings" ? "Settings" : mode === "generation" ? "Generate Images" : "AI Assets"}</h2>
          <p>
            {mode === "settings"
              ? "Writing-AI and image-provider keys, models, and Script2Screen export."
              : mode === "generation"
                ? "Generate character portraits and scene backgrounds from the script."
                : "Generate and tag sets, characters, and shot start frames for Script2Screen."}
          </p>
        </div>
      </div>

      {showSettings && showGeneration && (
        <div className="asset-subtabs" role="tablist" aria-label="Asset workspace sections">
          {(["settings", "characters", "scenes"] as AssetSubTab[]).map((tab) => (
            <button
              key={tab}
              className={activeTab === tab ? "active" : ""}
              onClick={() => setActiveTab(tab)}
              role="tab"
              aria-selected={activeTab === tab}
            >
              {tab === "settings" ? "Settings" : tab === "characters" ? "Characters" : "Scenes"}
            </button>
          ))}
        </div>
      )}

      {mode === "generation" && (
        <div className="asset-subtabs" role="tablist" aria-label="Generation sections">
          {(["characters", "scenes"] as AssetSubTab[]).map((tab) => (
            <button
              key={tab}
              className={activeTab === tab ? "active" : ""}
              onClick={() => setActiveTab(tab)}
              role="tab"
              aria-selected={activeTab === tab}
            >
              {tab === "characters" ? "Characters" : "Scenes"}
            </button>
          ))}
        </div>
      )}

      {showSettings && activeTab === "settings" && (
        <div className="asset-tab-pane">
          <section className="asset-settings-box">
            <div className="asset-settings-heading">
              <h3>Writing &amp; Analysis Models</h3>
              <span>Auto-saved</span>
            </div>
            <p className="asset-muted">Pick the model that WRITES (rewrites, expansion, suggestions) and, separately, the one that ANALYZES (report-card scoring, character parsing, style). A creative model can write while a disciplined model scores.</p>
            <label>
              Writing model — provider
              <select value={textAiProvider} onChange={(event) => setTextAiProvider(event.target.value as TextAiProvider)}>
                {textAiProviderOptions().map((item) => (
                  <option key={item} value={item}>{textAiProviderLabel(item)}</option>
                ))}
              </select>
            </label>
            <label>
              Writing model ({textAiProviderLabel(textAiProvider)})
              <ModelPicker
                key={`writer-${textAiProvider}`}
                provider={textAiProvider}
                apiKey={textAiKeyDrafts[textAiProvider] || ""}
                value={textAiModelDrafts[textAiProvider] || ""}
                onChange={(model) => {
                  setTextAiModelDrafts((current) => ({ ...current, [textAiProvider]: model }));
                  saveTextAiProviderSettings(textAiProvider, { model });
                }}
              />
            </label>
            <label>
              Scoring &amp; analysis model — provider
              <select
                value={analystProvider}
                onChange={(event) => {
                  const next = event.target.value as TextAiProvider;
                  const nextModel = getTextAiProviderSettings(next).model;
                  setAnalystProvider(next);
                  setAnalystModel(nextModel);
                  saveAnalystOverride(next, nextModel);
                }}
              >
                {textAiProviderOptions().map((item) => (
                  <option key={item} value={item}>{textAiProviderLabel(item)}</option>
                ))}
              </select>
            </label>
            <label>
              Scoring &amp; analysis model ({textAiProviderLabel(analystProvider)})
              <ModelPicker
                key={`analyst-${analystProvider}`}
                provider={analystProvider}
                apiKey={textAiKeyDrafts[analystProvider] || ""}
                value={analystModel}
                onChange={(model) => {
                  setAnalystModel(model);
                  saveAnalystOverride(analystProvider, model);
                }}
              />
            </label>
            <p className="asset-muted">Used for the report card, character parsing, and style/KB analysis. Keep this on a precise model (e.g. grok) even when writing uses a creative one.</p>
            {textAiProviderOptions().map((item) => (
              <label key={item}>
                {textAiProviderLabel(item)} API key
                <input
                  type="password"
                  value={textAiKeyDrafts[item]}
                  onChange={(event) => setTextAiKeyDrafts((current) => ({ ...current, [item]: event.target.value }))}
                  placeholder={`Paste ${textAiProviderLabel(item)} API key`}
                />
              </label>
            ))}
          </section>

          <section className="asset-settings-box">
            <div className="asset-settings-heading">
              <h3>Graphical Assets</h3>
              <span>{isPollingModels ? "Syncing models..." : "Auto-saved"}</span>
            </div>
            <p className="asset-muted">Image-generation provider for character portraits, scene backgrounds, and shot frames.</p>
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
                placeholder={`Paste ${providerLabel(provider)} API key`}
              />
            </label>
            <label>
              Image model
              <select value={selectedModel} onChange={(event) => setSelectedModel(event.target.value)} disabled={isPollingModels && modelOptions.length === 0}>
                <option value="">{isPollingModels ? "Loading models..." : "No models loaded yet"}</option>
                {modelOptions.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
            </label>
            <p className="asset-muted">Selected model: {effectiveModel || "none yet"}</p>
            {settingsMessage && <p className="asset-status">{settingsMessage}</p>}
          </section>

          <section className="asset-settings-box">
            <div className="asset-settings-heading">
              <h3>ScriptToScreen Export</h3>
            </div>
            <p className="asset-muted">Export the generated assets for the ScriptToScreen handoff.</p>
            <div className="asset-export-row">
              <button onClick={handleExportLightWriterPackage}>Export LW Package</button>
              <button onClick={handleExportScript2ScreenManifest}>Export STS Manifest</button>
            </div>
          </section>
        </div>
      )}

      {showGeneration && activeTab !== "settings" && (
        <div className="asset-tab-pane">
          {activeTab === "scenes" && (
            <label>
              Scene asset type
              <select
                value={sourceKind === "character" ? "scene_set" : sourceKind}
                onChange={(event) => {
                  setSourceKind(event.target.value as SourceKind);
                  setSelectedKey("0");
                }}
              >
                <option value="scene_set">Scene set from headings</option>
                <option value="shot">Shot start frame</option>
              </select>
            </label>
          )}

          <label>
            {activeTab === "characters" ? "Character" : "Script reference"}
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
          {activeTab === "characters" && (
            <p className="asset-status">
              {isParsingCharacters ? "LLM character parser running..." : characterParserMessage || `Using ${characters.length} parsed character${characters.length === 1 ? "" : "s"}.`}
            </p>
          )}

          <section className="asset-settings-box asset-style-reference-box">
            <h3>{activeTab === "characters" ? "Character Style Reference" : "Scene Style Reference"}</h3>
            <p className="asset-muted">
              Optional look reference for {activeTab === "characters" ? "character design continuity, wardrobe, palette, and rendering style." : "scene palette, texture, mood, and continuity."}
            </p>
            <label>
              Reference image
              <input type="file" accept="image/*" onChange={(event) => handleStyleReferenceChange(activeTab === "characters" ? "character" : "scene", event.target.files?.[0])} />
            </label>
            {styleReference && (
              <div className="asset-style-reference-preview">
                <img src={styleReference.dataUrl} alt={`${activeTab} style reference`} />
                <div>
                  <strong>{styleReference.name}</strong>
                  <span>{styleReference.mimeType}</span>
                  <button onClick={() => handleClearStyleReference(activeTab === "characters" ? "character" : "scene")}>Clear Reference</button>
                </div>
              </div>
            )}
          </section>

          <label>
            Editable generated prompt
            <textarea
              className="asset-prompt"
              value={prompt}
              onChange={(event) => {
                const nextPrompt = event.target.value;
                setPromptOverride(nextPrompt);
                setPromptDrafts((current) => ({ ...current, [selectedPromptDraftKey]: nextPrompt }));
              }}
              placeholder="Click Generate/Review Prompt to run the two-step LLM prompt builder, or write your final provider prompt here."
            />
          </label>

          <div className="asset-generation-actions">
            <button onClick={handleGenerateLlmPrompt} disabled={!selected || isGeneratingPrompt || isGenerating}>
              {isGeneratingPrompt ? "Reviewing Prompt..." : "Generate/Review Prompt"}
            </button>
            <button onClick={handleGenerateAllPrompts} disabled={choices.length === 0 || isGeneratingPrompt || isGenerating}>
              Generate All Prompts
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
        </div>
      )}

      {showGeneration && activeTab !== "settings" && (
        <div className="asset-list">
        <h3>Project Assets ({assets.length})</h3>
        {assets.length === 0 && <p className="asset-empty">No generated/staged assets yet.</p>}
        {assets.map((asset) => {
          const previewDataUrl = asset.imageDataUrl || assetPreviewDataUrls[asset.id];
          return (
          <div className="asset-card" key={asset.id}>
            {previewDataUrl && <img className="asset-card-preview" src={previewDataUrl} alt={asset.name} />}
            <div>
              <strong>{assetName(asset)}</strong>
              <span>{asset.kind} · {providerLabel(asset.provider)}</span>
              <span>{asset.model}</span>
              {asset.metadata.script2ScreenShotKey && <em>{asset.metadata.script2ScreenShotKey}</em>}
              {asset.filePath ? <code className="asset-file-path">{asset.filePath}</code> : previewDataUrl && <code className="asset-file-path">Stored in LightWriter app data; use Download Image for a copy.</code>}
            </div>
            <div className="asset-card-actions">
              {previewDataUrl && <button onClick={() => downloadImageDataUrl({ name: asset.name, mimeType: asset.mimeType, dataUrl: previewDataUrl })}>Download Image</button>}
              <button onClick={() => handleDelete(asset.id)}>Delete</button>
            </div>
          </div>
          );
        })}
        </div>
      )}
    </aside>
  );
}
