import { useState, useCallback, useEffect } from "react";
import {
  KnowledgeBaseService,
  type KnowledgeBase,
  type KBCharacter,
  type KBWorldRule,
  type KBPlotThread,
  type KBCustomNote,
  type KBScene,
} from "../../services/knowledgeBase";
import { StyleProfileService, inferStyleSampleKind, type AnalyzeStyleSampleInput, type StyleProfile } from "../../services/styleProfile";
import { importFile } from "../../services/fileImporter";
import { getSelectedTextAiProviderSettings } from "../../services/textAiSettingsService";
import type { AssetProvider, GeneratedAsset } from "../../types/assets";
import { buildAssetKnowledgeItems } from "../../services/assetKnowledgeViewService";
import {
  buildGeneratedAssetFromResult,
  generateImageAsset,
  getImageProviderSettings,
  providerLabel,
  type ImageGenerationRequest,
} from "../../services/imageGenerationService";
import { downloadImageDataUrl, loadPersistedImageDataUrl, persistGeneratedImageFile } from "../../services/imageAssetStorageService";
import { AssetService } from "../../services/assetService";
import KBEntryEditor from "./KBEntryEditor";
import "./KBPanel.css";

interface KBPanelProps {
  kb: KnowledgeBase;
  onKBChange: (kb: KnowledgeBase) => void;
  styleProfile: StyleProfile | null;
  onStyleChange: (profile: StyleProfile | null) => void;
  scriptContent: string;
  projectId: string;
  assets: GeneratedAsset[];
  onAssetsChange: (assets: GeneratedAsset[]) => void;
  focusSection?: "characters" | "scenes" | null;
  notice?: string;
  onClearNotice?: () => void;
}

type EditTarget = {
  type: "character" | "scene" | "worldRule" | "plotThread" | "customNote";
  existing?: KBCharacter | KBScene | KBWorldRule | KBPlotThread | KBCustomNote;
} | null;

export default function KBPanel({
  kb,
  onKBChange,
  styleProfile,
  onStyleChange,
  scriptContent,
  projectId,
  assets,
  onAssetsChange,
  focusSection,
  notice,
  onClearNotice,
}: KBPanelProps) {
  const [editTarget, setEditTarget] = useState<EditTarget>(null);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    characters: true,
    scenes: false,
    world: false,
    plot: false,
    tone: false,
    notes: false,
    style: false,
  });
  const [styleSample, setStyleSample] = useState("");
  const [styleSamples, setStyleSamples] = useState<AnalyzeStyleSampleInput[]>([]);
  const [analyzingStyle, setAnalyzingStyle] = useState(false);
  const [styleError, setStyleError] = useState<string | null>(null);
  const [assetPreviewDataUrls, setAssetPreviewDataUrls] = useState<Record<string, string>>({});
  const [repromptProvider, setRepromptProvider] = useState<AssetProvider>("gemini-nano-banana");
  const [repromptingAssetId, setRepromptingAssetId] = useState<string | null>(null);
  const [repromptTarget, setRepromptTarget] = useState<GeneratedAsset | null>(null);
  const [repromptDraft, setRepromptDraft] = useState("");
  const [repromptError, setRepromptError] = useState<string | null>(null);

  const characterAssetItems = buildAssetKnowledgeItems(assets, kb, "character");
  const sceneAssetItems = buildAssetKnowledgeItems(assets, kb, "scene_set");

  useEffect(() => {
    if (!focusSection) return;
    setExpandedSections((prev) => ({ ...prev, characters: focusSection === "characters", scenes: focusSection === "scenes" }));
  }, [focusSection]);

  useEffect(() => {
    let cancelled = false;
    const missing = assets.filter((asset) => asset.filePath && !asset.imageDataUrl && !assetPreviewDataUrls[asset.id]);
    missing.forEach((asset) => {
      loadPersistedImageDataUrl(asset.filePath)
        .then((dataUrl) => {
          if (!cancelled && dataUrl) setAssetPreviewDataUrls((current) => ({ ...current, [asset.id]: dataUrl }));
        })
        .catch(() => undefined);
    });
    return () => {
      cancelled = true;
    };
  }, [assets, assetPreviewDataUrls]);

  const toggleSection = (key: string) => {
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSave = useCallback((type: string, data: Record<string, unknown>) => {
    let updated = kb;
    const existingId = editTarget?.existing && "id" in editTarget.existing ? editTarget.existing.id : null;

    switch (type) {
      case "character":
        updated = existingId
          ? KnowledgeBaseService.updateCharacter(kb, existingId, data as Partial<KBCharacter>)
          : KnowledgeBaseService.addCharacter(kb, data as Omit<KBCharacter, "id">);
        break;
      case "scene":
        updated = existingId
          ? KnowledgeBaseService.updateScene(kb, existingId, data as Partial<KBScene>)
          : KnowledgeBaseService.addScene(kb, data as Omit<KBScene, "id">);
        break;
      case "worldRule":
        updated = existingId
          ? KnowledgeBaseService.updateWorldRule(kb, existingId, data as Partial<KBWorldRule>)
          : KnowledgeBaseService.addWorldRule(kb, data as Omit<KBWorldRule, "id">);
        break;
      case "plotThread":
        updated = existingId
          ? KnowledgeBaseService.updatePlotThread(kb, existingId, data as Partial<KBPlotThread>)
          : KnowledgeBaseService.addPlotThread(kb, data as Omit<KBPlotThread, "id">);
        break;
      case "customNote":
        updated = existingId
          ? KnowledgeBaseService.updateCustomNote(kb, existingId, data as Partial<KBCustomNote>)
          : KnowledgeBaseService.addCustomNote(kb, data as Omit<KBCustomNote, "id">);
        break;
    }

    KnowledgeBaseService.saveKB(updated);
    onKBChange(updated);
    setEditTarget(null);
  }, [kb, editTarget, onKBChange]);

  const handleDelete = useCallback((type: string, id: string) => {
    let updated = kb;
    switch (type) {
      case "character": updated = KnowledgeBaseService.deleteCharacter(kb, id); break;
      case "scene": updated = KnowledgeBaseService.deleteScene(kb, id); break;
      case "worldRule": updated = KnowledgeBaseService.deleteWorldRule(kb, id); break;
      case "plotThread": updated = KnowledgeBaseService.deletePlotThread(kb, id); break;
      case "customNote": updated = KnowledgeBaseService.deleteCustomNote(kb, id); break;
    }
    KnowledgeBaseService.saveKB(updated);
    onKBChange(updated);
  }, [kb, onKBChange]);

  const handleScanScript = useCallback(async () => {
    const settings = getSelectedTextAiProviderSettings();
    if (!settings.apiKey.trim()) { setScanError("Set your Text AI API key first."); return; }
    if (!scriptContent.trim()) { setScanError("No script content to scan."); return; }

    setScanning(true);
    setScanError(null);
    try {
      const extracted = await KnowledgeBaseService.scanScript(scriptContent, settings.apiKey);
      let updated = { ...kb };

      // Merge extracted entries (add new, don't overwrite existing)
      if (extracted.characters) {
        for (const c of extracted.characters) {
          if (!updated.characters.some(ex => ex.name.toLowerCase() === c.name.toLowerCase())) {
            updated.characters.push(c);
          }
        }
      }
      if (extracted.worldRules) {
        for (const r of extracted.worldRules) {
          if (!updated.worldRules.some(ex => ex.title.toLowerCase() === r.title.toLowerCase())) {
            updated.worldRules.push(r);
          }
        }
      }
      if (extracted.plotThreads) {
        for (const t of extracted.plotThreads) {
          if (!updated.plotThreads.some(ex => ex.title.toLowerCase() === t.title.toLowerCase())) {
            updated.plotThreads.push(t);
          }
        }
      }
      if (extracted.toneStyle && !updated.toneStyle.genre) {
        updated.toneStyle = extracted.toneStyle;
      }

      KnowledgeBaseService.saveKB(updated);
      onKBChange(updated);
    } catch (e) {
      setScanError(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setScanning(false);
    }
  }, [kb, scriptContent, onKBChange]);

  const handleToneChange = useCallback((field: string, value: string) => {
    const updated = KnowledgeBaseService.updateToneStyle(kb, { [field]: value });
    KnowledgeBaseService.saveKB(updated);
    onKBChange(updated);
  }, [kb, onKBChange]);

  const handleAnalyzeStyle = useCallback(async () => {
    const samples = [...styleSamples];
    if (styleSample.trim()) {
      samples.push({ filename: "Pasted sample", kind: "txt", text: styleSample.trim() });
    }
    if (!samples.length) { setStyleError("Paste or import at least one writing sample first."); return; }

    setAnalyzingStyle(true);
    setStyleError(null);
    try {
      const profile = await StyleProfileService.analyzeSamples(samples, projectId);
      StyleProfileService.saveProfile(profile);
      onStyleChange(profile);
    } catch (e) {
      setStyleError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setAnalyzingStyle(false);
    }
  }, [styleSample, styleSamples, projectId, onStyleChange]);

  const handleOpenReprompt = useCallback((asset: GeneratedAsset) => {
    setRepromptTarget(asset);
    setRepromptDraft(asset.prompt || "");
    setRepromptError(null);
  }, []);

  const handleDownloadAsset = useCallback((asset: GeneratedAsset) => {
    const dataUrl = asset.imageDataUrl || assetPreviewDataUrls[asset.id];
    if (!dataUrl) {
      setRepromptError(asset.filePath ? `Preview is still loading from ${asset.filePath}. Try again in a moment.` : "No saved image data is available to download yet.");
      return;
    }
    downloadImageDataUrl({ name: asset.name, mimeType: asset.mimeType, dataUrl });
  }, [assetPreviewDataUrls]);

  const handleRepromptAsset = useCallback(async (asset: GeneratedAsset, promptText: string = asset.prompt) => {
    if (!promptText.trim()) {
      setRepromptError("Edit or restore the prior prompt before re-prompting.");
      return;
    }
    const settings = getImageProviderSettings(repromptProvider);
    if (!settings.apiKey?.trim()) {
      setRepromptError(`Add a ${providerLabel(repromptProvider)} API key in Assets/Settings first.`);
      return;
    }
    if (!settings.selectedModel?.trim()) {
      setRepromptError(`Choose a ${providerLabel(repromptProvider)} image model in Assets/Settings first.`);
      return;
    }

    setRepromptingAssetId(asset.id);
    setRepromptError(null);
    try {
      const request: ImageGenerationRequest = {
        projectId: asset.projectId,
        kind: asset.kind,
        provider: repromptProvider,
        model: settings.selectedModel,
        name: `${asset.name} reroll`,
        prompt: promptText.trim(),
        negativePrompt: asset.negativePrompt,
        scriptRef: asset.scriptRef,
        aspectRatio: typeof asset.metadata.aspectRatio === "string" ? asset.metadata.aspectRatio : asset.kind === "character" ? "2:3" : "16:9",
      };
      const result = await generateImageAsset(request);
      const filePath = await persistGeneratedImageFile({
        projectId: request.projectId,
        name: request.name,
        mimeType: result.mimeType,
        dataUrl: result.imageDataUrl,
      });
      const generated = buildGeneratedAssetFromResult(request, { ...result, filePath: filePath || result.filePath });
      AssetService.addAsset(asset.projectId, {
        ...generated,
        metadata: {
          ...generated.metadata,
          rerolledFromAssetId: asset.id,
          originalProvider: asset.provider,
          originalModel: asset.model,
        },
      });
      onAssetsChange(AssetService.getAssets(asset.projectId));
      setRepromptTarget(null);
      setRepromptDraft("");
    } catch (error) {
      setRepromptError(error instanceof Error ? error.message : "Re-prompt failed.");
    } finally {
      setRepromptingAssetId(null);
    }
  }, [onAssetsChange, repromptProvider]);

  const handleFileImport = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".txt,.fountain,.pdf,.docx";
    input.multiple = true;
    input.onchange = async () => {
      const files = Array.from(input.files || []);
      if (!files.length) return;
      setStyleError(null);
      try {
        const imported = await Promise.all(files.map(async (file) => ({
          filename: file.name,
          kind: inferStyleSampleKind(file.name),
          text: await importFile(file),
        })));
        setStyleSamples((current) => [...current, ...imported.filter((sample) => sample.text.trim())]);
      } catch (error) {
        setStyleError(error instanceof Error ? error.message : "Could not import one of the style sample files.");
      }
    };
    input.click();
  }, []);

  const renderGeneratedAssetDetails = (asset: GeneratedAsset) => {
    const previewDataUrl = asset.imageDataUrl || assetPreviewDataUrls[asset.id];
    const isEditingReprompt = repromptTarget?.id === asset.id;
    return (
      <>
        {asset.filePath && (
          <div className="kb-asset-file">
            <span>Local file</span>
            <a href={`file://${asset.filePath}`} title={asset.filePath}>{asset.filePath}</a>
          </div>
        )}
        <div className="kb-entry-actions kb-asset-actions">
          <button onClick={() => handleOpenReprompt(asset)}>Re-prompt</button>
          <button onClick={() => handleDownloadAsset(asset)} disabled={!previewDataUrl}>Download</button>
        </div>
        {isEditingReprompt && (
          <div className="kb-reprompt-editor">
            <label>Prior prompt / edit before re-prompting</label>
            <textarea value={repromptDraft} onChange={(event) => setRepromptDraft(event.target.value)} />
            <div className="kb-entry-actions">
              <button onClick={() => handleRepromptAsset(asset, repromptDraft)} disabled={repromptingAssetId === asset.id}>
                {repromptingAssetId === asset.id ? "Generating..." : "Generate Re-prompt"}
              </button>
              <button onClick={() => { setRepromptTarget(null); setRepromptDraft(""); }}>Cancel</button>
            </div>
          </div>
        )}
      </>
    );
  };

  return (
    <div className="kb-panel">
      <div className="kb-header">
        <span className="kb-title">Knowledge Base</span>
        <button className="kb-scan-btn" onClick={handleScanScript} disabled={scanning}>
          {scanning ? "Scanning..." : "Scan Script"}
        </button>
      </div>
      {notice && (
        <div className="kb-notice">
          <span>{notice}</span>
          <button onClick={onClearNotice}>x</button>
        </div>
      )}
      {scanError && <div className="kb-error">{scanError}</div>}
      {repromptError && <div className="kb-error">{repromptError}</div>}

      <div className="kb-reprompt-bar">
        <span>Re-roll provider</span>
        <select value={repromptProvider} onChange={(event) => setRepromptProvider(event.target.value as AssetProvider)}>
          <option value="gemini-nano-banana">{providerLabel("gemini-nano-banana")}</option>
          <option value="grok-imagine">{providerLabel("grok-imagine")}</option>
        </select>
      </div>

      {/* Characters */}
      <div className="kb-section">
        <button className="kb-section-header" onClick={() => toggleSection("characters")}>
          <span>{expandedSections.characters ? "v" : ">"} Characters ({kb.characters.length})</span>
          <button className="kb-add-btn" onClick={e => { e.stopPropagation(); setEditTarget({ type: "character" }); }}>+</button>
        </button>
        {expandedSections.characters && (
          <>
            {kb.characters.map(c => (
              <div key={c.id} className="kb-entry">
                <div className="kb-entry-name">{c.name}</div>
                <div className="kb-entry-preview">{c.description.slice(0, 120)}{c.description.length > 120 ? "..." : ""}</div>
                <div className="kb-entry-actions">
                  <button onClick={() => setEditTarget({ type: "character", existing: c })}>Edit</button>
                  <button onClick={() => handleDelete("character", c.id)}>Del</button>
                </div>
              </div>
            ))}
            {characterAssetItems.map(({ asset, title, description }) => {
              const previewDataUrl = asset.imageDataUrl || assetPreviewDataUrls[asset.id];
              return (
                <div key={asset.id} className="kb-asset-entry">
                  {previewDataUrl && <img className="kb-asset-thumb" src={previewDataUrl} alt={title} />}
                  <div className="kb-asset-body">
                    <div className="kb-entry-name">{title}</div>
                    <div className="kb-entry-preview">{description.slice(0, 160)}{description.length > 160 ? "..." : ""}</div>
                    {renderGeneratedAssetDetails(asset)}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* Scenes */}
      <div className="kb-section">
        <button className="kb-section-header" onClick={() => toggleSection("scenes")}>
          <span>{expandedSections.scenes ? "v" : ">"} Scenes ({Math.max(kb.scenes?.length || 0, sceneAssetItems.length)})</span>
          <button className="kb-add-btn" onClick={e => { e.stopPropagation(); setEditTarget({ type: "scene" }); }}>+</button>
        </button>
        {expandedSections.scenes && (
          <>
            {(kb.scenes || []).map(scene => (
              <div key={scene.id} className="kb-entry">
                <div className="kb-entry-name">{scene.heading}</div>
                <div className="kb-entry-preview">{scene.description.slice(0, 120)}{scene.description.length > 120 ? "..." : ""}</div>
                <div className="kb-entry-actions">
                  <button onClick={() => setEditTarget({ type: "scene", existing: scene })}>Edit</button>
                  <button onClick={() => handleDelete("scene", scene.id)}>Del</button>
                </div>
              </div>
            ))}
            {sceneAssetItems.map(({ asset, title, description }) => {
              const previewDataUrl = asset.imageDataUrl || assetPreviewDataUrls[asset.id];
              return (
                <div key={asset.id} className="kb-asset-entry">
                  {previewDataUrl && <img className="kb-asset-thumb wide" src={previewDataUrl} alt={title} />}
                  <div className="kb-asset-body">
                    <div className="kb-entry-name">{title}</div>
                    <div className="kb-entry-preview">{description.slice(0, 160)}{description.length > 160 ? "..." : ""}</div>
                    {renderGeneratedAssetDetails(asset)}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* World Rules */}
      <div className="kb-section">
        <button className="kb-section-header" onClick={() => toggleSection("world")}>
          <span>{expandedSections.world ? "v" : ">"} World Rules ({kb.worldRules.length})</span>
          <button className="kb-add-btn" onClick={e => { e.stopPropagation(); setEditTarget({ type: "worldRule" }); }}>+</button>
        </button>
        {expandedSections.world && kb.worldRules.map(r => (
          <div key={r.id} className="kb-entry">
            <div className="kb-entry-name">{r.title} <span className="kb-tag">{r.category}</span></div>
            <div className="kb-entry-actions">
              <button onClick={() => setEditTarget({ type: "worldRule", existing: r })}>Edit</button>
              <button onClick={() => handleDelete("worldRule", r.id)}>Del</button>
            </div>
          </div>
        ))}
      </div>

      {/* Plot Threads */}
      <div className="kb-section">
        <button className="kb-section-header" onClick={() => toggleSection("plot")}>
          <span>{expandedSections.plot ? "v" : ">"} Plot Threads ({kb.plotThreads.length})</span>
          <button className="kb-add-btn" onClick={e => { e.stopPropagation(); setEditTarget({ type: "plotThread" }); }}>+</button>
        </button>
        {expandedSections.plot && kb.plotThreads.map(t => (
          <div key={t.id} className="kb-entry">
            <div className="kb-entry-name">{t.title} <span className={`kb-status ${t.status}`}>{t.status}</span></div>
            <div className="kb-entry-actions">
              <button onClick={() => setEditTarget({ type: "plotThread", existing: t })}>Edit</button>
              <button onClick={() => handleDelete("plotThread", t.id)}>Del</button>
            </div>
          </div>
        ))}
      </div>

      {/* Tone & Style */}
      <div className="kb-section">
        <button className="kb-section-header" onClick={() => toggleSection("tone")}>
          <span>{expandedSections.tone ? "v" : ">"} Tone & Style</span>
        </button>
        {expandedSections.tone && (
          <div className="kb-tone-fields">
            <input className="kb-input-sm" placeholder="Genre" value={kb.toneStyle.genre} onChange={e => handleToneChange("genre", e.target.value)} />
            <input className="kb-input-sm" placeholder="Mood" value={kb.toneStyle.mood} onChange={e => handleToneChange("mood", e.target.value)} />
            <input className="kb-input-sm" placeholder="Target/director style (e.g. Kubrick restraint, Pixar emotional clarity)" value={kb.toneStyle.targetStyle} onChange={e => handleToneChange("targetStyle", e.target.value)} />
            <textarea className="kb-textarea-sm" placeholder="Pacing notes" value={kb.toneStyle.pacingNotes} onChange={e => handleToneChange("pacingNotes", e.target.value)} rows={2} />
            <textarea className="kb-textarea-sm" placeholder="Style constraints / blend notes (what to preserve, what to avoid)" value={kb.toneStyle.styleNotes} onChange={e => handleToneChange("styleNotes", e.target.value)} rows={3} />
          </div>
        )}
      </div>

      {/* Custom Notes */}
      <div className="kb-section">
        <button className="kb-section-header" onClick={() => toggleSection("notes")}>
          <span>{expandedSections.notes ? "v" : ">"} Notes ({kb.customNotes.length})</span>
          <button className="kb-add-btn" onClick={e => { e.stopPropagation(); setEditTarget({ type: "customNote" }); }}>+</button>
        </button>
        {expandedSections.notes && kb.customNotes.map(n => (
          <div key={n.id} className="kb-entry">
            <div className="kb-entry-name">{n.title}</div>
            <div className="kb-entry-actions">
              <button onClick={() => setEditTarget({ type: "customNote", existing: n })}>Edit</button>
              <button onClick={() => handleDelete("customNote", n.id)}>Del</button>
            </div>
          </div>
        ))}
      </div>

      {/* Style Profile */}
      <div className="kb-section">
        <button className="kb-section-header" onClick={() => toggleSection("style")}>
          <span>{expandedSections.style ? "v" : ">"} Style Profile {styleProfile ? "(active)" : ""}</span>
        </button>
        {expandedSections.style && (
          <div className="kb-style-section">
            {styleProfile && (
              <div className="kb-style-card">
                <div className="kb-style-row"><span>Tone:</span> {styleProfile.predominantTone}</div>
                <div className="kb-style-row"><span>POV:</span> {styleProfile.pov}</div>
                <div className="kb-style-row"><span>Tense:</span> {styleProfile.tense}</div>
                <div className="kb-style-row"><span>Vocab:</span> {styleProfile.vocabularyComplexity}</div>
                <div className="kb-style-row"><span>Dialogue:</span> {styleProfile.dialogueToActionRatio}</div>
                {styleProfile.samples?.length ? (
                  <div className="kb-style-row"><span>Samples:</span> {styleProfile.samples.length} file(s), {styleProfile.samples.reduce((sum, sample) => sum + sample.wordCount, 0)} words</div>
                ) : null}
                {styleProfile.confidenceScore ? (
                  <div className="kb-style-row"><span>Confidence:</span> {Math.round(styleProfile.confidenceScore)}/100</div>
                ) : null}
                {styleProfile.styleContract && (
                  <div className="kb-style-analysis"><strong>Style contract:</strong> {styleProfile.styleContract}</div>
                )}
                {styleProfile.doRules?.length ? (
                  <div className="kb-style-analysis"><strong>Do:</strong> {styleProfile.doRules.join("; ")}</div>
                ) : null}
                {styleProfile.avoidRules?.length ? (
                  <div className="kb-style-analysis"><strong>Avoid:</strong> {styleProfile.avoidRules.join("; ")}</div>
                ) : null}
                {styleProfile.rawAnalysis && (
                  <div className="kb-style-analysis">{styleProfile.rawAnalysis}</div>
                )}
              </div>
            )}
            <textarea
              className="kb-textarea-sm"
              placeholder="Paste a writing sample, or import txt/fountain/pdf/docx samples below..."
              value={styleSample}
              onChange={e => setStyleSample(e.target.value)}
              rows={4}
            />
            {styleSamples.length > 0 && (
              <div className="kb-style-samples">
                {styleSamples.map((sample, index) => (
                  <div key={`${sample.filename}-${index}`} className="kb-style-sample-row">
                    <span>{sample.filename}</span>
                    <button onClick={() => setStyleSamples((current) => current.filter((_, i) => i !== index))}>Remove</button>
                  </div>
                ))}
              </div>
            )}
            <div className="kb-style-actions">
              <button className="kb-action-btn" onClick={handleFileImport}>Import samples</button>
              <button className="kb-action-btn primary" onClick={handleAnalyzeStyle} disabled={analyzingStyle}>
                {analyzingStyle ? "Analyzing..." : "Analyze Style"}
              </button>
            </div>
            {styleError && <div className="kb-error">{styleError}</div>}
          </div>
        )}
      </div>

      {editTarget && (
        <KBEntryEditor
          type={editTarget.type}
          existing={editTarget.existing}
          onSave={handleSave}
          onClose={() => setEditTarget(null)}
        />
      )}
    </div>
  );
}
