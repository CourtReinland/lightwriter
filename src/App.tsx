import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { type EditorView } from "@codemirror/view";
import ArtisticBorder from "./components/Layout/ArtisticBorder";
import EditorToolbar from "./components/Editor/EditorToolbar";
import FountainEditor from "./components/Editor/FountainEditor";
import ScreenplayPreview from "./components/Preview/ScreenplayPreview";
import FrameworkPanel from "./components/Overlays/FrameworkPanel";
import OverlayLegend from "./components/Overlays/OverlayLegend";
import IndexCardView from "./components/IndexCards/IndexCardView";
import SuggestionPanel from "./components/Suggestions/SuggestionPanel";
import ProjectMenu from "./components/Editor/ProjectMenu";
import ElementBar, {
  type ElementType,
  getElementTemplate,
  detectElementType,
  stripForcePrefix,
} from "./components/Editor/ElementBar";
import KBPanel from "./components/KnowledgeBase/KBPanel";
import AssetPanel from "./components/Assets/AssetPanel";
import ExportPanel from "./components/Export/ExportPanel";
import LocationBar from "./components/Editor/LocationBar";
import { WorldStateService, findSceneAtLine } from "./services/worldStateService";
import AnalysisPanel from "./components/Analysis/AnalysisPanel";
import ToolReviewPane, { type ToolReviewData } from "./components/Suggestions/ToolReviewPane";
import { useFountainParser } from "./hooks/useFountainParser";
import { exportFountain, exportFdx, exportPdf } from "./services/fountainExporter";
import { VersionHistoryService, type VersionSnapshot } from "./services/versionHistoryService";
import {
  StorageService,
  type Project,
} from "./services/storageService";
import { KnowledgeBaseService, type KnowledgeBase } from "./services/knowledgeBase";
import { StyleProfileService, type StyleProfile } from "./services/styleProfile";
import { AssetService } from "./services/assetService";
import type { GeneratedAsset, AssetKind } from "./types/assets";
import type { ComputedBeat } from "./frameworks/utils";

const SAMPLE_FOUNTAIN = `Title: My Screenplay
Author: Writer Name
Draft date: 2026-03-22

====

INT. COFFEE SHOP - DAY

A cozy neighborhood cafe. Rain streaks down the windows. ALEX (30s, restless eyes) sits alone at a corner table, nursing a cold coffee.

ALEX
(muttering)
This is it. Today's the day.

A BARISTA approaches with a fresh pot.

BARISTA
Refill?

ALEX
No. I mean yes. I mean—

Alex stands abruptly, knocking the cup. Coffee spills across the table.

ALEX (CONT'D)
I'm sorry. I have to go.

EXT. CITY STREET - CONTINUOUS

Alex bursts through the door into the rain. No umbrella. No plan.

> CUT TO:

INT. APARTMENT - NIGHT

Alex sits at a desk, laptop open. The screen glows blue in the dark room.

ALEX (V.O.)
Every story needs a beginning. This is mine.

FADE OUT.
`;

function loadOrCreateInitialProject(): Project {
  // Try migrating legacy single-document storage
  const migrated = StorageService.migrateLegacy();
  if (migrated) return migrated;

  // Try loading the active project
  const activeId = StorageService.getActiveProjectId();
  if (activeId) {
    const project = StorageService.getProject(activeId);
    if (project) return project;
  }

  // Try loading any existing project
  const projects = StorageService.listProjects();
  if (projects.length > 0) {
    const first = StorageService.getProject(projects[0].id);
    if (first) {
      StorageService.setActiveProjectId(first.id);
      return first;
    }
  }

  // Create a fresh starter project
  const fresh = StorageService.createProject("Untitled Screenplay", SAMPLE_FOUNTAIN, 30);
  StorageService.setActiveProjectId(fresh.id);
  return fresh;
}

export default function App() {
  const [project, setProject] = useState<Project>(loadOrCreateInitialProject);
  const [activeView, setActiveView] = useState<"editor" | "preview" | "cards" | "analysis">("editor");
  const [selectedText, setSelectedText] = useState("");
  const [contextText, setContextText] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  // Whole-script tool (Expand Descriptions / Clean Up) review, shown in a big pane.
  const [toolReview, setToolReview] = useState<ToolReviewData | null>(null);
  const [toolReviewEdit, setToolReviewEdit] = useState("");
  const [showProjectMenu, setShowProjectMenu] = useState(false);
  const [editorKey, setEditorKey] = useState(0);
  const [currentElement, setCurrentElement] = useState<ElementType>("action");
  // Cards view state — persists across view switches
  const [cardConnectors, setCardConnectors] = useState<Record<number, string>>({});
  const [cardAiDescs, setCardAiDescs] = useState<Record<number, string>>({});
  const [cardAiEnabled, setCardAiEnabled] = useState(false);
  const [showKB, setShowKB] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [kbFocus, setKbFocus] = useState<"characters" | "scenes" | null>(null);
  const [kbNotice, setKbNotice] = useState("");
  const [knowledgeBase, setKnowledgeBase] = useState<KnowledgeBase>(() =>
    KnowledgeBaseService.getKB(loadOrCreateInitialProject().id),
  );
  const [styleProfile, setStyleProfile] = useState<StyleProfile | null>(() =>
    StyleProfileService.getProfile(loadOrCreateInitialProject().id),
  );
  const [assets, setAssets] = useState<GeneratedAsset[]>(() =>
    AssetService.getAssets(loadOrCreateInitialProject().id),
  );
  const [history, setHistory] = useState<VersionSnapshot[]>(() =>
    VersionHistoryService.ensureInitialized(project.id, project.content),
  );
  const [cursorBeats, setCursorBeats] = useState<ComputedBeat[]>([]);
  const [cursorLine, setCursorLine] = useState(0);

  const editorViewRef = useRef<EditorView>(null as unknown as EditorView);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined as unknown as ReturnType<typeof setTimeout>);
  // Version-history bookkeeping. forceNewEdit: the next typing edit should start a
  // fresh entry instead of collapsing into the tail (set after a restore).
  // suppressNextEdit: skip the one autosave caused by a programmatic content
  // replace (restore / project switch) so it doesn't overwrite history.
  const forceNewEditRef = useRef(false);
  const suppressNextEditRef = useRef(false);

  const { parsed, pageCount, scenes } = useFountainParser(project.content);

  // Auto-save project on content/settings changes (debounced 500ms).
  // The same tick records a version-history "edit" snapshot (collapsing typing
  // into one entry, deduped against the tail). AI-tool applies are recorded
  // separately and synchronously via handleAiCommit, so they seal their own
  // immutable entry and the autosave that follows is a dedup no-op.
  useEffect(() => {
    clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      StorageService.saveProject(project);
      if (suppressNextEditRef.current) {
        suppressNextEditRef.current = false;
      } else {
        const next = VersionHistoryService.recordEdit(
          project.id,
          project.content,
          forceNewEditRef.current,
        );
        if (next) {
          forceNewEditRef.current = false;
          setHistory(next);
        }
      }
    }, 500);
    return () => clearTimeout(autoSaveTimer.current);
  }, [project]);

  const updateProject = useCallback((updates: Partial<Project>) => {
    setProject((prev) => ({ ...prev, ...updates, updatedAt: Date.now() }));
  }, []);

  const handleContentChange = useCallback(
    (newContent: string) => {
      updateProject({ content: newContent });
    },
    [updateProject],
  );

  const handleTargetPagesChange = useCallback(
    (pages: number) => {
      updateProject({ targetPages: pages });
    },
    [updateProject],
  );

  const handleToggleFramework = useCallback(
    (frameworkId: string) => {
      setProject((prev) => ({
        ...prev,
        activeFrameworks: prev.activeFrameworks.includes(frameworkId)
          ? prev.activeFrameworks.filter((id) => id !== frameworkId)
          : [...prev.activeFrameworks, frameworkId],
        updatedAt: Date.now(),
      }));
    },
    [],
  );

  const handleSelectionChange = useCallback((sel: string, ctx: string) => {
    setSelectedText(sel);
    setContextText(ctx);

    // Detect current element type from cursor line
    const view = editorViewRef.current;
    if (view) {
      const pos = view.state.selection.main.head;
      const line = view.state.doc.lineAt(pos);
      setCurrentElement(detectElementType(line.text));
      setCursorLine(line.number);
    }
  }, []);

  const handleInsertElement = useCallback(
    (type: ElementType) => {
      const view = editorViewRef.current;
      if (!view) return;

      const pos = view.state.selection.main.head;
      const line = view.state.doc.lineAt(pos);
      const trimmed = line.text.trim();

      // If the line has content, CONVERT it using Beat's force-prefix approach:
      //   @ → Character, !! → Shot, ! → Action, . → Scene, > → Transition
      // First strip any existing prefix, then apply the new one.
      if (trimmed) {
        const { bare } = stripForcePrefix(trimmed);
        let newText: string;

        switch (type) {
          case "character":
            // Force character with @ prefix, uppercase the name
            newText = `@${bare.toUpperCase()}`;
            break;

          case "shot":
            // Force shot with !! prefix, uppercase
            newText = `!!${bare.toUpperCase()}`;
            break;

          case "action":
            // Force action with ! prefix IF the bare text is ALL CAPS
            // (otherwise it would auto-detect as character)
            if (bare === bare.toUpperCase() && /[A-Z]/.test(bare)) {
              newText = `!${bare}`;
            } else {
              newText = bare;
            }
            break;

          case "scene":
            // Force scene heading with . prefix (unless it already starts with INT/EXT)
            if (/^(INT|EXT|EST|INT\.\/EXT|I\/E)[.\s]/i.test(bare)) {
              newText = bare.toUpperCase();
            } else {
              newText = `.${bare.toUpperCase()}`;
            }
            break;

          case "transition":
            newText = `> ${bare.toUpperCase()}`;
            break;

          case "dialogue":
            // Dialogue: strip any prefix, keep text as-is
            newText = bare;
            break;

          case "parenthetical":
            if (!bare.startsWith("(")) {
              newText = `(${bare}`;
            } else {
              newText = bare;
            }
            if (!newText.endsWith(")")) {
              newText = `${newText})`;
            }
            break;

          default:
            newText = bare;
        }

        if (newText !== line.text) {
          view.dispatch({
            changes: { from: line.from, to: line.to, insert: newText },
          });
        }
      } else {
        // Empty line — insert a template for the type
        const template = getElementTemplate(type);
        if (template !== null) {
          view.dispatch({
            changes: { from: pos, insert: template },
            selection: { anchor: pos + template.length },
          });
        }
      }

      view.focus();
      setCurrentElement(type);
    },
    [],
  );

  const handleApplySuggestion = useCallback(
    (text: string) => {
      const view = editorViewRef.current;
      if (!view) return;
      const sel = view.state.selection.main;
      if (sel.from === sel.to) return;
      view.dispatch({
        changes: { from: sel.from, to: sel.to, insert: text },
      });
    },
    [],
  );

  const handleInsertBelow = useCallback(
    (text: string) => {
      const view = editorViewRef.current;
      if (!view) return;
      const sel = view.state.selection.main;
      const line = view.state.doc.lineAt(sel.to);
      view.dispatch({
        changes: { from: line.to, insert: "\n\n" + text },
      });
    },
    [],
  );

  const handleReplaceScript = useCallback(
    (text: string) => {
      const view = editorViewRef.current;
      if (!view) {
        handleContentChange(text);
        return;
      }
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        selection: { anchor: Math.min(text.length, view.state.selection.main.head) },
      });
      view.focus();
    },
    [handleContentChange],
  );

  const handleOpenToolReview = useCallback((review: ToolReviewData) => {
    setToolReview(review);
    setToolReviewEdit(review.afterScript);
  }, []);

  // Seal an immutable AI-tool snapshot in version history. Recorded with the
  // exact applied text BEFORE the editor content is replaced, so the following
  // autosave edit is a dedup no-op.
  const handleAiCommit = useCallback((label: string, text: string) => {
    setHistory(VersionHistoryService.recordAiCommit(project.id, text, label));
  }, [project.id]);

  const handleApplyToolReview = useCallback(() => {
    handleAiCommit(toolReview?.label || "AI tool", toolReviewEdit);
    handleReplaceScript(toolReviewEdit);
    setToolReview(null);
    setToolReviewEdit("");
  }, [handleAiCommit, handleReplaceScript, toolReview, toolReviewEdit]);

  // Restore a past snapshot into the editor. Non-destructive: suppress the
  // restore's own autosave, and force the next typing edit to start a new entry
  // so existing snapshots (including any "future" ones) are preserved.
  const handleRestoreVersion = useCallback((snap: VersionSnapshot) => {
    if (snap.content === project.content) return;
    suppressNextEditRef.current = true;
    forceNewEditRef.current = true;
    handleReplaceScript(snap.content);
  }, [handleReplaceScript, project.content]);

  // Insert freshly generated screenplay text at the cursor (replacing any
  // selection) and seal a "Generated" version checkpoint with the result.
  const handleInsertGenerated = useCallback((text: string) => {
    const view = editorViewRef.current;
    let nextContent: string;
    if (!view) {
      nextContent = project.content ? `${project.content}\n\n${text}` : text;
      handleContentChange(nextContent);
    } else {
      const sel = view.state.selection.main;
      view.dispatch({
        changes: { from: sel.from, to: sel.to, insert: text },
        selection: { anchor: sel.from + text.length },
      });
      view.focus();
      nextContent = view.state.doc.toString();
    }
    suppressNextEditRef.current = true;
    forceNewEditRef.current = true;
    setHistory(VersionHistoryService.recordAiCommit(project.id, nextContent, "Generated from prompt"));
  }, [handleContentChange, project.content, project.id]);

  // Whole-script replaces coming from the AI panel are either AI applies
  // (already sealed via handleAiCommit) or a revert of an applied rewrite —
  // neither is a typing edit, so suppress the resulting autosave and let the
  // next real edit start its own entry. Mirrors handleRestoreVersion.
  const handleSuggestionReplaceScript = useCallback((text: string) => {
    if (text !== project.content) {
      suppressNextEditRef.current = true;
      forceNewEditRef.current = true;
    }
    handleReplaceScript(text);
  }, [handleReplaceScript, project.content]);

  const handleDiscardToolReview = useCallback(() => {
    setToolReview(null);
    setToolReviewEdit("");
  }, []);

  const handleExportFountain = useCallback(() => {
    const filename = project.name.replace(/[^a-zA-Z0-9_-]/g, "_") + ".fountain";
    exportFountain(project.content, filename);
  }, [project]);

  const handleExportFdx = useCallback(() => {
    const filename = project.name.replace(/[^a-zA-Z0-9_-]/g, "_") + ".fdx";
    exportFdx(project.content, filename);
  }, [project]);

  const handleExportPdf = useCallback(() => {
    if (!parsed) return;
    exportPdf(parsed.html.script, parsed.html.title_page, project.name);
  }, [parsed, project.name]);

  const handleLoadProject = useCallback((loaded: Project) => {
    // Save current project first
    setProject((prev) => {
      StorageService.saveProject(prev);
      return prev;
    });
    StorageService.setActiveProjectId(loaded.id);
    setProject(loaded);
    setKnowledgeBase(KnowledgeBaseService.getKB(loaded.id));
    setStyleProfile(StyleProfileService.getProfile(loaded.id));
    setAssets(AssetService.getAssets(loaded.id));
    setHistory(VersionHistoryService.ensureInitialized(loaded.id, loaded.content));
    suppressNextEditRef.current = true; // the project-switch content change isn't an edit
    setEditorKey((k) => k + 1); // Force editor remount with new content
    setShowProjectMenu(false);
  }, []);

  const handleNewProject = useCallback((name: string, content?: string) => {
    // Save current project first
    setProject((prev) => {
      StorageService.saveProject(prev);
      return prev;
    });
    const newProj = StorageService.createProject(name, content || "", 120);
    StorageService.setActiveProjectId(newProj.id);
    setProject(newProj);
    setKnowledgeBase(KnowledgeBaseService.getKB(newProj.id));
    setStyleProfile(StyleProfileService.getProfile(newProj.id));
    setAssets(AssetService.getAssets(newProj.id));
    // First history entry is the open/import itself.
    setHistory(VersionHistoryService.recordOpen(newProj.id, content || "", content ? "Imported" : "New document"));
    suppressNextEditRef.current = true;
    setEditorKey((k) => k + 1);
    setShowProjectMenu(false);
  }, []);

  const totalLines = project.content.split("\n").length;

  const handleAssetGenerationComplete = useCallback((generated: GeneratedAsset[], kind: AssetKind) => {
    if (generated.length === 0) return;
    const updatedAssets = AssetService.getAssets(project.id);
    setAssets(updatedAssets);
    const mergedKB = KnowledgeBaseService.mergeGeneratedAssets(knowledgeBase, generated);
    KnowledgeBaseService.saveKB(mergedKB);
    setKnowledgeBase(mergedKB);
    if (kind === "character" || kind === "scene_set") {
      setKbFocus(kind === "character" ? "characters" : "scenes");
      setKbNotice(`Done — ${generated.length} ${kind === "character" ? "character" : "scene"} image${generated.length === 1 ? "" : "s"} generated and added to the Knowledge Base view.`);
      setShowSettings(false);
      setShowKB(true);
      setShowSuggestions(false);
      setShowExport(false);
    }
  }, [knowledgeBase, project.id]);

  // ── World State: link the scene at the cursor to a portable series location ──
  const [worldVersion, setWorldVersion] = useState(0);
  const currentScene = useMemo(
    () => (activeView === "editor" && project.seriesId ? findSceneAtLine(project.content, cursorLine) : null),
    [activeView, project.seriesId, project.content, cursorLine],
  );
  const seriesName = useMemo(
    () => (project.seriesId ? WorldStateService.getSeries(project.seriesId)?.name ?? "this series" : ""),
    [project.seriesId, worldVersion],
  );
  const sceneMatches = useMemo(
    () => (project.seriesId && currentScene ? WorldStateService.matchForHeading(project.seriesId, currentScene.heading) : []),
    [project.seriesId, currentScene, worldVersion],
  );
  const boundLocation = useMemo(() => {
    if (!project.seriesId || !currentScene) return null;
    const id = WorldStateService.boundLocationId(project.id, currentScene.index);
    return id ? WorldStateService.getLocation(id) : null;
  }, [project.seriesId, project.id, currentScene, worldVersion]);

  const handleBindScene = useCallback((locationId: string) => {
    if (!currentScene) return;
    WorldStateService.bindScene(project.id, currentScene.index, locationId);
    setWorldVersion((v) => v + 1);
  }, [currentScene, project.id]);

  const handleUnbindScene = useCallback(() => {
    if (!currentScene) return;
    WorldStateService.unbindScene(project.id, currentScene.index);
    setWorldVersion((v) => v + 1);
  }, [currentScene, project.id]);

  const handleQuickAddLocation = useCallback((token: string) => {
    if (!currentScene || !project.seriesId) return;
    const name = token
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase());
    const loc = WorldStateService.addLocation(project.seriesId, { name, aliases: [token.toUpperCase()] });
    WorldStateService.bindScene(project.id, currentScene.index, loc.id);
    setWorldVersion((v) => v + 1);
  }, [currentScene, project.seriesId, project.id]);

  return (
    <ArtisticBorder>
      <div className="app">
        <EditorToolbar
          pageCount={pageCount}
          targetPages={project.targetPages}
          onTargetPagesChange={handleTargetPagesChange}
          activeView={activeView}
          onViewChange={setActiveView}
          showSuggestions={showSuggestions}
          onToggleSuggestions={() => {
            setShowSuggestions(!showSuggestions);
            if (!showSuggestions) {
              setShowKB(false);
              setShowSettings(false);
              setShowExport(false);
            }
          }}
          showKB={showKB}
          onToggleKB={() => {
            setShowKB(!showKB);
            if (!showKB) {
              setShowSuggestions(false);
              setShowSettings(false);
              setShowExport(false);
              setKbNotice("");
            }
          }}
          showSettings={showSettings}
          onToggleSettings={() => {
            setShowSettings(!showSettings);
            if (!showSettings) {
              setShowKB(false);
              setShowSuggestions(false);
              setShowExport(false);
              setKbNotice("");
            }
          }}
          showExport={showExport}
          onToggleExport={() => {
            setShowExport(!showExport);
            if (!showExport) {
              setShowKB(false);
              setShowSuggestions(false);
              setShowSettings(false);
              setKbNotice("");
            }
          }}
          onOpenProjectMenu={() => setShowProjectMenu(true)}
          projectName={project.name}
        />
        <div className="app-workspace">
          {toolReview && (
            <ToolReviewPane
              review={toolReview}
              editText={toolReviewEdit}
              onEdit={setToolReviewEdit}
              onApply={handleApplyToolReview}
              onDiscard={handleDiscardToolReview}
            />
          )}
          <div className="workspace-main">
            {activeView === "editor" && (
              <ElementBar
                currentElement={currentElement}
                onInsertElement={handleInsertElement}
              />
            )}
            {activeView === "editor" && currentScene && currentScene.token && (
              <LocationBar
                scene={currentScene}
                seriesName={seriesName}
                boundLocation={boundLocation}
                matches={sceneMatches}
                onBind={handleBindScene}
                onUnbind={handleUnbindScene}
                onQuickAdd={handleQuickAddLocation}
              />
            )}
            {activeView === "editor" && (
              <FountainEditor
                key={editorKey}
                content={project.content}
                onChange={handleContentChange}
                activeFrameworks={project.activeFrameworks}
                targetPages={project.targetPages}
                onSelectionChange={handleSelectionChange}
                onElementChange={setCurrentElement}
                onCursorBeatChange={setCursorBeats}
                viewRef={editorViewRef}
              />
            )}
            {activeView === "preview" && parsed && (
              <ScreenplayPreview
                html={parsed.html.script}
                titlePageHtml={parsed.html.title_page}
              />
            )}
            {activeView === "preview" && !parsed && (
              <div className="loading-message">Parsing screenplay...</div>
            )}
            {activeView === "cards" && (
              <IndexCardView
                scenes={scenes}
                totalLines={totalLines}
                targetPages={project.targetPages}
                content={project.content}
                onContentChange={handleContentChange}
                connectors={cardConnectors}
                onConnectorsChange={setCardConnectors}
                aiDescs={cardAiDescs}
                onAiDescsChange={setCardAiDescs}
                aiEnabled={cardAiEnabled}
                onAiEnabledChange={setCardAiEnabled}
              />
            )}
            {activeView === "analysis" && (
              <AnalysisPanel
                projectId={project.id}
                content={project.content}
                knowledgeBase={knowledgeBase}
                styleProfile={styleProfile}
                activeFrameworks={project.activeFrameworks}
                targetPages={project.targetPages}
              />
            )}
          </div>
          {activeView === "editor" && showSuggestions && (
            <SuggestionPanel
              selectedText={selectedText}
              contextText={contextText}
              fullScript={project.content}
              cursorLine={cursorLine}
              cursorBeats={cursorBeats}
              knowledgeBase={knowledgeBase}
              styleProfile={styleProfile}
              targetPages={project.targetPages}
              activeFrameworks={project.activeFrameworks}
              project={project}
              assets={assets}
              onAssetsChange={setAssets}
              onGenerationComplete={handleAssetGenerationComplete}
              onApply={handleApplySuggestion}
              onInsertBelow={handleInsertBelow}
              onReplaceScript={handleSuggestionReplaceScript}
              onInsertGenerated={handleInsertGenerated}
              onAiCommit={handleAiCommit}
              onOpenToolReview={handleOpenToolReview}
            />
          )}
          {activeView === "editor" && showKB && (
            <KBPanel
              kb={knowledgeBase}
              onKBChange={setKnowledgeBase}
              styleProfile={styleProfile}
              onStyleChange={setStyleProfile}
              project={project}
              scriptContent={project.content}
              projectId={project.id}
              assets={assets}
              onAssetsChange={setAssets}
              onGenerationComplete={handleAssetGenerationComplete}
              history={history}
              onRestoreVersion={handleRestoreVersion}
              onAssignSeries={(seriesId) => updateProject({ seriesId })}
              focusSection={kbFocus}
              notice={kbNotice}
              onClearNotice={() => setKbNotice("")}
            />
          )}
          {activeView === "editor" && showSettings && (
            <AssetPanel
              mode="settings"
              project={project}
              assets={assets}
              onAssetsChange={setAssets}
              onGenerationComplete={handleAssetGenerationComplete}
            />
          )}
          {activeView === "editor" && showExport && (
            <ExportPanel
              project={project}
              assets={assets}
              onExportFountain={handleExportFountain}
              onExportFdx={handleExportFdx}
              onExportPdf={handleExportPdf}
              canExportPdf={!!parsed}
            />
          )}
          {activeView === "editor" && (
            <div className="workspace-sidebar">
              <FrameworkPanel
                activeFrameworks={project.activeFrameworks}
                onToggle={handleToggleFramework}
                targetPages={project.targetPages}
              />
              <OverlayLegend
                activeFrameworks={project.activeFrameworks}
                targetPages={project.targetPages}
                totalLines={totalLines}
              />
            </div>
          )}
        </div>
        {showProjectMenu && (
          <ProjectMenu
            currentProject={project}
            onLoadProject={handleLoadProject}
            onNewProject={handleNewProject}
            onClose={() => setShowProjectMenu(false)}
          />
        )}
      </div>
    </ArtisticBorder>
  );
}
