import { type ChangeEvent, useState } from "react";
import "./EditorToolbar.css";

interface EditorToolbarProps {
  pageCount: number;
  targetPages: number;
  onTargetPagesChange: (pages: number) => void;
  activeView: "editor" | "preview" | "cards";
  onViewChange: (view: "editor" | "preview" | "cards") => void;
  showSuggestions?: boolean;
  onToggleSuggestions?: () => void;
  onExport?: () => void;
  onExportFdx?: () => void;
  onExportPdf?: () => void;
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
  onExport,
  onExportFdx,
  onExportPdf,
  onOpenProjectMenu,
  projectName,
}: EditorToolbarProps) {
  const [showExportMenu, setShowExportMenu] = useState(false);

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
        </div>
      </div>
      <div className="toolbar-right">
        {activeView === "editor" && onToggleSuggestions && (
          <button
            className={`view-tab ai-toggle ${showSuggestions ? "active" : ""}`}
            onClick={onToggleSuggestions}
          >
            AI
          </button>
        )}
        <div className="export-dropdown">
          <button
            className="view-tab"
            onClick={() => setShowExportMenu(!showExportMenu)}
            title="Export screenplay"
          >
            Export
          </button>
          {showExportMenu && (
            <div className="export-menu" onMouseLeave={() => setShowExportMenu(false)}>
              <button
                className="export-option"
                onClick={() => { onExport?.(); setShowExportMenu(false); }}
              >
                .fountain
              </button>
              <button
                className="export-option"
                onClick={() => { onExportFdx?.(); setShowExportMenu(false); }}
              >
                .fdx (Final Draft)
              </button>
              <button
                className="export-option"
                onClick={() => { onExportPdf?.(); setShowExportMenu(false); }}
              >
                .pdf (Print)
              </button>
            </div>
          )}
        </div>
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
