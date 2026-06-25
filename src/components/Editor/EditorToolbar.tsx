import { type ChangeEvent } from "react";
import "./EditorToolbar.css";

interface EditorToolbarProps {
  pageCount: number;
  targetPages: number;
  onTargetPagesChange: (pages: number) => void;
  activeView: "editor" | "preview" | "cards" | "analysis";
  onViewChange: (view: "editor" | "preview" | "cards" | "analysis") => void;
  showSuggestions?: boolean;
  onToggleSuggestions?: () => void;
  showKB?: boolean;
  onToggleKB?: () => void;
  showSettings?: boolean;
  onToggleSettings?: () => void;
  showExport?: boolean;
  onToggleExport?: () => void;
  onOpenProjectMenu?: () => void;
  projectName?: string;
}

export default function EditorToolbar({
  pageCount,
  targetPages,
  onTargetPagesChange,
  activeView,
  onViewChange,
  showSuggestions,
  onToggleSuggestions,
  showKB,
  onToggleKB,
  showSettings,
  onToggleSettings,
  showExport,
  onToggleExport,
  onOpenProjectMenu,
  projectName,
}: EditorToolbarProps) {
  const handleTargetChange = (e: ChangeEvent<HTMLInputElement>) => {
    const val = parseInt(e.target.value, 10);
    if (!isNaN(val) && val > 0 && val <= 300) {
      onTargetPagesChange(val);
    }
  };

  return (
    <div className="editor-toolbar">
      <div className="toolbar-left">
        <button className="toolbar-brand" onClick={onOpenProjectMenu} title="Projects">
          LW
        </button>
        {projectName && (
          <span className="toolbar-project-name" onClick={onOpenProjectMenu} title="Projects">
            {projectName}
          </span>
        )}
        <div className="toolbar-divider" />
        <div className="view-tabs">
          <button
            className={`view-tab ${activeView === "editor" ? "active" : ""}`}
            onClick={() => onViewChange("editor")}
          >
            Write
          </button>
          <button
            className={`view-tab ${activeView === "preview" ? "active" : ""}`}
            onClick={() => onViewChange("preview")}
          >
            Preview
          </button>
          <button
            className={`view-tab ${activeView === "cards" ? "active" : ""}`}
            onClick={() => onViewChange("cards")}
          >
            Cards
          </button>
          <button
            className={`view-tab ${activeView === "analysis" ? "active" : ""}`}
            onClick={() => onViewChange("analysis")}
          >
            Analysis
          </button>
        </div>
      </div>
      <div className="toolbar-right">
        {activeView === "editor" && onToggleSettings && (
          <button
            className={`view-tab assets-toggle ${showSettings ? "active" : ""}`}
            onClick={onToggleSettings}
          >
            Settings
          </button>
        )}
        {activeView === "editor" && onToggleSuggestions && (
          <button
            className={`view-tab ai-toggle ${showSuggestions ? "active" : ""}`}
            onClick={onToggleSuggestions}
          >
            AI
          </button>
        )}
        {activeView === "editor" && onToggleKB && (
          <button
            className={`view-tab kb-toggle ${showKB ? "active" : ""}`}
            onClick={onToggleKB}
          >
            KB
          </button>
        )}
        {activeView === "editor" && onToggleExport && (
          <button
            className={`view-tab export-toggle ${showExport ? "active" : ""}`}
            onClick={onToggleExport}
            title="Export screenplay, images & ScriptToScreen manifest"
          >
            Export
          </button>
        )}
        <div className="toolbar-divider" />
        <div className="page-info">
          <span className="page-count">
            ~{pageCount} {pageCount === 1 ? "page" : "pages"}
          </span>
          <div className="target-input">
            <label htmlFor="target-pages">Target:</label>
            <input
              id="target-pages"
              type="number"
              min={1}
              max={300}
              value={targetPages}
              onChange={handleTargetChange}
            />
            <span>pp</span>
          </div>
        </div>
      </div>
    </div>
  );
}
