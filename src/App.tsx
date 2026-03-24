import { useState, useCallback, useRef, useEffect } from "react";
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
import { useFountainParser } from "./hooks/useFountainParser";
import { exportFountain, exportFdx, exportPdf } from "./services/fountainExporter";
import {
  StorageService,
  type Project,
} from "./services/storageService";

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
  const [activeView, setActiveView] = useState<"editor" | "preview" | "cards">("editor");
  const [selectedText, setSelectedText] = useState("");
  const [contextText, setContextText] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showProjectMenu, setShowProjectMenu] = useState(false);
  const [editorKey, setEditorKey] = useState(0);
  const [currentElement, setCurrentElement] = useState<ElementType>("action");
  // Cards view state — persists across view switches
  const [cardConnectors, setCardConnectors] = useState<Record<number, string>>({});
  const [cardAiDescs, setCardAiDescs] = useState<Record<number, string>>({});
  const [cardAiEnabled, setCardAiEnabled] = useState(false);

  const editorViewRef = useRef<EditorView>(null as unknown as EditorView);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined as unknown as ReturnType<typeof setTimeout>);

  const { parsed, pageCount, scenes } = useFountainParser(project.content);

  // Auto-save project on content/settings changes (debounced 500ms)
  useEffect(() => {
    clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      StorageService.saveProject(project);
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
    setEditorKey((k) => k + 1);
    setShowProjectMenu(false);
  }, []);

  const totalLines = project.content.split("\n").length;

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
          onToggleSuggestions={() => setShowSuggestions(!showSuggestions)}
          onExport={handleExportFountain}
          onExportFdx={handleExportFdx}
          onExportPdf={handleExportPdf}
          onOpenProjectMenu={() => setShowProjectMenu(true)}
          projectName={project.name}
        />
        <div className="app-workspace">
          <div className="workspace-main">
            {activeView === "editor" && (
              <ElementBar
                currentElement={currentElement}
                onInsertElement={handleInsertElement}
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
          </div>
          {activeView === "editor" && showSuggestions && (
            <SuggestionPanel
              selectedText={selectedText}
              contextText={contextText}
              onApply={handleApplySuggestion}
              onInsertBelow={handleInsertBelow}
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
