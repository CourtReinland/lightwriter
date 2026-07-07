import { useState, useCallback, useEffect, useMemo } from "react";
import {
  KnowledgeBaseService,
  parsePlotThreadsFromTableText,
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
import type { AssetProvider, AssetKind, GeneratedAsset } from "../../types/assets";
import type { Project } from "../../services/storageService";
import type { VersionSnapshot } from "../../services/versionHistoryService";
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
import WorldSection from "./WorldSection";
import SeriesRecordsPanel from "../Series/SeriesRecordsPanel";
import { WorldStateService, extractLocationToken, type WorldCharacter, type WorldLocation } from "../../services/worldStateService";
import "./KBPanel.css";

const COMMON_GENRES = [
  "Drama", "Comedy", "Dramedy", "Coming-of-age", "Romance", "Romantic comedy",
  "Thriller", "Mystery", "Crime", "Noir", "Horror", "Sci-Fi", "Fantasy",
  "Family", "Adventure", "Action", "Animation", "Musical", "Documentary",
  "Slice of life", "Historical", "Western",
];

// Title-case a heading token without capitalizing the letter after an apostrophe
// ("AIDEN'S ROOM" -> "Aiden's Room", not "Aiden'S Room").
function titleCaseToken(token: string): string {
  return token.toLowerCase().replace(/(^|[\s-])([a-z])/g, (_m, p, c) => p + c.toUpperCase());
}

function versionGlyph(type: VersionSnapshot["type"]): string {
  if (type === "open") return "[ ]"; // opened / imported document
  if (type === "ai") return "[*]"; // AI-tool commit
  return "[~]"; // typing edits
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 45_000) return "just now";
  const mins = Math.round(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(diff / 3_600_000);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(diff / 86_400_000);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

interface KBPanelProps {
  kb: KnowledgeBase;
  onKBChange: (kb: KnowledgeBase) => void;
  styleProfile: StyleProfile | null;
  onStyleChange: (profile: StyleProfile | null) => void;
  scriptContent: string;
  projectId: string;
  project: Project;
  assets: GeneratedAsset[];
  onAssetsChange: (assets: GeneratedAsset[]) => void;
  onGenerationComplete?: (assets: GeneratedAsset[], kind: AssetKind) => void;
  history?: VersionSnapshot[];
  onRestoreVersion?: (snap: VersionSnapshot) => void;
  onAssignSeries?: (seriesId: string | undefined) => void;
  /** Bump App's worldVersion when series scenes/characters change (gutter + AI context). */
  onWorldChange?: () => void;
  /** App-level world version — recomputes series counts & lists when records change anywhere. */
  worldVersion?: number;
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
  project,
  assets,
  onAssetsChange,
  onGenerationComplete,
  history = [],
  onRestoreVersion,
  onAssignSeries,
  onWorldChange,
  worldVersion = 0,
  focusSection,
  notice,
  onClearNotice,
}: KBPanelProps) {
  const [editTarget, setEditTarget] = useState<EditTarget>(null);
  const [genreCustom, setGenreCustom] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    history: true,
    series: false,
    characters: true,
    scenes: false,
    generate: false,
    world: false,
    plot: false,
    tone: false,
    notes: false,
    style: false,
  });
  const [styleSample, setStyleSample] = useState("");
  const [styleSamples, setStyleSamples] = useState<AnalyzeStyleSampleInput[]>([]);
  const [plotImporting, setPlotImporting] = useState(false);
  const [plotImportError, setPlotImportError] = useState<string | null>(null);
  const [plotImportNotice, setPlotImportNotice] = useState<string | null>(null);
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
  const norm = (s: string) => s.trim().toLowerCase();

  // Series-scoped records (the portable home for characters/scenes). These render
  // via SeriesRecordsPanel at the top of each section; their names are used to
  // de-duplicate the per-project lists so a promoted entry doesn't show twice.
  const seriesId = project.seriesId;
  const seriesCharacters = useMemo(() => (seriesId ? WorldStateService.listCharacters(seriesId) : []), [seriesId, worldVersion]);
  const seriesLocations = useMemo(() => (seriesId ? WorldStateService.listLocations(seriesId) : []), [seriesId, worldVersion]);
  const seriesCharacterCount = seriesCharacters.length;
  const seriesSceneCount = seriesLocations.length;
  const seriesCharNames = useMemo(() => new Set(seriesCharacters.map((c) => norm(c.name))), [seriesCharacters]);
  // Match on the location's human name only — a series location ("Kitchen") and a
  // per-project scene heading ("INT. KITCHEN - DAY") are different granularities,
  // so don't hide every heading that shares a location token.
  const seriesSceneNames = useMemo(() => new Set(seriesLocations.map((l) => norm(l.name))), [seriesLocations]);

  // Merge each KB entity with its generated image into a single list, so a
  // character/scene shows its thumbnail inline. Entities with no image still
  // appear; images with no matching KB entry are appended so nothing is lost.
  // Entries already represented by a series record are dropped (shown above).
  const mergedCharacters = useMemo(() => {
    const map = new Map<string, { key: string; name: string; description: string; asset: GeneratedAsset | null; character: KBCharacter | null }>();
    for (const c of kb.characters) map.set(norm(c.name), { key: c.id, name: c.name, description: c.description, asset: null, character: c });
    for (const { asset, title, description } of characterAssetItems) {
      const k = norm(title);
      const existing = map.get(k);
      if (existing) existing.asset = asset;
      else map.set(k, { key: asset.id, name: title, description, asset, character: null });
    }
    return [...map.values()].filter((item) => !seriesCharNames.has(norm(item.name)));
  }, [kb.characters, characterAssetItems, seriesCharNames]);
  const mergedScenes = useMemo(() => {
    const map = new Map<string, { key: string; name: string; description: string; asset: GeneratedAsset | null; scene: KBScene | null }>();
    for (const s of kb.scenes || []) map.set(norm(s.heading), { key: s.id, name: s.heading, description: s.description, asset: null, scene: s });
    for (const { asset, title, description } of sceneAssetItems) {
      const k = norm(title);
      const existing = map.get(k);
      if (existing) existing.asset = asset;
      else map.set(k, { key: asset.id, name: title, description, asset, scene: null });
    }
    return [...map.values()].filter((item) => !seriesSceneNames.has(norm(item.name)));
  }, [kb.scenes, sceneAssetItems, seriesSceneNames]);

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

  const handleSectionKeyDown = (e: React.KeyboardEvent, key: string) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggleSection(key);
    }
  };

  // Attach an uploaded/generated image to a character/scene entry as a per-project
  // GeneratedAsset, so it merges into the KB list (by name) and feeds Export.
  // Upserts by name+kind so re-saving an entry replaces its image instead of
  // accumulating duplicate asset records.
  const attachImageAsset = useCallback(async (type: string, name: string, image: { dataUrl: string; mimeType: string }, sceneIndex?: number) => {
    if (!name.trim()) return;
    const kind: AssetKind = type === "character" ? "character" : "scene_set";
    try {
      const filePath = await persistGeneratedImageFile({ projectId, name, mimeType: image.mimeType, dataUrl: image.dataUrl });
      const request: ImageGenerationRequest = {
        projectId,
        kind,
        provider: "gemini-nano-banana",
        model: "",
        name,
        prompt: "",
        // Carry the scene index when known so the export binds the image to the
        // right scene (not the default "0"); a manual scene with no index stays
        // unbound and is skipped from the manifest's locations.
        scriptRef: { scriptHash: "", ...(type === "character" ? { characterName: name } : { sceneHeading: name, sceneIndex }) },
        aspectRatio: type === "character" ? "2:3" : "16:9",
      };
      const generated = buildGeneratedAssetFromResult(request, { mimeType: image.mimeType, imageDataUrl: image.dataUrl, filePath: filePath || undefined });
      const key = name.trim().toLowerCase();
      const existing = AssetService.getAssets(projectId).find(
        (a) => a.kind === kind && ((type === "character" ? a.scriptRef.characterName : a.scriptRef.sceneHeading) || a.name || "").trim().toLowerCase() === key,
      );
      if (existing) {
        AssetService.updateAsset(projectId, existing.id, { imageDataUrl: generated.imageDataUrl, filePath: generated.filePath, mimeType: generated.mimeType });
      } else {
        AssetService.addAsset(projectId, generated);
      }
      onAssetsChange(AssetService.getAssets(projectId));
    } catch {
      /* best-effort; the text entry is already saved */
    }
  }, [projectId, onAssetsChange]);

  // Save a character/scene to the SERIES database (the portable home), text +
  // image together, upserting by name. Used whenever the project is in a series.
  const saveSeriesRecord = useCallback(async (type: "character" | "scene", fields: Record<string, unknown>, image?: { dataUrl: string; mimeType: string }) => {
    const sid = project.seriesId;
    if (!sid) return;
    try {
      if (type === "character") {
        const name = ((fields.name as string) || "").trim();
        if (!name) return;
        // Fresh read (don't trust a worldVersion-stale memo) for the upsert match.
        const existing = WorldStateService.listCharacters(sid).find((c) => norm(c.name) === norm(name));
        const rec = existing
          ? WorldStateService.updateCharacter(existing.id, {
              description: (fields.description as string) || "",
              traits: (fields.traits as string[]) || [],
              voiceNotes: (fields.voiceNotes as string) || undefined,
            })
          : WorldStateService.addCharacter(sid, {
              name,
              description: (fields.description as string) || "",
              traits: (fields.traits as string[]) || [],
              voiceNotes: (fields.voiceNotes as string) || undefined,
            });
        // attachRecordImage owns disk persistence + inline-blob stripping.
        if (rec && image) {
          await WorldStateService.attachRecordImage("character", rec.id, image.dataUrl, image.mimeType);
        }
      } else {
        const heading = ((fields.heading as string) || "").trim();
        if (!heading) return;
        const token = (extractLocationToken(heading) || heading).toUpperCase();
        const existing = WorldStateService.listLocations(sid).find((l) => norm(l.name) === norm(token) || l.aliases.some((a) => norm(a) === norm(token)));
        const rec = existing
          ? // Merge: keep the curated name + aliases, just fold in the token + description.
            WorldStateService.updateLocation(existing.id, {
              aliases: Array.from(new Set([...existing.aliases, token])),
              description: (fields.description as string) || existing.description,
            })
          : WorldStateService.addLocation(sid, {
              name: titleCaseToken(token),
              aliases: [token],
              description: (fields.description as string) || "",
            });
        if (rec && image) {
          await WorldStateService.attachRecordImage("scene", rec.id, image.dataUrl, image.mimeType);
        }
      }
      onWorldChange?.();
    } catch {
      /* best-effort */
    }
  }, [project.seriesId, onWorldChange]);

  const handleSave = useCallback((type: string, data: Record<string, unknown>) => {
    const { __image, ...fields } = data as { __image?: { dataUrl: string; mimeType: string } } & Record<string, unknown>;
    const existingId = editTarget?.existing && "id" in editTarget.existing ? editTarget.existing.id : null;

    // In a series, NEW characters & scenes are created in the series database
    // (text + image). Editing an existing per-project KB entry stays on the KB
    // path below so its edits actually apply (and it isn't orphaned).
    if (!existingId && (type === "character" || type === "scene") && project.seriesId) {
      void saveSeriesRecord(type, fields, __image);
      setEditTarget(null);
      return;
    }

    let updated = kb;

    switch (type) {
      case "character":
        updated = existingId
          ? KnowledgeBaseService.updateCharacter(kb, existingId, fields as Partial<KBCharacter>)
          : KnowledgeBaseService.addCharacter(kb, fields as Omit<KBCharacter, "id">);
        break;
      case "scene":
        updated = existingId
          ? KnowledgeBaseService.updateScene(kb, existingId, fields as Partial<KBScene>)
          : KnowledgeBaseService.addScene(kb, fields as Omit<KBScene, "id">);
        break;
      case "worldRule":
        updated = existingId
          ? KnowledgeBaseService.updateWorldRule(kb, existingId, fields as Partial<KBWorldRule>)
          : KnowledgeBaseService.addWorldRule(kb, fields as Omit<KBWorldRule, "id">);
        break;
      case "plotThread":
        updated = existingId
          ? KnowledgeBaseService.updatePlotThread(kb, existingId, fields as Partial<KBPlotThread>)
          : KnowledgeBaseService.addPlotThread(kb, fields as Omit<KBPlotThread, "id">);
        break;
      case "customNote":
        updated = existingId
          ? KnowledgeBaseService.updateCustomNote(kb, existingId, fields as Partial<KBCustomNote>)
          : KnowledgeBaseService.addCustomNote(kb, fields as Omit<KBCustomNote, "id">);
        break;
    }

    KnowledgeBaseService.saveKB(updated);
    onKBChange(updated);
    if (__image && (type === "character" || type === "scene")) {
      const name = (type === "character" ? fields.name : fields.heading) as string;
      const sceneIndex = type === "scene" ? (fields.sceneIndex as number | undefined) : undefined;
      void attachImageAsset(type, name || "", __image, sceneIndex);
    }
    setEditTarget(null);
  }, [kb, editTarget, onKBChange, attachImageAsset, project.seriesId, saveSeriesRecord]);

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
      setRepromptError(`Add a ${providerLabel(repromptProvider)} API key in Settings first.`);
      return;
    }
    if (!settings.selectedModel?.trim()) {
      setRepromptError(`Choose a ${providerLabel(repromptProvider)} image model in Settings first.`);
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
    input.accept = ".txt,.fountain,.pdf,.docx,.xlsx,.xls";
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

  const handlePlotThreadImport = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".xlsx,.xls,.csv,.txt";
    input.multiple = true;
    input.onchange = async () => {
      const files = Array.from(input.files || []);
      if (!files.length) return;
      setPlotImporting(true);
      setPlotImportError(null);
      setPlotImportNotice(null);
      try {
        const imported = await Promise.all(files.map(async (file) => parsePlotThreadsFromTableText(await importFile(file))));
        const threads = imported.flat();
        if (!threads.length) {
          setPlotImportError("No plot threads found. Use columns like Thread/Title, Status, and Description.");
          return;
        }
        const before = kb.plotThreads.length;
        const updated = KnowledgeBaseService.mergePlotThreads(kb, threads);
        const added = updated.plotThreads.length - before;
        KnowledgeBaseService.saveKB(updated);
        onKBChange(updated);
        setPlotImportNotice(`Imported ${added} new plot thread${added === 1 ? "" : "s"}${threads.length > added ? `; skipped ${threads.length - added} duplicate${threads.length - added === 1 ? "" : "s"}` : ""}.`);
      } catch (error) {
        setPlotImportError(error instanceof Error ? error.message : "Could not import plot threads from that file.");
      } finally {
        setPlotImporting(false);
      }
    };
    input.click();
  }, [kb, onKBChange]);

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

  // The active version is the most recent snapshot whose content matches the
  // current editor text (highlighted in the history list).
  const activeVersionIdx = useMemo(() => {
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].content === scriptContent) return i;
    }
    return -1;
  }, [history, scriptContent]);

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

      {/* Version History — open/import → typing (collapses) → each AI tool seals a snapshot */}
      <div className="kb-section">
        <div className="kb-section-header" role="button" tabIndex={0} onClick={() => toggleSection("history")} onKeyDown={(e) => handleSectionKeyDown(e, "history")}>
          <span>{expandedSections.history ? "v" : ">"} Version History ({history.length})</span>
        </div>
        {expandedSections.history && (
          <div className="kb-history">
            {history.length === 0 && <div className="kb-empty">No history yet.</div>}
            {history.map((snap, idx) => (
              <button
                key={snap.id}
                type="button"
                className={`kb-history-row ${idx === activeVersionIdx ? "active" : ""}`}
                onClick={() => onRestoreVersion?.(snap)}
                disabled={!onRestoreVersion || idx === activeVersionIdx}
                title={idx === activeVersionIdx ? "Current version" : `Restore: ${snap.label}`}
              >
                <span className={`kb-history-glyph kb-history-${snap.type}`}>{versionGlyph(snap.type)}</span>
                <span className="kb-history-label">{snap.label}</span>
                <span className="kb-history-time">{idx === activeVersionIdx ? "current" : relativeTime(snap.createdAt)}</span>
              </button>
            ))}
            <div className="kb-history-hint">Click an earlier version to restore it. Each AI tool run is saved as a checkpoint.</div>
          </div>
        )}
      </div>

      {/* Series — assign this script to a series; shared scenes & characters live in the sections below */}
      <div className="kb-section">
        <div className="kb-section-header" role="button" tabIndex={0} onClick={() => toggleSection("series")} onKeyDown={(e) => handleSectionKeyDown(e, "series")}>
          <span>{expandedSections.series ? "v" : ">"} Series</span>
        </div>
        {expandedSections.series && (
          <WorldSection project={project} onAssignSeries={onAssignSeries || (() => {})} />
        )}
      </div>

      {/* Characters */}
      <div className="kb-section">
        <div className="kb-section-header" role="button" tabIndex={0} onClick={() => toggleSection("characters")} onKeyDown={(e) => handleSectionKeyDown(e, "characters")}>
          <span>{expandedSections.characters ? "v" : ">"} Characters ({mergedCharacters.length + seriesCharacterCount})</span>
          <button className="kb-add-btn" onClick={e => { e.stopPropagation(); setEditTarget({ type: "character" }); }}>+</button>
        </div>
        {expandedSections.characters && (
          <>
            {project.seriesId && (
              <SeriesRecordsPanel seriesId={project.seriesId} kind="character" onChange={onWorldChange} refreshKey={worldVersion} />
            )}
            {mergedCharacters.length === 0 && seriesCharacterCount === 0 && <div className="kb-empty">No characters yet — Scan Script, generate a portrait, or add one with +.</div>}
            {mergedCharacters.map(item => {
              const previewDataUrl = item.asset ? (item.asset.imageDataUrl || assetPreviewDataUrls[item.asset.id]) : null;
              return (
                <div key={item.key} className="kb-asset-entry">
                  {previewDataUrl
                    ? <img className="kb-asset-thumb" src={previewDataUrl} alt={item.name} />
                    : <div className="kb-asset-thumb kb-thumb-empty">no image</div>}
                  <div className="kb-asset-body">
                    <div className="kb-entry-name">{item.name}</div>
                    <div className="kb-entry-preview">{item.description.slice(0, 160)}{item.description.length > 160 ? "..." : ""}</div>
                    {item.asset && renderGeneratedAssetDetails(item.asset)}
                    {item.character && (
                      <div className="kb-entry-actions">
                        <button onClick={() => setEditTarget({ type: "character", existing: item.character! })}>Edit</button>
                        <button onClick={() => handleDelete("character", item.character!.id)}>Del</button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* Scenes */}
      <div className="kb-section">
        <div className="kb-section-header" role="button" tabIndex={0} onClick={() => toggleSection("scenes")} onKeyDown={(e) => handleSectionKeyDown(e, "scenes")}>
          <span>{expandedSections.scenes ? "v" : ">"} Scenes ({mergedScenes.length + seriesSceneCount})</span>
          <button className="kb-add-btn" onClick={e => { e.stopPropagation(); setEditTarget({ type: "scene" }); }}>+</button>
        </div>
        {expandedSections.scenes && (
          <>
            {project.seriesId && (
              <SeriesRecordsPanel seriesId={project.seriesId} kind="scene" onChange={onWorldChange} refreshKey={worldVersion} />
            )}
            {mergedScenes.length === 0 && seriesSceneCount === 0 && <div className="kb-empty">No scenes yet — Scan Script, generate a scene image, or add one with +.</div>}
            {mergedScenes.map(item => {
              const previewDataUrl = item.asset ? (item.asset.imageDataUrl || assetPreviewDataUrls[item.asset.id]) : null;
              return (
                <div key={item.key} className="kb-asset-entry">
                  {previewDataUrl
                    ? <img className="kb-asset-thumb wide" src={previewDataUrl} alt={item.name} />
                    : <div className="kb-asset-thumb wide kb-thumb-empty">no image</div>}
                  <div className="kb-asset-body">
                    <div className="kb-entry-name">{item.name}</div>
                    <div className="kb-entry-preview">{item.description.slice(0, 160)}{item.description.length > 160 ? "..." : ""}</div>
                    {item.asset && renderGeneratedAssetDetails(item.asset)}
                    {item.scene && (
                      <div className="kb-entry-actions">
                        <button onClick={() => setEditTarget({ type: "scene", existing: item.scene! })}>Edit</button>
                        <button onClick={() => handleDelete("scene", item.scene!.id)}>Del</button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>

      {/* Image generation moved to the AI tab — KB now just tracks the results. */}
      <div className="kb-section">
        <div className="kb-empty">Generate scene &amp; character images in the <strong>AI</strong> tab → “Image Generation”. They show up in the lists above.</div>
      </div>

      {/* World Rules */}
      <div className="kb-section">
        <div className="kb-section-header" role="button" tabIndex={0} onClick={() => toggleSection("world")} onKeyDown={(e) => handleSectionKeyDown(e, "world")}>
          <span>{expandedSections.world ? "v" : ">"} World Rules ({kb.worldRules.length})</span>
          <button className="kb-add-btn" onClick={e => { e.stopPropagation(); setEditTarget({ type: "worldRule" }); }}>+</button>
        </div>
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
        <div className="kb-section-header" role="button" tabIndex={0} onClick={() => toggleSection("plot")} onKeyDown={(e) => handleSectionKeyDown(e, "plot")}>
          <span>{expandedSections.plot ? "v" : ">"} Plot Threads ({kb.plotThreads.length})</span>
          <button className="kb-add-btn" onClick={e => { e.stopPropagation(); setEditTarget({ type: "plotThread" }); }}>+</button>
        </div>
        {expandedSections.plot && (
          <>
            <div className="kb-entry-actions kb-import-actions">
              <button onClick={handlePlotThreadImport} disabled={plotImporting}>{plotImporting ? "Importing..." : "Import Excel/CSV"}</button>
            </div>
            {plotImportNotice && <div className="kb-notice inline">{plotImportNotice}</div>}
            {plotImportError && <div className="kb-error">{plotImportError}</div>}
            {kb.plotThreads.map(t => (
              <div key={t.id} className="kb-entry">
                <div className="kb-entry-name">{t.title} <span className={`kb-status ${t.status}`}>{t.status}</span></div>
                <div className="kb-entry-actions">
                  <button onClick={() => setEditTarget({ type: "plotThread", existing: t })}>Edit</button>
                  <button onClick={() => handleDelete("plotThread", t.id)}>Del</button>
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Tone & Style */}
      <div className="kb-section">
        <div className="kb-section-header" role="button" tabIndex={0} onClick={() => toggleSection("tone")} onKeyDown={(e) => handleSectionKeyDown(e, "tone")}>
          <span>{expandedSections.tone ? "v" : ">"} Tone & Style</span>
        </div>
        {expandedSections.tone && (
          <div className="kb-tone-fields">
            <label className="kb-field-label">Genre {kb.toneStyle.genre ? <span className="kb-detected">(AI: {kb.toneStyle.genre})</span> : <span className="kb-detected">— Scan Script to detect</span>}</label>
            <select
              className="kb-input-sm"
              value={(genreCustom || (!!kb.toneStyle.genre && !COMMON_GENRES.includes(kb.toneStyle.genre))) ? "__custom__" : kb.toneStyle.genre}
              onChange={e => {
                const v = e.target.value;
                if (v === "__custom__") { setGenreCustom(true); }
                else { setGenreCustom(false); handleToneChange("genre", v); }
              }}
            >
              <option value="">Genre… (pick or Scan Script)</option>
              {COMMON_GENRES.map(g => <option key={g} value={g}>{g}</option>)}
              <option value="__custom__">Custom…</option>
            </select>
            {(genreCustom || (!!kb.toneStyle.genre && !COMMON_GENRES.includes(kb.toneStyle.genre))) && (
              <input className="kb-input-sm" placeholder="Custom genre" value={kb.toneStyle.genre} onChange={e => handleToneChange("genre", e.target.value)} />
            )}
            <input className="kb-input-sm" placeholder="Mood" value={kb.toneStyle.mood} onChange={e => handleToneChange("mood", e.target.value)} />
            <input className="kb-input-sm" placeholder="Target/director style (e.g. Kubrick restraint, Pixar emotional clarity)" value={kb.toneStyle.targetStyle} onChange={e => handleToneChange("targetStyle", e.target.value)} />
            <textarea className="kb-textarea-sm" placeholder="Pacing notes" value={kb.toneStyle.pacingNotes} onChange={e => handleToneChange("pacingNotes", e.target.value)} rows={2} />
            <textarea className="kb-textarea-sm" placeholder="Style constraints / blend notes (what to preserve, what to avoid)" value={kb.toneStyle.styleNotes} onChange={e => handleToneChange("styleNotes", e.target.value)} rows={3} />
          </div>
        )}
      </div>

      {/* Custom Notes */}
      <div className="kb-section">
        <div className="kb-section-header" role="button" tabIndex={0} onClick={() => toggleSection("notes")} onKeyDown={(e) => handleSectionKeyDown(e, "notes")}>
          <span>{expandedSections.notes ? "v" : ">"} Notes ({kb.customNotes.length})</span>
          <button className="kb-add-btn" onClick={e => { e.stopPropagation(); setEditTarget({ type: "customNote" }); }}>+</button>
        </div>
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
        <div className="kb-section-header" role="button" tabIndex={0} onClick={() => toggleSection("style")} onKeyDown={(e) => handleSectionKeyDown(e, "style")}>
          <span>{expandedSections.style ? "v" : ">"} Style Profile {styleProfile ? "(active)" : ""}</span>
        </div>
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
              placeholder="Paste a writing sample, or import txt/fountain/pdf/docx/xlsx samples below..."
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
          projectId={projectId}
          onSave={handleSave}
          onClose={() => setEditTarget(null)}
        />
      )}
    </div>
  );
}
